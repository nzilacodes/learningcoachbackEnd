import type { Sql } from "postgres";

type WordRow = {
  word: string;
  ipa_uk: string;
  ipa_us: string;
  part_of_speech: string;
  example: string;
  translation_pt: string;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  phrasal_verbs: string[];
  expressions: string[];
};

export async function getCachedWord(sql: Sql, word: string) {
  const rows = await sql`SELECT * FROM public.word_entries WHERE word = ${word}`;
  return rows[0] ?? null;
}

export async function upsertWord(sql: Sql, row: WordRow) {
  const [saved] = await sql`
    INSERT INTO public.word_entries (
      word, ipa_uk, ipa_us, part_of_speech, example, translation_pt,
      synonyms, antonyms, collocations, phrasal_verbs, expressions
    ) VALUES (
      ${row.word}, ${row.ipa_uk}, ${row.ipa_us}, ${row.part_of_speech}, ${row.example}, ${row.translation_pt},
      ${row.synonyms}, ${row.antonyms}, ${row.collocations}, ${row.phrasal_verbs}, ${row.expressions}
    )
    ON CONFLICT (word) DO UPDATE SET
      ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us, part_of_speech = EXCLUDED.part_of_speech,
      example = EXCLUDED.example, translation_pt = EXCLUDED.translation_pt, synonyms = EXCLUDED.synonyms,
      antonyms = EXCLUDED.antonyms, collocations = EXCLUDED.collocations,
      phrasal_verbs = EXCLUDED.phrasal_verbs, expressions = EXCLUDED.expressions
    RETURNING *
  `;
  return saved;
}

type Mispronounced = { word: string; expected_ipa: string; heard: string; tip: string };

type ReadingAssessmentRow = {
  userId: string;
  lessonId?: string | null;
  passage: string;
  passageKey: string;
  transcript: string;
  durationSeconds: number;
  wpm: number;
  comprehensionScore: number;
  accuracy: number;
  pronunciation: number;
  fluency: number;
  intonation: number;
  rhythm: number;
  clarity: number;
  pauses: number;
  overall: number;
  feedback: string;
  mispronounced: Mispronounced[];
};

export async function insertReadingAssessment(sql: Sql, row: ReadingAssessmentRow) {
  const [saved] = await sql`
    INSERT INTO public.reading_assessments (
      user_id, lesson_id, passage, passage_key, transcript, duration_seconds,
      wpm, comprehension_score, accuracy, pronunciation, fluency, intonation,
      rhythm, clarity, pauses, overall, feedback, mispronounced
    ) VALUES (
      ${row.userId}, ${row.lessonId ?? null}, ${row.passage}, ${row.passageKey}, ${row.transcript}, ${row.durationSeconds},
      ${row.wpm}, ${row.comprehensionScore}, ${row.accuracy}, ${row.pronunciation}, ${row.fluency}, ${row.intonation},
      ${row.rhythm}, ${row.clarity}, ${row.pauses}, ${row.overall}, ${row.feedback}, ${sql.json(row.mispronounced)}
    )
    RETURNING *
  `;
  return saved;
}

export async function listReadingHistory(sql: Sql, userId: string, passageKey?: string) {
  if (passageKey) {
    return sql`
      SELECT * FROM public.reading_assessments
      WHERE user_id = ${userId} AND passage_key = ${passageKey}
      ORDER BY created_at DESC
      LIMIT 50
    `;
  }
  return sql`
    SELECT * FROM public.reading_assessments
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
}

type PhonemeIssue = { sound: string; tip: string };

type PronunciationAssessmentRow = {
  userId: string;
  lessonId?: string | null;
  word: string;
  expectedText: string;
  transcribedText: string;
  accuracy: number;
  fluency: number;
  intonation: number;
  rhythm: number;
  clarity: number;
  overall: number;
  feedback: string;
  phonemeIssues: PhonemeIssue[];
};

export async function insertPronunciationAssessment(sql: Sql, row: PronunciationAssessmentRow) {
  const [saved] = await sql`
    INSERT INTO public.pronunciation_assessments (
      user_id, lesson_id, word, expected_text, transcribed_text, accuracy,
      fluency, intonation, rhythm, clarity, overall, feedback, phoneme_issues
    ) VALUES (
      ${row.userId}, ${row.lessonId ?? null}, ${row.word}, ${row.expectedText}, ${row.transcribedText}, ${row.accuracy},
      ${row.fluency}, ${row.intonation}, ${row.rhythm}, ${row.clarity}, ${row.overall}, ${row.feedback}, ${sql.json(row.phonemeIssues)}
    )
    RETURNING *
  `;
  return saved;
}

export async function listPronunciationHistory(sql: Sql, userId: string) {
  return sql`
    SELECT * FROM public.pronunciation_assessments
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
}

// -- Coach conversations --------------------------------------------------

export async function listConversations(sql: Sql, userId: string) {
  return sql`
    SELECT id, title, created_at, updated_at FROM public.ai_conversations
    WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 100
  `;
}

export async function createConversation(sql: Sql, userId: string, title: string | null) {
  const [row] = await sql`
    INSERT INTO public.ai_conversations (user_id, title) VALUES (${userId}, ${title})
    RETURNING id, title, created_at, updated_at
  `;
  return row;
}

export async function getConversation(sql: Sql, id: string) {
  const rows = await sql<{ id: string; user_id: string; title: string | null }[]>`
    SELECT id, user_id, title FROM public.ai_conversations WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function setConversationTitle(sql: Sql, id: string, title: string) {
  await sql`UPDATE public.ai_conversations SET title = ${title}, updated_at = now() WHERE id = ${id}`;
}

export async function touchConversation(sql: Sql, id: string) {
  await sql`UPDATE public.ai_conversations SET updated_at = now() WHERE id = ${id}`;
}

export async function listMessages(sql: Sql, conversationId: string, limit = 50) {
  const rows = await sql<{ id: string; role: string; content: string; created_at: string }[]>`
    SELECT id, role, content, created_at FROM public.ai_messages
    WHERE conversation_id = ${conversationId} ORDER BY created_at ASC LIMIT ${limit}
  `;
  return rows;
}

/** Last `limit` messages, oldest first — for building bounded LLM context. */
export async function getRecentMessages(sql: Sql, conversationId: string, limit: number) {
  const rows = await sql<{ role: string; content: string }[]>`
    SELECT role, content FROM public.ai_messages
    WHERE conversation_id = ${conversationId} ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.reverse();
}

export async function insertMessage(
  sql: Sql,
  row: { conversationId: string; userId: string; role: "user" | "assistant"; content: string },
) {
  const [saved] = await sql`
    INSERT INTO public.ai_messages (conversation_id, user_id, role, content)
    VALUES (${row.conversationId}, ${row.userId}, ${row.role}, ${row.content})
    RETURNING id, role, content, created_at
  `;
  return saved;
}

export async function getMessageById(sql: Sql, id: string) {
  const rows = await sql<{ id: string; conversation_id: string; role: "user" | "assistant"; created_at: string }[]>`
    SELECT id, conversation_id, role, created_at FROM public.ai_messages WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

/** Whether any message (e.g. an assistant reply) already exists after the given timestamp in this conversation. */
export async function hasMessageAfter(sql: Sql, conversationId: string, createdAt: string) {
  const rows = await sql`
    SELECT 1 FROM public.ai_messages WHERE conversation_id = ${conversationId} AND created_at > ${createdAt} LIMIT 1
  `;
  return rows.length > 0;
}

export async function getCachedStudyPack(sql: Sql, videoId: string) {
  const rows = await sql`SELECT * FROM public.video_study_packs WHERE video_id = ${videoId}`;
  return rows[0] ?? null;
}

type StudyPackData = {
  transcript_excerpt: string;
  summary: string;
  key_vocabulary: { word: string; pt: string; example: string }[];
  quiz: { q: string; opts: string[]; a: number }[];
  listening_activities: string[];
  speaking_activities: string[];
  vocabulary_activities: string[];
};

type StudyPackRow = {
  videoId: string;
  videoUrl: string;
  title: string;
  channel: string;
  topic: string;
  level: string;
  ageGroup: string;
  pack: StudyPackData;
};

export async function upsertStudyPack(sql: Sql, row: StudyPackRow) {
  const [saved] = await sql`
    INSERT INTO public.video_study_packs (video_id, video_url, title, channel, topic, level, age_group, pack)
    VALUES (${row.videoId}, ${row.videoUrl}, ${row.title}, ${row.channel}, ${row.topic}, ${row.level}, ${row.ageGroup}, ${sql.json(row.pack)})
    ON CONFLICT (video_id) DO UPDATE SET
      video_url = EXCLUDED.video_url, title = EXCLUDED.title, channel = EXCLUDED.channel,
      topic = EXCLUDED.topic, level = EXCLUDED.level, age_group = EXCLUDED.age_group,
      pack = EXCLUDED.pack, updated_at = now()
    RETURNING *
  `;
  return saved;
}
