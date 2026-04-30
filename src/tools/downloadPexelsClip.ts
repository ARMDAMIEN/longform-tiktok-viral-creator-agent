import { mkdir, writeFile, stat } from "node:fs/promises";

export interface DownloadPexelsInput {
  pexelsId: number;
  fileUrl: string;
  pageUrl: string;
  authorName: string;
  authorUrl: string;
}

export interface DownloadPexelsOutput {
  clipPath: string;
  pexelsId: number;
  pageUrl: string;
  authorName: string;
  authorUrl: string;
  bytes: number;
  fromCache: boolean;
}

export async function downloadPexelsClip(
  input: DownloadPexelsInput,
  clipsDir: string
): Promise<DownloadPexelsOutput> {
  await mkdir(clipsDir, { recursive: true });
  const clipPath = `${clipsDir}pexels-${input.pexelsId}.mp4`;

  let fromCache = false;
  let bytes = 0;
  try {
    const s = await stat(clipPath);
    if (s.size > 0) {
      bytes = s.size;
      fromCache = true;
    }
  } catch {
    /* not cached */
  }

  if (!fromCache) {
    const res = await fetch(input.fileUrl);
    if (!res.ok) throw new Error(`Pexels clip download failed: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(clipPath, buf);
    bytes = buf.byteLength;
  }

  return {
    clipPath,
    pexelsId: input.pexelsId,
    pageUrl: input.pageUrl,
    authorName: input.authorName,
    authorUrl: input.authorUrl,
    bytes,
    fromCache,
  };
}
