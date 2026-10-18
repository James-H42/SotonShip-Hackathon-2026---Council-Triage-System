import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// Magic numbers, so a renamed non-image file is rejected.
function sniff(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  return null;
}

export type SavedPhoto = { fileName: string; mime: string; bytes: number; sha256: string };

export class UploadError extends Error {}

export async function savePhotos(files: File[]): Promise<SavedPhoto[]> {
  const { maxFiles, maxBytes } = config.uploads;
  const images = files.filter((f) => f.size > 0);
  if (images.length > maxFiles) throw new UploadError(`You can attach up to ${maxFiles} photos.`);
  const dir = path.join(config.uploadDir, "resident");
  await fs.mkdir(dir, { recursive: true });
  const saved: SavedPhoto[] = [];
  for (const file of images) {
    if (file.size > maxBytes) throw new UploadError(`Each photo must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime || !config.uploads.mimeTypes.includes(mime)) throw new UploadError("Photos must be JPEG, PNG, WebP or GIF images.");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const fileName = `resident/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${EXT[mime]}`;
    await fs.writeFile(path.join(config.uploadDir, fileName), bytes);
    saved.push({ fileName, mime, bytes: bytes.length, sha256 });
  }
  return saved;
}

export async function removePhotos(photos: SavedPhoto[]) {
  await Promise.allSettled(photos.map((p) => fs.unlink(path.join(config.uploadDir, p.fileName))));
}

export function photoPath(fileName: string): string | null {
  const full = path.resolve(config.uploadDir, fileName);
  // Never serve anything outside the upload directory.
  return full.startsWith(path.resolve(config.uploadDir) + path.sep) ? full : null;
}
