import { env } from "../config/env.js";

export const AI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const AI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const AI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
export const CHAT_MODEL = "gpt-4o-mini";
export const TTS_MODEL = "tts-1";
export const STT_MODEL = "whisper-1";

export class AiNotConfiguredError extends Error {
  statusCode = 503;
  constructor() {
    super("AI features are not configured (OPENAI_API_KEY is unset)");
  }
}

export class UpstreamAiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function requireOpenAiKey(): string {
  if (!env.OPENAI_API_KEY) throw new AiNotConfiguredError();
  return env.OPENAI_API_KEY;
}

const AI_REQUEST_TIMEOUT_MS = 30_000;

// A hung upstream AI response would otherwise hold the request (and the
// underlying connection) open indefinitely — e.g. blocking the whole
// diagnostic-test submission on a stalled OpenAI call.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamAiError(`AI request timed out after ${timeoutMs}ms`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Default cap on every chat completion — without it, response length (and
// cost/latency) is unbounded. Callers with a genuine need for longer output
// (e.g. the study-pack generator) can still override via `body.max_tokens`.
const DEFAULT_MAX_TOKENS = 1000;

export async function callChatCompletion(body: Record<string, unknown>): Promise<string> {
  const apiKey = requireOpenAiKey();
  const res = await fetchWithTimeout(AI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, max_tokens: DEFAULT_MAX_TOKENS, ...body }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new UpstreamAiError(msg || "AI request failed", res.status);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "{}";
}

export function clampScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Levenshtein-based similarity in [0..1], ported from routes/api/diagnostic-evaluate.ts.
export function similarity(a: string, b: string): number {
  const s = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const t = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  const dist = dp[m]![n]!;
  const maxLen = Math.max(m, n);
  return 1 - dist / maxLen;
}
