import { env } from "../config/env.js";

export const AI_CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const AI_TTS_URL = "https://ai.gateway.lovable.dev/v1/audio/speech";
export const AI_STT_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";

class UpstreamAiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function callChatCompletion(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(AI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
