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
