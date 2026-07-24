import type { Sql } from "postgres";
import * as repo from "./repository.js";

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

export async function updateMe(sql: Sql, id: string, patch: { fullName?: string; phone?: string; country?: string }) {
  await repo.updateProfile(sql, id, patch);
  return getUser(sql, id);
}

export const deleteUser = repo.deleteUser;
