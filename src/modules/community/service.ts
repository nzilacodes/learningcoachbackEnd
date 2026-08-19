import type { Sql } from "postgres";
import { NotFoundError } from "../../lib/errors.js";
import * as repo from "./repository.js";

// Ported from the frontend's client-side moderate() — moving it server-side
// closes the obvious bypass of a client that just skips the filter before posting.
const BANNED_WORDS = ["stupid", "hate", "idiot", "shut up", "burro", "idiota", "cala", "fuck", "shit", "damn"];

// Word-boundary match so e.g. "cala" doesn't flag substrings inside unrelated
// words like "escala" or "calado" — only the standalone word/phrase.
function bannedWordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

function moderate(text: string): string {
  const flagged = BANNED_WORDS.some((w) => bannedWordPattern(w).test(text));
  if (!flagged) return text;
  return BANNED_WORDS.reduce((acc, w) => acc.replace(bannedWordPattern(w), "***"), text);
}

export async function getMessages(sql: Sql, userId: string) {
  const { room } = await repo.getRoomAndNameForUser(sql, userId);
  const blockedUserIds = await repo.listBlockedUserIds(sql, userId);
  const messages = await repo.listMessages(sql, room, blockedUserIds);
  return { room, messages };
}

export async function sendMessage(sql: Sql, userId: string, content: string, kind: string) {
  const { room, displayName } = await repo.getRoomAndNameForUser(sql, userId);
  const clean = moderate(content);
  return repo.insertMessage(sql, { userId, room, displayName, content: clean, kind });
}

export async function reportMessage(sql: Sql, userId: string, messageId: string, reason?: string) {
  const { room } = await repo.getRoomAndNameForUser(sql, userId);
  if (!(await repo.messageExistsInRoom(sql, messageId, room))) {
    throw new NotFoundError("Message not found");
  }
  return repo.reportMessage(sql, { messageId, reporterId: userId, reason });
}

export async function blockUser(sql: Sql, userId: string, targetUserId: string) {
  if (userId === targetUserId) return;
  await repo.blockUser(sql, userId, targetUserId);
}

export async function unblockUser(sql: Sql, userId: string, targetUserId: string) {
  await repo.unblockUser(sql, userId, targetUserId);
}

export async function listBlockedUsers(sql: Sql, userId: string) {
  return repo.listBlockedUsers(sql, userId);
}
