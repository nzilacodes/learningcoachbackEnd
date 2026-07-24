import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCachedWord(db: SupabaseClient, word: string) {
  const { data, error } = await db.from("word_entries").select("*").eq("word", word).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertWord(db: SupabaseClient, row: Record<string, unknown>) {
  const { data, error } = await db.from("word_entries").upsert(row, { onConflict: "word" }).select("*").single();
  if (error) throw error;
  return data;
}
