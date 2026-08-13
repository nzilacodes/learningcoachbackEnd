import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import type { Sql } from "postgres";
import { env } from "../../config/env.js";
import * as repo from "./repository.js";
import { resolveLocalPath } from "./storage.js";

const execFileAsync = promisify(execFile);

const FFPROBE_BIN = env.MEDIA_FFPROBE_PATH || "ffprobe";
const FFMPEG_BIN = env.MEDIA_FFMPEG_PATH || "ffmpeg";

type ProbeResult = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

type FfprobeStream = { width?: number; height?: number; duration?: string };
type FfprobeOutput = { format?: { duration?: string }; streams?: FfprobeStream[] };

function isBinaryMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** execFile (never a shell string) — filesystem paths never get interpolated
 * into a shell command, so there's nothing to command-inject. */
async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const data = JSON.parse(stdout) as FfprobeOutput;
  const videoStream = (data.streams ?? []).find((s) => s.width && s.height);
  const durationRaw = data.format?.duration ?? videoStream?.duration;
  return {
    durationSeconds: durationRaw ? Number(durationRaw) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
  };
}

async function generateThumbnail(sourcePath: string, outPath: string, mediaType: string, midpointSeconds: number | null) {
  const args =
    mediaType === "video"
      ? ["-ss", String(Math.max(0, midpointSeconds ?? 1)), "-i", sourcePath, "-frames:v", "1", "-vf", "scale=480:-2", "-y", outPath]
      : ["-i", sourcePath, "-frames:v", "1", "-vf", "scale=480:-2", "-y", outPath];
  await execFileAsync(FFMPEG_BIN, args);
}

/**
 * Best-effort post-upload processing: extract duration/resolution and (for
 * video/image) a poster thumbnail. Runs fire-and-forget after the upload
 * response — see service.ts#uploadMedia. Two distinct failure modes:
 *  - ffmpeg/ffprobe not on PATH (ENOENT) -> not an error, just an
 *    unconfigured optional feature; asset still becomes READY.
 *  - ffprobe runs but can't make sense of the file -> genuinely FAILED,
 *    original upload is kept either way (never deleted on processing failure).
 */
export async function processAsset(sql: Sql, assetId: string): Promise<void> {
  const asset = await repo.getMediaAssetById(sql, assetId);
  if (!asset || asset.status !== "processing") return;

  const filePath = resolveLocalPath(asset.storage_key);

  let info: ProbeResult = { durationSeconds: null, width: null, height: null };
  let binaryMissing = false;

  try {
    info = await probe(filePath);
  } catch (err) {
    if (isBinaryMissing(err)) {
      binaryMissing = true;
    } else {
      await repo.markFailed(sql, assetId, "Could not read media metadata — the file may be corrupt or in an unsupported format.");
      return;
    }
  }

  let thumbnailStorageKey: string | null = null;
  if (!binaryMissing && (asset.media_type === "video" || asset.media_type === "image")) {
    const key = `${asset.owner_id}/${crypto.randomUUID()}-thumb.jpg`;
    try {
      await generateThumbnail(filePath, resolveLocalPath(key), asset.media_type, info.durationSeconds ? info.durationSeconds / 2 : null);
      thumbnailStorageKey = key;
    } catch {
      // Thumbnail generation failing (odd codec, single-frame edge cases)
      // shouldn't fail the whole asset — it's still a usable file without a preview.
    }
  }

  await repo.markReady(sql, assetId, {
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    thumbnailStorageKey,
  });
}
