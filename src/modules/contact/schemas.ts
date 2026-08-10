import { z } from "zod";

export const submitContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().max(300).optional(),
  message: z.string().trim().min(1).max(5000),
});
