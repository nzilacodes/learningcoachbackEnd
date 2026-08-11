import { z } from "zod";

export const createClassSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const joinClassSchema = z.object({
  inviteCode: z.string().trim().min(1).max(20),
});

export const classIdParamsSchema = z.object({ id: z.string().uuid() });

export const classMemberParamsSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
});
