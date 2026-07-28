import type { Sql } from "postgres";
import * as repo from "./repository.js";
import { getMe } from "../auth/service.js";

class NotFoundError extends Error {
  statusCode = 404;
}

export const listUsers = repo.listUsers;

export async function getUser(sql: Sql, id: string) {
  const user = await repo.getUserDetail(sql, id);
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export async function updateUser(
  sql: Sql,
  id: string,
  patch: { fullName?: string; phone?: string; country?: string; roles?: string[] },
) {
  const { roles, ...profilePatch } = patch;
  if (Object.values(profilePatch).some((v) => v !== undefined)) {
    await repo.updateProfile(sql, id, profilePatch);
  }
  if (roles) await repo.replaceRoles(sql, id, roles);
  return getUser(sql, id);
}

export async function updateMe(sql: Sql, id: string, patch: repo.ProfilePatch) {
  await repo.updateProfile(sql, id, patch);
  // Return the same AuthUser shape GET /v1/me uses, not the admin-detail shape —
  // callers (e.g. onboarding) treat PATCH /v1/me's response like a fresh /v1/me.
  return getMe(sql, id);
}

export const deleteUser = repo.deleteUser;
