import type { Sql } from "postgres";
import crypto from "node:crypto";
import * as repo from "./repository.js";

class NotFoundError extends Error {
  statusCode = 404;
}
class ForbiddenError extends Error {
  statusCode = 403;
}
class ConflictError extends Error {
  statusCode = 409;
}

// 6 base36 chars ~ 2.1 billion combinations — same "generate once, don't
// bother with collision retries" trust level as generateActivationCode()
// in billing/service.ts.
function generateInviteCode(): string {
  return crypto
    .randomInt(0, 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0");
}

export async function createClass(sql: Sql, ownerId: string, name: string) {
  return repo.createClass(sql, ownerId, name, generateInviteCode());
}

export async function listMyClasses(sql: Sql, userId: string) {
  const [owned, joined] = await Promise.all([
    repo.listOwnedClasses(sql, userId),
    repo.listJoinedClasses(sql, userId),
  ]);
  return { owned, joined };
}

export async function joinClass(sql: Sql, userId: string, inviteCode: string) {
  const cls = await repo.getClassByInviteCode(sql, inviteCode.trim().toUpperCase());
  if (!cls) throw new NotFoundError("Invalid invite code");
  if (cls.owner_id === userId) throw new ConflictError("You own this class");
  await repo.addMember(sql, cls.id, userId);
  return { id: cls.id, name: cls.name };
}

async function requireOwnedClass(sql: Sql, userId: string, classId: string) {
  const cls = await repo.getClassById(sql, classId);
  if (!cls) throw new NotFoundError("Class not found");
  if (cls.owner_id !== userId) throw new ForbiddenError("You don't own this class");
  return cls;
}

export async function getRoster(sql: Sql, userId: string, classId: string) {
  await requireOwnedClass(sql, userId, classId);
  return repo.getRoster(sql, classId);
}

export async function removeMember(sql: Sql, userId: string, classId: string, studentId: string) {
  await requireOwnedClass(sql, userId, classId);
  await repo.removeMember(sql, classId, studentId);
}

export async function leaveClass(sql: Sql, userId: string, classId: string) {
  const cls = await repo.getClassById(sql, classId);
  if (!cls) throw new NotFoundError("Class not found");
  if (cls.owner_id === userId) throw new ConflictError("Class owners can't leave their own class — delete it instead");
  await repo.removeMember(sql, classId, userId);
}

export async function deleteClassAsOwner(sql: Sql, userId: string, classId: string) {
  await requireOwnedClass(sql, userId, classId);
  await repo.deleteClass(sql, classId);
}
