import type { Sql } from "postgres";
import { z } from "zod";
import {
  AI_STT_URL,
  AI_TTS_URL,
  STT_MODEL,
  TTS_MODEL,
  callChatCompletion,
  classifyOpenAiFailure,
  fetchWithTimeout,
  requireOpenAiKey,
} from "../../lib/ai-gateway.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { getMediaAssetById } from "../media/repository.js";
import * as repo from "./repository.js";

/** A caller-supplied mediaAssetId only gets linked/exposed as audio_url once
 * we've confirmed it's actually theirs — otherwise anyone could point an
 * assessment at someone else's recording by guessing/reusing its id. */
async function resolveOwnedRecording(sql: Sql, userId: string, mediaAssetId: string | null | undefined) {
  if (!mediaAssetId) return { mediaAssetId: null, audioUrl: null };
  const asset = await getMediaAssetById(sql, mediaAssetId);
  if (!asset || asset.owner_id !== userId) return { mediaAssetId: null, audioUrl: null };
  return { mediaAssetId: asset.id, audioUrl: `/v1/media/${asset.id}/stream` };
}

export async function synthesizeSpeech(input: { text: string; voice: string; instructions?: string; speed?: number }) {
  const apiKey = requireOpenAiKey();
  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input: input.text,
    voice: input.voice,
    response_format: "mp3",
  };
  if (typeof input.speed === "number") body.speed = input.speed;
  // input.instructions (accent/tone hints) isn't supported by OpenAI's tts-1; dropped.

  const upstream = await fetchWithTimeout(AI_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) throw await classifyOpenAiFailure(upstream, "tts");
  return Buffer.from(await upstream.arrayBuffer());
}

const SUPPORTED_STT_LANGUAGES = new Set(["en", "pt"]);

// The app is an English-learning app: every scripted speaking/reading/
// placement exercise's target text is English, so "en" is the safest
// default — leaving language unset would let Whisper auto-detect, which is
// *more* likely to misfire (and hallucinate) on short/ambiguous clips than a
// pinned language is.
export function resolveLanguage(input?: string): string {
  return input && SUPPORTED_STT_LANGUAGES.has(input) ? input : "en";
}

// A buffer this small can't contain a real recording (a MediaRecorder/WAV
// container has some header overhead even with zero audio frames) — reject
// before spending an OpenAI call on it. The real silence/no-speech defense is
// the client-side duration/energy gate and the confidence check below; this
// is just a cheap last-resort backstop.
const MIN_UPLOAD_BYTES = 1000;

// Thresholds are OpenAI's own published Whisper defaults, but combined with
// OR rather than AND: live-tested against a genuinely silent 2s clip, Whisper
// returned no_speech_prob=0.94 (unambiguous silence) alongside avg_logprob=
// -0.51 — well above -1.0, because once it commits to hallucinating a short,
// common token, it emits it "confidently". Requiring both signals to agree
// missed this real case; no_speech_prob alone is the more reliable silence
// signal, with avg_logprob still available to catch a separately-garbled
// (not silent) segment on its own.
const NO_SPEECH_PROB_THRESHOLD = 0.6;
const LOGPROB_THRESHOLD = -1.0;
// A segment-weighted-by-duration fraction below this could still be legitimate
// trailing/leading silence around real speech; only reject when the *whole*
// clip is effectively silence.
const SILENT_FRACTION_THRESHOLD = 0.8;

// Secondary, narrow backstop: Whisper is documented to hallucinate these
// specific stock phrases on silence/noise (trained on YouTube caption data
// where such segments are captioned this way). This only fires alongside a
// still-elevated confidence signal — never on the text match alone, and NOT
// on short duration alone either — so it can't become a de facto blacklist of
// these words for a learner genuinely saying them (e.g. drilling "you" in
// word-card.tsx). Live-tested: a real TTS-spoken "you" clocked in at 0.48s
// with no_speech_prob=0.18 — duration alone would have wrongly rejected it,
// which is exactly why duration was dropped as a trigger here.
const HALLUCINATION_PHRASES = new Set(["you", "thank you", "thanks for watching", "bye", "subscribe"]);
const HALLUCINATION_MAX_WORDS = 3;
const HALLUCINATION_ELEVATED_NO_SPEECH_PROB = 0.3;

type WhisperSegment = { start: number; end: number; avg_logprob: number; no_speech_prob: number };
type WhisperVerboseJson = { text?: string; language?: string; duration?: number; segments?: WhisperSegment[] };

export type TranscriptionDecision = "accepted" | "rejected_no_speech" | "rejected_low_confidence";

export function classifyTranscription(data: WhisperVerboseJson): {
  decision: TranscriptionDecision;
  text: string;
  avgNoSpeechProb?: number;
  avgLogprob?: number;
} {
  const segments = data.segments ?? [];
  const text = (data.text ?? "").trim();
  if (!text || segments.length === 0) return { decision: "rejected_no_speech", text: "" };

  const durationOf = (seg: WhisperSegment) => Math.max(0, seg.end - seg.start);
  const totalDur = segments.reduce((sum, seg) => sum + durationOf(seg), 0) || 1;
  const weightedAvg = (key: "no_speech_prob" | "avg_logprob") =>
    segments.reduce((sum, seg) => sum + seg[key] * durationOf(seg), 0) / totalDur;
  const avgNoSpeechProb = weightedAvg("no_speech_prob");
  const avgLogprob = weightedAvg("avg_logprob");

  const silentDur = segments
    .filter((seg) => seg.no_speech_prob > NO_SPEECH_PROB_THRESHOLD || seg.avg_logprob < LOGPROB_THRESHOLD)
    .reduce((sum, seg) => sum + durationOf(seg), 0);
  if (silentDur / totalDur >= SILENT_FRACTION_THRESHOLD) {
    return { decision: "rejected_no_speech", text: "", avgNoSpeechProb, avgLogprob };
  }

  const normalized = text.toLowerCase().replace(/[.,!?]/g, "").trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (
    wordCount <= HALLUCINATION_MAX_WORDS &&
    HALLUCINATION_PHRASES.has(normalized) &&
    avgNoSpeechProb > HALLUCINATION_ELEVATED_NO_SPEECH_PROB
  ) {
    return { decision: "rejected_low_confidence", text: "", avgNoSpeechProb, avgLogprob };
  }

  return { decision: "accepted", text, avgNoSpeechProb, avgLogprob };
}

export async function transcribeAudio(file: { buffer: Buffer; filename: string; mimetype: string; language?: string }) {
  const language = resolveLanguage(file.language);
  if (file.buffer.length < MIN_UPLOAD_BYTES) {
    return {
      text: "",
      decision: "rejected_no_speech" as const,
      languageRequested: language,
      languageDetected: undefined,
      durationSec: undefined,
      avgNoSpeechProb: undefined,
      avgLogprob: undefined,
      segmentCount: 0,
    };
  }

  const apiKey = requireOpenAiKey();
  const ext = file.mimetype.includes("wav")
    ? "wav"
    : file.mimetype.includes("mp4")
      ? "mp4"
      : file.mimetype.includes("mpeg")
        ? "mp3"
        : file.mimetype.includes("ogg")
          ? "ogg"
          : "webm";
  const upstream = new FormData();
  upstream.append("file", new Blob([file.buffer], { type: file.mimetype || "audio/webm" }), `recording.${ext}`);
  upstream.append("model", STT_MODEL);
  upstream.append("language", language);
  upstream.append("response_format", "verbose_json");
  upstream.append("temperature", "0");

  const res = await fetchWithTimeout(AI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  });
  if (!res.ok) throw await classifyOpenAiFailure(res, "stt");
  const data = (await res.json()) as WhisperVerboseJson;
  const classified = classifyTranscription(data);
  return {
    text: classified.text,
    decision: classified.decision,
    languageRequested: language,
    languageDetected: data.language,
    durationSec: data.duration,
    avgNoSpeechProb: classified.avgNoSpeechProb,
    avgLogprob: classified.avgLogprob,
    segmentCount: data.segments?.length ?? 0,
  };
}

const WordSchema = z.object({
  word: z.string(),
  ipa_uk: z.string().default(""),
  ipa_us: z.string().default(""),
  part_of_speech: z.string().default(""),
  example: z.string().default(""),
  translation_pt: z.string().default(""),
  synonyms: z.array(z.string()).default([]),
  antonyms: z.array(z.string()).default([]),
  collocations: z.array(z.string()).default([]),
  phrasal_verbs: z.array(z.string()).default([]),
  expressions: z.array(z.string()).default([]),
});

export async function getWordData(sql: Sql, rawWord: string) {
  const word = rawWord.trim().toLowerCase();
  const cached = await repo.getCachedWord(sql, word);
  if (cached) return cached;

  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an English lexicography expert. Return strict JSON with keys: word, ipa_uk, ipa_us, part_of_speech, example, translation_pt (European Portuguese), synonyms (array of strings, up to 6), antonyms (array, up to 6), collocations (array, up to 8), phrasal_verbs (array, up to 6, related), expressions (array, up to 6, idioms). IPA must use standard slash-free symbols (e.g. həˈloʊ).",
      },
      { role: "user", content: `Word: "${word}"` },
    ],
  });
  const generated = WordSchema.parse(JSON.parse(content));

  return repo.upsertWord(sql, { ...generated, word });
}

// -- Reading assessment -------------------------------------------------------

const ReadingAssessSchema = z.object({
  pronunciation: z.number().min(0).max(100),
  fluency: z.number().min(0).max(100),
  intonation: z.number().min(0).max(100),
  rhythm: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  pauses: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
  mispronounced: z
    .array(
      z.object({
        word: z.string(),
        expected_ipa: z.string().default(""),
        heard: z.string().default(""),
        tip: z.string().default(""),
      }),
    )
    .default([]),
  feedback: z.string().default(""),
});

function normalizeForDiff(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function diffWords(expected: string, actual: string): string[] {
  const exp = normalizeForDiff(expected);
  const act = new Set(normalizeForDiff(actual));
  const missing: string[] = [];
  for (const w of exp) if (!act.has(w) && !missing.includes(w)) missing.push(w);
  return missing.slice(0, 30);
}

type ReadingAssessInput = {
  passageKey: string;
  passage: string;
  transcript: string;
  durationSeconds: number;
  lessonId?: string | null;
  mediaAssetId?: string | null;
};

export async function assessReading(sql: Sql, userId: string, input: ReadingAssessInput) {
  const missing = diffWords(input.passage, input.transcript);
  const wordCount = input.passage.split(/\s+/).filter(Boolean).length;
  const wpm = Math.round((wordCount / input.durationSeconds) * 60);

  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an English speaking coach. Analyse a learner's read-aloud attempt and grade it 0-100 on pronunciation, fluency, intonation, rhythm, clarity and pauses. Return strict JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          target_passage: input.passage,
          student_transcript: input.transcript,
          approximate_wpm: wpm,
          likely_missed_or_mispronounced_words: missing,
          instructions:
            "For 'mispronounced' return up to 8 words the learner likely said wrong with expected_ipa (British), heard (best guess phonetic), and a short tip. 'feedback' is one short paragraph in Portuguese.",
          response_shape: {
            pronunciation: 0,
            fluency: 0,
            intonation: 0,
            rhythm: 0,
            clarity: 0,
            pauses: 0,
            overall: 0,
            mispronounced: [{ word: "", expected_ipa: "", heard: "", tip: "" }],
            feedback: "",
          },
        }),
      },
    ],
  });
  const report = ReadingAssessSchema.parse(JSON.parse(content));
  const accuracy = Math.max(0, 1 - missing.length / Math.max(1, wordCount));
  const recording = await resolveOwnedRecording(sql, userId, input.mediaAssetId);

  await repo.insertReadingAssessment(sql, {
    userId,
    lessonId: input.lessonId,
    passage: input.passage,
    passageKey: input.passageKey,
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
    wpm,
    comprehensionScore: report.overall,
    accuracy,
    pronunciation: report.pronunciation,
    fluency: report.fluency,
    intonation: report.intonation,
    rhythm: report.rhythm,
    clarity: report.clarity,
    pauses: report.pauses,
    overall: report.overall,
    feedback: report.feedback,
    mispronounced: report.mispronounced,
    mediaAssetId: recording.mediaAssetId,
    audioUrl: recording.audioUrl,
  });

  return { ...report, wpm, missing };
}

export async function getReadingHistory(sql: Sql, userId: string, passageKey?: string) {
  return repo.listReadingHistory(sql, userId, passageKey);
}

// -- Pronunciation assessment --------------------------------------------------

const PronunciationAssessSchema = z.object({
  pronunciation: z.number().min(0).max(100),
  fluency: z.number().min(0).max(100),
  intonation: z.number().min(0).max(100),
  rhythm: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
  phoneme_issues: z.array(z.object({ sound: z.string(), tip: z.string() })).default([]),
  feedback: z.string().default(""),
});

type PronunciationAssessInput = {
  word: string;
  transcribed: string;
  ipa: string;
  lessonId?: string | null;
  mediaAssetId?: string | null;
};

export async function assessPronunciation(sql: Sql, userId: string, input: PronunciationAssessInput) {
  // "Análise de pronúncia" is listed as a paid-plan feature in the pricing copy.
  if (!(await hasActiveSubscription(sql, userId))) {
    throw new PaymentRequiredError("Pronunciation analysis requires an active subscription.");
  }
  const content = await callChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert English pronunciation coach. Given the target word/phrase, its IPA (if provided) and the learner's ASR transcription, estimate scores 0-100 for: pronunciation, fluency, intonation, rhythm, clarity, overall. List up to 5 specific phoneme_issues each as { sound: '/θ/', tip: 'place tongue between teeth' } and short PT feedback. Be strict but fair; a very different transcription implies low scores. Return JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          target: input.word,
          ipa: input.ipa,
          asr_transcription: input.transcribed,
        }),
      },
    ],
  });
  const score = PronunciationAssessSchema.parse(JSON.parse(content));
  const recording = await resolveOwnedRecording(sql, userId, input.mediaAssetId);

  await repo.insertPronunciationAssessment(sql, {
    userId,
    lessonId: input.lessonId,
    word: input.word,
    expectedText: input.word,
    transcribedText: input.transcribed,
    accuracy: score.pronunciation,
    fluency: score.fluency,
    intonation: score.intonation,
    rhythm: score.rhythm,
    clarity: score.clarity,
    overall: score.overall,
    feedback: score.feedback,
    phonemeIssues: score.phoneme_issues,
    mediaAssetId: recording.mediaAssetId,
    audioUrl: recording.audioUrl,
  });

  return score;
}

export async function getPronunciationHistory(sql: Sql, userId: string) {
  return repo.listPronunciationHistory(sql, userId);
}

// -- Video study pack ----------------------------------------------------------

const StudyPackSchema = z.object({
  transcript_excerpt: z.string(),
  summary: z.string(),
  key_vocabulary: z.array(z.object({ word: z.string(), pt: z.string(), example: z.string() })),
  quiz: z.array(z.object({ q: z.string(), opts: z.array(z.string()).length(4), a: z.number().min(0).max(3) })),
  listening_activities: z.array(z.string()),
  speaking_activities: z.array(z.string()),
  vocabulary_activities: z.array(z.string()),
});

const FALLBACK_STUDY_PACK = {
  transcript_excerpt: "Transcript is being prepared. In the meantime, watch the video and take notes of new words.",
  summary:
    "This video introduces vocabulary and expressions related to the lesson topic. Watch carefully and try to catch the main ideas.",
  key_vocabulary: [],
  quiz: [],
  listening_activities: [
    "Listen once without subtitles and note 3 words you recognize.",
    "Listen a second time with subtitles and write down 3 new words.",
    "Pause at 1:00 and summarize what you heard in one sentence.",
    "Listen again and count how many times the topic keyword appears.",
  ],
  speaking_activities: [
    "Summarize the video out loud in 60 seconds.",
    "Describe your opinion about the topic in 3 sentences.",
    "Role-play a short dialogue using vocabulary from the video.",
    "Record yourself reading the summary aloud.",
  ],
  vocabulary_activities: [
    "Write 5 new words from the video with translations.",
    "Create one example sentence for each new word.",
    "Group the new words by category (verbs, nouns, adjectives).",
    "Use 3 words in a short paragraph.",
  ],
};

type StudyPackInput = {
  videoUrl: string;
  title: string;
  channel: string;
  topic: string;
  level: string;
  ageGroup: string;
};

export async function getVideoStudyPack(sql: Sql, videoId: string, input: StudyPackInput) {
  const cached = await repo.getCachedStudyPack(sql, videoId);
  if (cached) return cached.pack;

  const system =
    "You are an English teacher. Produce a JSON study pack for an English lesson built around a YouTube video. " +
    "All learner-facing text must be in English EXCEPT the `pt` field of vocabulary which is Portuguese (pt-PT). " +
    "Keep everything CEFR-aligned to the given level. Return ONLY valid JSON matching this schema: " +
    '{"transcript_excerpt": string (~120 words simulated excerpt of the likely transcript, faithful to the video topic; not the full transcript), ' +
    '"summary": string (4-6 sentences summarizing the likely video content), ' +
    '"key_vocabulary": [{"word": string, "pt": string, "example": string}] (8 items), ' +
    '"quiz": [{"q": string, "opts": [4 strings], "a": index 0-3}] (5 items, comprehension + grammar + vocab), ' +
    '"listening_activities": [string] (4 short tasks such as "Listen and identify..."), ' +
    '"speaking_activities": [string] (4 short prompts: role-plays, describe, discuss), ' +
    '"vocabulary_activities": [string] (4 short tasks: matching, fill-the-blank, categorize)}';

  const user = JSON.stringify({
    videoTitle: input.title,
    channel: input.channel,
    videoUrl: input.videoUrl,
    topic: input.topic,
    cefr_level: input.level,
    age_group: input.ageGroup,
    instruction:
      "Base the transcript excerpt and summary on the plausible content given the title, channel, and topic. If uncertain, keep it generic to the topic and level. Do not invent facts about specific people.",
  });

  let pack: z.infer<typeof StudyPackSchema>;
  try {
    const content = await callChatCompletion({
      response_format: { type: "json_object" },
      // Larger than the library default (1000): a study pack includes a
      // transcript excerpt, vocabulary list and quiz questions.
      max_tokens: 2000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    pack = StudyPackSchema.parse(JSON.parse(content));
  } catch (err) {
    // Falls back to a generic pack rather than failing the page — but the
    // failure itself (quota, timeout, malformed AI JSON, ...) was previously
    // discarded entirely. Logged here so it's still visible to diagnose,
    // consistent with the AI_SERVICE_LIMIT_REACHED-style logging everywhere else.
    console.error(`[ai] study pack generation failed for video ${videoId}, using fallback:`, err);
    return FALLBACK_STUDY_PACK;
  }

  await repo.upsertStudyPack(sql, {
    videoId,
    videoUrl: input.videoUrl,
    title: input.title,
    channel: input.channel,
    topic: input.topic,
    level: input.level,
    ageGroup: input.ageGroup,
    pack,
  });

  return pack;
}

// -- Coach conversations --------------------------------------------------

const COACH_SYSTEM_PROMPT =
  "You are Coach, a friendly, encouraging English teacher inside the Learning English with Coach app. " +
  "Keep replies concise (2-4 short paragraphs at most), adapt to the learner's apparent level, gently " +
  "correct mistakes when relevant, and reply in whichever language the learner just wrote in (Portuguese or English).";

const COACH_HISTORY_WINDOW = 20;

export const listConversations = repo.listConversations;

export async function createConversation(sql: Sql, userId: string, title?: string) {
  return repo.createConversation(sql, userId, title?.trim() || null);
}

async function requireOwnedConversation(sql: Sql, userId: string, conversationId: string) {
  const conversation = await repo.getConversation(sql, conversationId);
  if (!conversation || conversation.user_id !== userId) throw new NotFoundError("Conversation not found");
  return conversation;
}

export async function listMessages(sql: Sql, userId: string, conversationId: string) {
  await requireOwnedConversation(sql, userId, conversationId);
  return repo.listMessages(sql, conversationId);
}

/**
 * Best-effort AI reply generation, isolated so a provider failure never
 * orphans an already-persisted user message. Returns null (never throws) on
 * any failure — the caller reports status: "failed" and the frontend offers
 * a per-message retry (see retryCoachMessage / POST .../messages/:id/retry)
 * instead of losing the user's message or failing the whole request.
 */
async function generateCoachReply(sql: Sql, conversationId: string, userId: string) {
  const history = await repo.getRecentMessages(sql, conversationId, COACH_HISTORY_WINDOW);
  try {
    const replyText = await callChatCompletion({
      messages: [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return await repo.insertMessage(sql, { conversationId, userId, role: "assistant", content: replyText });
  } catch (err) {
    console.error(`[ai-coach] reply generation failed for conversation ${conversationId}:`, err);
    return null;
  }
}

export async function sendCoachMessage(sql: Sql, userId: string, conversationId: string, content: string) {
  const conversation = await requireOwnedConversation(sql, userId, conversationId);

  const userMessage = await repo.insertMessage(sql, { conversationId, userId, role: "user", content });

  if (conversation.title) {
    await repo.touchConversation(sql, conversationId);
  } else {
    await repo.setConversationTitle(sql, conversationId, content.slice(0, 60));
  }

  const assistantMessage = await generateCoachReply(sql, conversationId, userId);
  return { userMessage, assistantMessage, status: (assistantMessage ? "ok" : "failed") as "ok" | "failed" };
}

/** Re-runs only the AI half for a user message whose reply previously failed. */
export async function retryCoachMessage(sql: Sql, userId: string, conversationId: string, messageId: string) {
  await requireOwnedConversation(sql, userId, conversationId);
  const message = await repo.getMessageById(sql, messageId);
  if (!message || message.conversation_id !== conversationId || message.role !== "user") {
    throw new NotFoundError("Message not found");
  }
  if (await repo.hasMessageAfter(sql, conversationId, message.created_at)) {
    throw new ConflictError("This message already has a reply");
  }

  const assistantMessage = await generateCoachReply(sql, conversationId, userId);
  return { assistantMessage, status: (assistantMessage ? "ok" : "failed") as "ok" | "failed" };
}
