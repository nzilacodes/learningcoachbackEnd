import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AI_CHAT_URL, AI_STT_URL, AI_TTS_URL } from "../../lib/ai-gateway.js";
import * as repo from "./repository.js";

class UpstreamAiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function synthesizeSpeech(input: { text: string; voice: string; instructions?: string; speed?: number }) {
  const body: Record<string, unknown> = {
    model: "openai/gpt-4o-mini-tts",
    input: input.text,
    voice: input.voice,
    response_format: "mp3",
  };
  if (input.instructions) body.instructions = input.instructions;
  if (typeof input.speed === "number") body.speed = input.speed;

  const upstream = await fetch(AI_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => "");
    throw new UpstreamAiError(msg || "TTS failed", upstream.status);
  }
  return Buffer.from(await upstream.arrayBuffer());
}

export async function transcribeAudio(file: { buffer: Buffer; filename: string; mimetype: string }) {
  const upstream = new FormData();
  const ext = file.mimetype.includes("wav")
    ? "wav"
    : file.mimetype.includes("mp4")
      ? "mp4"
      : file.mimetype.includes("mpeg")
        ? "mp3"
        : file.mimetype.includes("ogg")
          ? "ogg"
          : "webm";
  upstream.append("file", new Blob([file.buffer], { type: file.mimetype || "audio/webm" }), `recording.${ext}`);
  upstream.append("model", "openai/gpt-4o-mini-transcribe");

  const res = await fetch(AI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LOVABLE_API_KEY}` },
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

export async function getWordData(db: SupabaseClient, rawWord: string) {
  const word = rawWord.trim().toLowerCase();
  const cached = await repo.getCachedWord(db, word);
  if (cached) return cached;

  const res = await fetch(AI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an English lexicography expert. Return strict JSON with keys: word, ipa_uk, ipa_us, part_of_speech, example, translation_pt (European Portuguese), synonyms (array of strings, up to 6), antonyms (array, up to 6), collocations (array, up to 8), phrasal_verbs (array, up to 6, related), expressions (array, up to 6, idioms). IPA must use standard slash-free symbols (e.g. həˈloʊ).",
        },
        { role: "user", content: `Word: "${word}"` },
      ],
    }),
  });
  if (!res.ok) throw new UpstreamAiError(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const generated = WordSchema.parse(JSON.parse(json.choices?.[0]?.message?.content ?? "{}"));

  return repo.upsertWord(db, { ...generated, word });
}
