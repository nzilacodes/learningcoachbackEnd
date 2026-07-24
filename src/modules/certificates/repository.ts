import type { SupabaseClient } from "@supabase/supabase-js";
import type { CefrLevel } from "../../lib/cefr.js";

export async function findPassedExamAttempt(db: SupabaseClient, userId: string, level: CefrLevel) {
  const { data, error } = await db
    .from("level_exam_attempts")
    .select("score")
    .eq("user_id", userId)
    .eq("level", level)
    .eq("passed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { score: number } | null;
}

export async function findExistingCertificate(db: SupabaseClient, userId: string, level: CefrLevel) {
  const { data, error } = await db
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .eq("level", level)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfileName(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.full_name ?? data?.email ?? "Learner";
}

export async function insertCertificate(
  db: SupabaseClient,
  params: { userId: string; level: CefrLevel; score: number; courseId?: string; courseTitle?: string; fullName: string },
) {
  const { data, error } = await db
    .from("certificates")
    .insert({
      user_id: params.userId,
      level: params.level,
      score: params.score,
      course_id: params.courseId ?? null,
      course_title: params.courseTitle ?? null,
      full_name: params.fullName,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listCertificatesForUser(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .order("issued_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function findCertificateByCode(db: SupabaseClient, code: string) {
  const { data, error } = await db
    .from("certificates")
    .select("verification_code, full_name, level, course_title, score, issued_at, signature")
    .eq("verification_code", code)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, valid: true } : null;
}
