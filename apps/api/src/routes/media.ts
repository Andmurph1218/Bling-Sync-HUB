import fs from 'node:fs';
import path from 'node:path';
import { Request, Response, Router } from 'express';

export const mediaRouter = Router();

const SAFE_MEDIA_FILENAME = /^([0-9a-f]{64})\.(jpg|jpeg|png|webp)$/;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function getMediaStorageDir(): string {
  const custom = (process.env.MEDIA_STORAGE_DIR ?? '').trim();
  if (custom) return path.resolve(custom);
  return path.resolve(process.cwd(), 'data/media');
}

export function extFromImageFormat(format: string | null | undefined): 'jpg' | 'png' | 'webp' {
  const lower = (format ?? '').toLowerCase();
  if (lower === 'png') return 'png';
  if (lower === 'webp') return 'webp';
  return 'jpg';
}

export function mediaRelativePath(sha256Hash: string, format: string | null | undefined): string {
  return `/api/media/${sha256Hash}.${extFromImageFormat(format)}`;
}

export async function persistCachedMediaFile(
  sha256Hash: string,
  format: 'jpeg' | 'png' | 'webp',
  buffer: Buffer
): Promise<string> {
  const dir = getMediaStorageDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `${sha256Hash}.${extFromImageFormat(format)}`;
  const target = path.join(dir, filename);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmp, buffer);
    await fs.promises.rename(tmp, target).catch(async () => {
      await fs.promises.unlink(tmp).catch(() => undefined);
    });
  }
  return `/api/media/${filename}`;
}

mediaRouter.get('/api/media/:filename', async (req: Request, res: Response) => {
  const match = SAFE_MEDIA_FILENAME.exec(req.params.filename ?? '');
  if (!match) {
    res.status(404).end();
    return;
  }
  const [, hash, ext] = match;
  const dir = getMediaStorageDir();
  const candidates = ext === 'jpg' || ext === 'jpeg'
    ? [`${hash}.jpg`, `${hash}.jpeg`, `${hash}.webp`, `${hash}.png`]
    : [`${hash}.${ext}`];

  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) {
      const actualExt = candidate.split('.').pop() ?? 'jpg';
      res.setHeader('Content-Type', MIME_BY_EXT[actualExt] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(full).pipe(res);
      return;
    }
  }
  res.status(404).end();
});
