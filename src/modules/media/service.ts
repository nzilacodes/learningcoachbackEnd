import type { Sql } from "postgres";
import { PassThrough, type Readable } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import type { MultipartFile } from "@fastify/multipart";
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import * as repo from "./repository.js";
import type { MediaType, MediaAssetRow, MediaPatch } from "./repository.js";
import { mediaStorage, generateStorageKey } from "./storage.js";
import { processAsset } from "./processing.js";
import type { listMediaQuerySchema } from "./schemas.js";
import type { z } from "zod";

// Magic-byte allowlist — the client-declared mimetype/extension is never
// trusted (see AUDITORIA_TECNICA.md AI-01: upload endpoints need real
// validation from day one). Deliberately narrow for v1: documents are
// PDF-only because file-type can't sniff plain text (no magic bytes), and
// trusting an unsniffable type would defeat the point of this allowlist.
const MIME_TO_TYPE: Record<string, MediaType> = {
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "audio/webm": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "document",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const MAX_MB_BY_TYPE: Record<MediaType, number> = {
  video: env.MEDIA_MAX_VIDEO_MB,
  audio: env.MEDIA_MAX_AUDIO_MB,
  image: env.MEDIA_MAX_IMAGE_MB,
  document: env.MEDIA_MAX_DOCUMENT_MB,
};

/** Ceiling passed to request.file({ limits }) before the real type (and thus
 * the real per-type limit) is known — the largest configured per-type cap. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_MB_BY_TYPE)) * 1024 * 1024;

const SNIFF_BYTES = 4100; // file-type needs at most this many bytes to identify a format

/** Peeks the first bytes of the upload stream to identify its real type by
 * magic bytes, then hands back an equivalent stream (peeked bytes + the
 * rest) for the caller to actually persist. */
async function sniffAndClassify(source: Readable): Promise<{ stream: Readable; mime: string; mediaType: MediaType }> {
  const chunks: Buffer[] = [];
  let collected = 0;
  for await (const chunk of source as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    collected += chunk.length;
    if (collected >= SNIFF_BYTES) break;
  }
  const head = Buffer.concat(chunks);
  const detected = await fileTypeFromBuffer(head);

  if (!detected || !(detected.mime in MIME_TO_TYPE)) {
    source.destroy();
    throw new ValidationError(detected ? `Unsupported file type: ${detected.mime}.` : "Could not determine the file type.");
  }

  const combined = new PassThrough();
  if (source.readableEnded) {
    combined.end(head);
  } else {
    combined.write(head);
    source.pipe(combined);
  }

  return { stream: combined, mime: detected.mime, mediaType: MIME_TO_TYPE[detected.mime]! };
}

export async function uploadMedia(sql: Sql, userId: string, filePart: MultipartFile): Promise<MediaAssetRow> {
  const { stream, mime, mediaType } = await sniffAndClassify(filePart.file);
  const storageKey = generateStorageKey(userId, EXTENSION_BY_MIME[mime] ?? "");
  const { bytesWritten } = await mediaStorage.write(storageKey, stream);

  if (filePart.file.truncated) {
    await mediaStorage.delete(storageKey);
    throw new ValidationError("File exceeds the maximum upload size.");
  }
  const maxBytes = MAX_MB_BY_TYPE[mediaType] * 1024 * 1024;
  if (bytesWritten > maxBytes) {
    await mediaStorage.delete(storageKey);
    throw new ValidationError(`File exceeds the ${mediaType} size limit (${MAX_MB_BY_TYPE[mediaType]} MB).`);
  }

  const asset = await repo.insertMediaAsset(sql, {
    ownerId: userId,
    mediaType,
    mimeType: mime,
    originalFilename: filePart.filename,
    storageKey,
    sizeBytes: bytesWritten,
  });

  // Fire-and-forget: the upload response doesn't wait on ffmpeg/ffprobe. Any
  // process crash before this resolves is caught later by
  // reconcileStuckProcessing() at the next boot.
  void processAsset(sql, asset.id).catch((err) => {
    console.error(`[media] processing failed unexpectedly for ${asset.id}`, err);
  });

  return asset;
}

export async function isUserAdmin(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ role: string }[]>`SELECT role FROM public.user_roles WHERE user_id = ${userId} AND role = 'admin'`;
  return rows.length > 0;
}

async function requireOwnedOrAdmin(sql: Sql, userId: string, isAdmin: boolean, id: string): Promise<MediaAssetRow> {
  const asset = await repo.getMediaAssetById(sql, id);
  if (!asset || asset.deleted_at) throw new NotFoundError("Media not found");
  if (asset.owner_id !== userId && !isAdmin) throw new ForbiddenError("You don't own this media");
  return asset;
}

async function requireCourseExists(sql: Sql, id: string) {
  const rows = await sql`SELECT 1 FROM public.courses WHERE id = ${id}`;
  if (rows.length === 0) throw new NotFoundError("Course not found");
}
async function requireUnitExists(sql: Sql, id: string) {
  const rows = await sql`SELECT 1 FROM public.units WHERE id = ${id}`;
  if (rows.length === 0) throw new NotFoundError("Unit not found");
}
async function requireLessonExists(sql: Sql, id: string) {
  const rows = await sql`SELECT 1 FROM public.lessons WHERE id = ${id}`;
  if (rows.length === 0) throw new NotFoundError("Lesson not found");
}
/** Sharing media with a whole class is a class-owner action (mirrors
 * requireOwnedClass in modules/classes/service.ts) — a student who merely
 * joined a class shouldn't be able to broadcast media to its other members. */
async function requireOwnedClass(sql: Sql, userId: string, classId: string) {
  const rows = await sql<{ owner_id: string }[]>`SELECT owner_id FROM public.classes WHERE id = ${classId}`;
  if (rows.length === 0) throw new NotFoundError("Class not found");
  if (rows[0]!.owner_id !== userId) throw new ForbiddenError("You don't own this class");
}

export async function updateMedia(sql: Sql, userId: string, isAdmin: boolean, id: string, patch: MediaPatch): Promise<MediaAssetRow> {
  await requireOwnedOrAdmin(sql, userId, isAdmin, id);
  if (patch.courseId) await requireCourseExists(sql, patch.courseId);
  if (patch.unitId) await requireUnitExists(sql, patch.unitId);
  if (patch.lessonId) await requireLessonExists(sql, patch.lessonId);
  if (patch.classId) await requireOwnedClass(sql, userId, patch.classId);

  const updated = await repo.updateMediaAsset(sql, id, patch);
  if (!updated) throw new NotFoundError("Media not found");
  return updated;
}

async function getMemberClassIds(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ class_id: string }[]>`SELECT class_id FROM public.class_members WHERE student_id = ${userId}`;
  return rows.map((r) => r.class_id);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}
function decodeCursor(raw?: string): { createdAt: string; id: string } | undefined {
  if (!raw) return undefined;
  try {
    const [createdAt, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    return createdAt && id ? { createdAt, id } : undefined;
  } catch {
    return undefined;
  }
}

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

export async function listMedia(sql: Sql, userId: string, isAdmin: boolean, q: ListMediaQuery) {
  const cursor = decodeCursor(q.cursor);
  const includeAll = q.scope === "all" && isAdmin;

  const rows = q.trashed
    ? await repo.listTrashedMedia(sql, { requesterId: userId, includeAll, cursor, limit: q.limit + 1 })
    : await repo.listOwnedOrVisibleMedia(sql, {
        requesterId: userId,
        includeAll,
        type: q.type,
        search: q.search,
        tag: q.tag,
        courseId: q.courseId,
        unitId: q.unitId,
        lessonId: q.lessonId,
        memberClassIds: await getMemberClassIds(sql, userId),
        cursor,
        limit: q.limit + 1,
      });

  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;
  return { items, nextCursor };
}

async function assertVisible(sql: Sql, userId: string, isAdmin: boolean, asset: MediaAssetRow) {
  if (asset.owner_id === userId || isAdmin) return;
  // Not-yet-ready and private assets don't exist as far as anyone else is
  // concerned — 404, not 403, so a private asset's existence isn't leaked.
  if (asset.status !== "ready") throw new NotFoundError("Media not found");
  if (asset.visibility === "public") return;
  if (asset.visibility === "class" && asset.class_id) {
    const rows = await sql`SELECT 1 FROM public.class_members WHERE class_id = ${asset.class_id} AND student_id = ${userId}`;
    if (rows.length > 0) return;
  }
  throw new NotFoundError("Media not found");
}

export async function getMediaAsset(sql: Sql, userId: string, isAdmin: boolean, id: string): Promise<MediaAssetRow> {
  const asset = await repo.getMediaAssetById(sql, id);
  if (!asset || asset.deleted_at) throw new NotFoundError("Media not found");
  await assertVisible(sql, userId, isAdmin, asset);
  return asset;
}

export async function getStreamableFile(sql: Sql, userId: string, isAdmin: boolean, id: string, kind: "original" | "thumbnail") {
  const asset = await getMediaAsset(sql, userId, isAdmin, id);
  const key = kind === "thumbnail" ? asset.thumbnail_storage_key : asset.storage_key;
  if (!key) throw new NotFoundError("Not available");
  return { key, mimeType: kind === "thumbnail" ? "image/jpeg" : asset.mime_type, sizeBytes: Number(asset.size_bytes) };
}

export async function deleteMedia(sql: Sql, userId: string, isAdmin: boolean, id: string) {
  await requireOwnedOrAdmin(sql, userId, isAdmin, id);
  const deleted = await repo.softDeleteMediaAsset(sql, id);
  if (!deleted) throw new NotFoundError("Media not found");
  return deleted;
}

export async function restoreMedia(sql: Sql, userId: string, isAdmin: boolean, id: string) {
  const asset = await repo.getMediaAssetById(sql, id);
  if (!asset || !asset.deleted_at) throw new NotFoundError("Media not found");
  if (asset.owner_id !== userId && !isAdmin) throw new ForbiddenError("You don't own this media");

  const retentionMs = env.MEDIA_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(asset.deleted_at).getTime() > retentionMs) {
    throw new ConflictError("This item's retention window has expired and can no longer be restored.");
  }
  const restored = await repo.restoreMediaAsset(sql, id);
  if (!restored) throw new NotFoundError("Media not found");
  return restored;
}

export async function purgeMedia(sql: Sql, userId: string, isAdmin: boolean, id: string) {
  const asset = await repo.getMediaAssetById(sql, id);
  if (!asset) throw new NotFoundError("Media not found");
  const isOwner = asset.owner_id === userId;
  if (!isAdmin && !(isOwner && asset.deleted_at)) {
    throw new ForbiddenError(isOwner ? "Move this to trash before deleting it permanently." : "You don't own this media");
  }
  await mediaStorage.delete(asset.storage_key);
  if (asset.thumbnail_storage_key) await mediaStorage.delete(asset.thumbnail_storage_key);
  await repo.deleteMediaAssetRow(sql, id);
}

export async function getStorageSummary(sql: Sql, userId: string) {
  return repo.getStorageSummary(sql, userId);
}
