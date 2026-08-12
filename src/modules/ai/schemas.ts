import { z } from "zod";

export const speechSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().max(40).default("alloy"),
  instructions: z.string().max(500).optional(),
  speed: z.number().min(0.25).max(4).optional(),
});

export const dictionaryParamsSchema = z.object({
  word: z.string().trim().min(1).max(60),
});

export const readingAssessSchema = z.object({
  passageKey: z.string().min(1).max(80),
  passage: z.string().min(10).max(4000),
  transcript: z.string().max(6000).default(""),
  durationSeconds: z.number().int().min(1).max(1800),
  lessonId: z.string().uuid().nullable().optional(),
});

export const readingHistoryQuerySchema = z.object({
  passageKey: z.string().optional(),
});

export const pronunciationAssessSchema = z.object({
  word: z.string().min(1).max(120),
  transcribed: z.string().default(""),
  ipa: z.string().default(""),
  lessonId: z.string().uuid().nullable().optional(),
});

export const videoIdParamsSchema = z.object({
  videoId: z.string().min(1).max(60),
});

export const videoStudyPackQuerySchema = z.object({
  videoUrl: z.string().url(),
  title: z.string().max(300).default(""),
  channel: z.string().max(200).default(""),
  topic: z.string().max(200).default(""),
  level: z.string().max(10).default("A2"),
  ageGroup: z.enum(["kids", "teens", "adults"]).default("adults"),
});

export const createConversationSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const conversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const sendCoachMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

export const retryMessageParamsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});
