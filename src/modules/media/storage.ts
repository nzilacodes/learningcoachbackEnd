import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import crypto from "node:crypto";
import { env } from "../../config/env.js";

export type ByteRange = { start: number; end: number };

/**
 * Storage backend contract for media files. LocalDiskStorage (below) is the
 * only implementation today — swapping to an S3-compatible bucket later
 * means writing a new class against this interface, without touching
 * service.ts/routes.ts/processing.ts at all.
 */
export interface MediaStorage {
  write(key: string, source: Readable): Promise<{ bytesWritten: number }>;
  readStream(key: string, range?: ByteRange): Readable;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const STORAGE_ROOT = path.resolve(env.MEDIA_STORAGE_ROOT);

function resolveKey(key: string): string {
  const full = path.resolve(STORAGE_ROOT, key);
  // Keys are always server-generated (see generateStorageKey below), never
  // derived from a client-supplied filename — this containment check is a
  // cheap second line of defense against path traversal, not the primary one.
  if (full !== STORAGE_ROOT && !full.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error(`Refusing to resolve storage key outside root: ${key}`);
  }
  return full;
}

/**
 * Local-disk-only escape hatch for code that genuinely needs a real
 * filesystem path (ffmpeg/ffprobe invocation in processing.ts). Not part of
 * the MediaStorage interface on purpose — an S3-backed implementation
 * wouldn't have one, and processing.ts would need to download to a temp file
 * first. That rework is out of scope while storage is local disk.
 */
export function resolveLocalPath(key: string): string {
  return resolveKey(key);
}

export class LocalDiskStorage implements MediaStorage {
  async write(key: string, source: Readable): Promise<{ bytesWritten: number }> {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(source, createWriteStream(full));
    const st = await stat(full);
    return { bytesWritten: st.size };
  }

  readStream(key: string, range?: ByteRange): Readable {
    const full = resolveKey(key);
    return range ? createReadStream(full, { start: range.start, end: range.end }) : createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const mediaStorage: MediaStorage = new LocalDiskStorage();

/**
 * Owner-namespaced, random, extension-preserving storage key — never derived
 * from the client-supplied filename (prevents path traversal, collisions,
 * and leaking the original filename into the storage path).
 */
export function generateStorageKey(ownerId: string, ext: string): string {
  const id = crypto.randomUUID();
  return `${ownerId}/${id}${ext ? `.${ext}` : ""}`;
}
