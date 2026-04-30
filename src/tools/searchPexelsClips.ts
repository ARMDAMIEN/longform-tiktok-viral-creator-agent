import { PEXELS_API_KEY } from "../config.js";

export interface PexelsClipCandidate {
  id: number;
  durationSec: number;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  url: string;            // pexels page url (for attribution)
  user: { name: string; url: string };
  // best file pick for our render needs (mp4, hd-ish)
  fileUrl: string;
  fileWidth: number;
  fileHeight: number;
  fileQuality: string;
}

export interface SearchPexelsInput {
  query: string;
  perPage?: number;
  orientation?: "portrait" | "landscape" | "square";
}

export interface SearchPexelsOutput {
  query: string;
  candidates: PexelsClipCandidate[];
}

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}
interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  user: { name: string; url: string };
  url: string;
  video_files: PexelsVideoFile[];
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  // Prefer mp4 hd <= 1280px on the long edge to keep render fast and small.
  const mp4 = files.filter((f) => f.file_type === "video/mp4");
  if (mp4.length === 0) return undefined;
  const ranked = [...mp4].sort((a, b) => {
    const aLong = Math.max(a.width, a.height);
    const bLong = Math.max(b.width, b.height);
    const aScore = aLong > 1920 ? 1920 - (aLong - 1920) : aLong;
    const bScore = bLong > 1920 ? 1920 - (bLong - 1920) : bLong;
    return bScore - aScore;
  });
  return ranked[0];
}

export async function searchPexelsClips(input: SearchPexelsInput): Promise<SearchPexelsOutput> {
  if (!PEXELS_API_KEY) throw new Error("PEXELS_API_KEY not set in .env.");
  const params = new URLSearchParams({
    query: input.query,
    per_page: String(input.perPage ?? 10),
    orientation: input.orientation ?? "portrait",
  });
  const res = await fetch(`https://api.pexels.com/videos/search?${params.toString()}`, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`Pexels search failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { videos: PexelsVideo[] };

  const candidates: PexelsClipCandidate[] = (data.videos ?? []).flatMap((v) => {
    const file = pickBestFile(v.video_files);
    if (!file) return [];
    const orientation: PexelsClipCandidate["orientation"] =
      v.height > v.width ? "portrait" : v.width > v.height ? "landscape" : "square";
    return [{
      id: v.id,
      durationSec: v.duration,
      width: v.width,
      height: v.height,
      orientation,
      url: v.url,
      user: v.user,
      fileUrl: file.link,
      fileWidth: file.width,
      fileHeight: file.height,
      fileQuality: file.quality,
    }];
  });

  return { query: input.query, candidates };
}
