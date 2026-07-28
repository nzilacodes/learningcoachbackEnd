import type { Sql } from "postgres";
import * as repo from "./repository.js";

// Ported from the frontend's client-side moderate() — moving it server-side
// closes the obvious bypass of a client that just skips the filter before posting.
const BANNED_WORDS = ["stupid", "hate", "idiot", "shut up", "burro", "idiota", "cala", "fuck", "shit", "damn"];

function moderate(text: string): string {
  const lower = text.toLowerCase();
  const flagged = BANNED_WORDS.some((w) => lower.includes(w));
  if (!flagged) return text;
  return BANNED_WORDS.reduce((acc, w) => acc.replace(new RegExp(w, "gi"), "***"), text);
}

export async function getMessages(sql: Sql, userId: string) {
  const { room } = await repo.getRoomAndNameForUser(sql, userId);
  const messages = await repo.listMessages(sql, room);
  return { room, messages };
}

export async function sendMessage(sql: Sql, userId: string, content: string, kind: string) {
  const { room, displayName } = await repo.getRoomAndNameForUser(sql, userId);
  const clean = moderate(content);
  return repo.insertMessage(sql, { userId, room, displayName, content: clean, kind });
}
