import { describe, expect, it } from "vitest";
import { classifyTranscription, resolveLanguage } from "./service.js";

// Fixtures shaped like Whisper's response_format=verbose_json output.
function segment(overrides: Partial<{ start: number; end: number; avg_logprob: number; no_speech_prob: number }> = {}) {
  return { start: 0, end: 2, avg_logprob: -0.3, no_speech_prob: 0.05, ...overrides };
}

describe("classifyTranscription", () => {
  it("rejects a completely empty/no-segment response as no_speech", () => {
    const result = classifyTranscription({ text: "" });
    expect(result.decision).toBe("rejected_no_speech");
    expect(result.text).toBe("");
  });

  // The actual bug report: Whisper hallucinating "you" on silent audio. The
  // primary defense is Whisper's own confidence signal, not the word itself —
  // this is what should catch it.
  it("rejects a hallucinated 'you' on silent audio via the confidence signal, not a word blacklist", () => {
    const result = classifyTranscription({
      text: "you",
      duration: 2,
      segments: [segment({ start: 0, end: 2, avg_logprob: -1.8, no_speech_prob: 0.92 })],
    });
    expect(result.decision).toBe("rejected_no_speech");
  });

  // Reproduces a real observation from testing against the live Whisper API
  // with a genuinely silent 2s WAV: no_speech_prob=0.94 (unambiguous silence)
  // but avg_logprob only -0.51 (not below the -1.0 logprob threshold), because
  // Whisper still hallucinates a short, "confident" token once it commits to
  // one. An AND of both signals would have missed this and fallen through to
  // the narrower secondary net (or slipped through entirely for a phrase not
  // on the list) — no_speech_prob alone must be enough to reject it.
  it("rejects real silent audio via no_speech_prob alone, even when avg_logprob isn't very negative", () => {
    const result = classifyTranscription({
      text: "you",
      duration: 2,
      segments: [segment({ start: 0, end: 2, avg_logprob: -0.51, no_speech_prob: 0.94 })],
    });
    expect(result.decision).toBe("rejected_no_speech");
  });

  it("rejects other known Whisper hallucination phrases on silence the same way", () => {
    const result = classifyTranscription({
      text: "Thanks for watching!",
      duration: 3,
      segments: [segment({ start: 0, end: 3, avg_logprob: -1.5, no_speech_prob: 0.85 })],
    });
    expect(result.decision).toBe("rejected_no_speech");
  });

  it("rejects a borderline low-confidence short 'you' via the secondary net", () => {
    const result = classifyTranscription({
      text: "you",
      duration: 0.8,
      segments: [segment({ start: 0, end: 0.8, avg_logprob: -0.7, no_speech_prob: 0.45 })],
    });
    expect(result.decision).toBe("rejected_low_confidence");
  });

  it("accepts normal, confident, multi-word speech", () => {
    const result = classifyTranscription({
      text: "I would like to practice my pronunciation today",
      duration: 3,
      segments: [segment({ start: 0, end: 3, avg_logprob: -0.3, no_speech_prob: 0.02 })],
    });
    expect(result.decision).toBe("accepted");
    expect(result.text).toBe("I would like to practice my pronunciation today");
  });

  it("accepts a short but confidently-heard legitimate word not on the hallucination list", () => {
    const result = classifyTranscription({
      text: "hello",
      duration: 0.6,
      segments: [segment({ start: 0, end: 0.6, avg_logprob: -0.2, no_speech_prob: 0.03 })],
    });
    expect(result.decision).toBe("accepted");
  });

  // Regression guard: a learner genuinely, deliberately saying "you" (e.g.
  // drilling the word in word-card.tsx) must not be rejected just because the
  // text happens to match the hallucination phrase list.
  it("accepts a deliberate, confidently-heard 'you' — proves this is not a word blacklist", () => {
    const result = classifyTranscription({
      text: "you",
      duration: 2,
      segments: [segment({ start: 0, end: 2, avg_logprob: -0.1, no_speech_prob: 0.05 })],
    });
    expect(result.decision).toBe("accepted");
    expect(result.text).toBe("you");
  });

  // Reproduces a real regression caught by live-testing against the Whisper
  // API: a genuine TTS-spoken "you" is naturally short (0.48s — real words
  // just don't take 1.5s to say) with a low, not-elevated no_speech_prob
  // (0.18). An earlier version of this function also rejected short clips on
  // duration alone, which wrongly caught this case — duration must never be
  // an independent trigger, only no_speech_prob.
  it("accepts a short, genuinely-spoken 'you' — duration alone must never trigger rejection", () => {
    const result = classifyTranscription({
      text: "you",
      duration: 0.48,
      segments: [segment({ start: 0, end: 0.48, avg_logprob: -0.67, no_speech_prob: 0.18 })],
    });
    expect(result.decision).toBe("accepted");
    expect(result.text).toBe("you");
  });
});

describe("resolveLanguage", () => {
  it("defaults to English when no language is given", () => {
    expect(resolveLanguage(undefined)).toBe("en");
  });

  it("passes through a supported language", () => {
    expect(resolveLanguage("pt")).toBe("pt");
    expect(resolveLanguage("en")).toBe("en");
  });

  it("falls back to English for an unsupported/unexpected code", () => {
    expect(resolveLanguage("fr")).toBe("en");
    expect(resolveLanguage("")).toBe("en");
  });
});
