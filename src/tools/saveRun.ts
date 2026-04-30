import { mkdir, writeFile } from "node:fs/promises";

export interface RunClipSnapshot {
  source: "seedance-hook" | "pexels";
  durationSec: number;
  // hook
  seedancePrompt?: string;
  // pexels
  pexelsId?: number;
  pexelsPageUrl?: string;
  pexelsAuthorName?: string;
  pexelsAuthorUrl?: string;
  query?: string;
  localPath: string;
}

export interface RunSegmentSnapshot {
  index: number;
  startSec: number;
  durationSec: number;
  voiceText: string;
  clips: RunClipSnapshot[];
}

export interface RunSnapshot {
  channel: string;
  title: string;
  description: string;
  sourceYoutubeUrl: string;
  scriptText: string;
  hookSeedancePrompt: string;
  segments: RunSegmentSnapshot[];
  audioPath: string;
  htmlPath: string;
  videoPath: string;
  videoUrl: string;
  totalDurationSec: number;
  aspectRatio: string;
  hookSeed: number;
  analysis: string;
}

export async function saveRun(
  snapshot: RunSnapshot,
  runsDir: string
): Promise<{ runPath: string }> {
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = `${runsDir}${stamp}.json`;
  const payload = { run_at: new Date().toISOString(), ...snapshot };
  await writeFile(runPath, JSON.stringify(payload, null, 2), "utf8");
  return { runPath };
}
