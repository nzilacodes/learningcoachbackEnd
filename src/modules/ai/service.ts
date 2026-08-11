import type { Sql } from "postgres";
import { z } from "zod";
import {
  AI_STT_URL,
  AI_TTS_URL,
  STT_MODEL,
  TTS_MODEL,
  callChatCompletion,
  fetchWithTimeout,
  requireOpenAiKey,
} from "../../lib/ai-gateway.js";
import { hasActiveSubscription, PaymentRequiredError } from "../../lib/subscription.js";
import * as repo from "./repository.js";

class UpstreamAiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

class NotFoundError extends Error {
  statusCode = 404;
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
  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => "");
    throw new UpstreamAiError(msg || "TTS failed", upstream.status);
  }
  return Buffer.from(await upstream.arrayBuffer());
}

export async function transcribeAudio(file: { buffer: Buffer; filename: string; mimetype: string }) {
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

  const res = await fetchWithTimeout(AI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new UpstreamAiError(msg || "STT failed", res.status);
  }
  const data = (await res.json()) as { text?: string };
  return { text: data.text ?? "" };
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
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    pack = StudyPackSchema.parse(JSON.parse(content));
  } catch {
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

export async function sendCoachMessage(sql: Sql, userId: string, conversationId: string, content: string) {
  const conversation = await requireOwnedConversation(sql, userId, conversationId);

  const userMessage = await repo.insertMessage(sql, { conversationId, userId, role: "user", content });
  const history = await repo.getRecentMessages(sql, conversationId, COACH_HISTORY_WINDOW);

  const replyText = await callChatCompletion({
    messages: [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  });
  const assistantMessage = await repo.insertMessage(sql, {
    conversationId,
    userId,
    role: "assistant",
    content: replyText,
  });

  if (conversation.title) {
    await repo.touchConversation(sql, conversationId);
  } else {
    await repo.setConversationTitle(sql, conversationId, content.slice(0, 60));
  }

  return { userMessage, assistantMessage };
}
