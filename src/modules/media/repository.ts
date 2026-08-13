import type { Sql } from "postgres";

export type MediaType = "video" | "audio" | "image" | "document";
export type MediaStatus = "uploading" | "processing" | "ready" | "failed";
export type MediaVisibility = "private" | "class" | "public";

export type MediaAssetRow = {
  id: string;
  owner_id: string;
  media_type: MediaType;
  mime_type: string;
  original_filename: string;
  storage_key: string;
  thumbnail_storage_key: string | null;
  size_bytes: string; // BIGINT comes back as a string from postgres.js
  duration_seconds: string | null;
  width: number | null;
  height: number | null;
  status: MediaStatus;
  processing_error: string | null;
  title: string | null;
  tags: string[];
  visibility: MediaVisibility;
  class_id: string | null;
  course_id: string | null;
  unit_id: string | null;
  lesson_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertMediaAsset(
  sql: Sql,
  row: {
    ownerId: string;
    mediaType: MediaType;
    mimeType: string;
    originalFilename: string;
    storageKey: string;
    sizeBytes: number;
  },
) {
  const [saved] = await sql<MediaAssetRow[]>`
    INSERT INTO public.media_assets (owner_id, media_type, mime_type, original_filename, storage_key, size_bytes, status)
    VALUES (${row.ownerId}, ${row.mediaType}, ${row.mimeType}, ${row.originalFilename}, ${row.storageKey}, ${row.sizeBytes}, 'processing')
    RETURNING *
  `;
  return saved!;
}

export async function getMediaAssetById(sql: Sql, id: string) {
  const rows = await sql<MediaAssetRow[]>`SELECT * FROM public.media_assets WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function markReady(
  sql: Sql,
  id: string,
  info: { durationSeconds: number | null; width: number | null; height: number | null; thumbnailStorageKey: string | null },
) {
  await sql`
    UPDATE public.media_assets SET
      status = 'ready',
      processing_error = NULL,
      duration_seconds = ${info.durationSeconds},
      width = ${info.width},
      height = ${info.height},
      thumbnail_storage_key = ${info.thumbnailStorageKey},
      updated_at = now()
    WHERE id = ${id}
  `;
}

export async function markFailed(sql: Sql, id: string, message: string) {
  await sql`UPDATE public.media_assets SET status = 'failed', processing_error = ${message}, updated_at = now() WHERE id = ${id}`;
}

/** Assets left in 'processing' past this age mean the process restarted or
 * crashed mid-job (there's no job queue to retry them) — called once at boot. */
export async function reconcileStuckProcessing(sql: Sql) {
  const rows = await sql<{ id: string }[]>`
    UPDATE public.media_assets
    SET status = 'failed', processing_error = 'Processing was interrupted by a server restart.', updated_at = now()
    WHERE status = 'processing' AND updated_at < now() - interval '1 hour'
    RETURNING id
  `;
  return rows.length;
}

export type MediaPatch = {
  title?: string | null;
  tags?: string[];
  visibility?: MediaVisibility;
  classId?: string | null;
  courseId?: string | null;
  unitId?: string | null;
  lessonId?: string | null;
};

export async function updateMediaAsset(sql: Sql, id: string, patch: MediaPatch) {
  const rows = await sql<MediaAssetRow[]>`
    UPDATE public.media_assets SET
      title = ${patch.title !== undefined ? patch.title : sql`title`},
      tags = ${patch.tags !== undefined ? patch.tags : sql`tags`},
      visibility = ${patch.visibility !== undefined ? patch.visibility : sql`visibility`},
      class_id = ${patch.classId !== undefined ? patch.classId : sql`class_id`},
      course_id = ${patch.courseId !== undefined ? patch.courseId : sql`course_id`},
      unit_id = ${patch.unitId !== undefined ? patch.unitId : sql`unit_id`},
      lesson_id = ${patch.lessonId !== undefined ? patch.lessonId : sql`lesson_id`},
      updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING *
  `;
  return rows[0] ?? null;
}

export type ListOwnedOrVisibleFilters = {
  requesterId: string;
  includeAll: boolean; // admin scope=all
  type?: MediaType;
  search?: string;
  tag?: string;
  courseId?: string;
  unitId?: string;
  lessonId?: string;
  memberClassIds: string[];
  cursor?: { createdAt: string; id: string };
  limit: number;
};

/** Everything the requester owns (any status) plus other people's READY
 * assets they're allowed to see (public, or class-visible to a class they
 * belong to) — or, for admins with scope=all, everything not in the trash. */
export async function listOwnedOrVisibleMedia(sql: Sql, f: ListOwnedOrVisibleFilters) {
  return sql<MediaAssetRow[]>`
    SELECT * FROM public.media_assets
    WHERE deleted_at IS NULL
      AND (
        ${f.includeAll}
        OR owner_id = ${f.requesterId}
        OR (status = 'ready' AND (
          visibility = 'public'
          OR (visibility = 'class' AND class_id = ANY(${f.memberClassIds}))
        ))
      )
      ${f.type ? sql`AND media_type = ${f.type}` : sql``}
      ${f.search ? sql`AND title ILIKE ${"%" + f.search + "%"}` : sql``}
      ${f.tag ? sql`AND ${f.tag} = ANY(tags)` : sql``}
      ${f.courseId ? sql`AND course_id = ${f.courseId}` : sql``}
      ${f.unitId ? sql`AND unit_id = ${f.unitId}` : sql``}
      ${f.lessonId ? sql`AND lesson_id = ${f.lessonId}` : sql``}
      ${f.cursor ? sql`AND (created_at, id) < (${f.cursor.createdAt}, ${f.cursor.id})` : sql``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${f.limit}
  `;
}

/** Trash is never publicly browsable — owner's own trash, or every user's
 * trash for an admin with scope=all. */
export async function listTrashedMedia(
  sql: Sql,
  f: { requesterId: string; includeAll: boolean; cursor?: { createdAt: string; id: string }; limit: number },
) {
  return sql<MediaAssetRow[]>`
    SELECT * FROM public.media_assets
    WHERE deleted_at IS NOT NULL
      AND (${f.includeAll} OR owner_id = ${f.requesterId})
      ${f.cursor ? sql`AND (created_at, id) < (${f.cursor.createdAt}, ${f.cursor.id})` : sql``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${f.limit}
  `;
}

export async function softDeleteMediaAsset(sql: Sql, id: string) {
  const rows = await sql<MediaAssetRow[]>`
    UPDATE public.media_assets SET deleted_at = now(), updated_at = now() WHERE id = ${id} AND deleted_at IS NULL RETURNING *
  `;
  return rows[0] ?? null;
}

export async function restoreMediaAsset(sql: Sql, id: string) {
  const rows = await sql<MediaAssetRow[]>`
    UPDATE public.media_assets SET deleted_at = NULL, updated_at = now() WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING *
  `;
  return rows[0] ?? null;
}

export async function deleteMediaAssetRow(sql: Sql, id: string) {
  await sql`DELETE FROM public.media_assets WHERE id = ${id}`;
}

export type StorageSummaryRow = { media_type: MediaType; count: string; total_bytes: string };

export async function getStorageSummary(sql: Sql, ownerId: string) {
  const byType = await sql<StorageSummaryRow[]>`
    SELECT media_type, count(*)::text AS count, COALESCE(sum(size_bytes), 0)::text AS total_bytes
    FROM public.media_assets
    WHERE owner_id = ${ownerId} AND deleted_at IS NULL
    GROUP BY media_type
  `;
  const [totals] = await sql<{ processing: string; trashed: string }[]>`
    SELECT
      count(*) FILTER (WHERE deleted_at IS NULL AND status IN ('uploading', 'processing'))::text AS processing,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS trashed
    FROM public.media_assets
    WHERE owner_id = ${ownerId}
  `;
  return { byType, processing: Number(totals?.processing ?? 0), trashed: Number(totals?.trashed ?? 0) };
}
