import { mkdir, writeFile } from "node:fs/promises";
import { fal } from "@fal-ai/client";
import {
  FAL_KEY,
  SEEDANCE_MODEL,
  HOOK_DURATION_SECONDS,
  HOOK_RESOLUTION,
  VIDEO_ASPECT_RATIO,
} from "../config.js";

fal.config({ credentials: FAL_KEY });

export interface GenerateHookInput {
  prompt: string;
  duration?: number;
  resolution?: "480p" | "720p";
  seed?: number;
}

export interface GenerateHookOutput {
  hookPath: string;
  hookUrl: string;
  hookFilename: string;
  seed: number;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
}

export async function generateHookVideo(
  input: GenerateHookInput,
  videosDir: string
): Promise<GenerateHookOutput> {
  const aspect_ratio = VIDEO_ASPECT_RATIO;
  const resolution = input.resolution ?? HOOK_RESOLUTION;
  const duration = input.duration ?? HOOK_DURATION_SECONDS;

  const result = await fal.subscribe(SEEDANCE_MODEL, {
    input: {
      prompt: input.prompt,
      aspect_ratio,
      resolution,
      duration: String(duration),
      generate_audio: false,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        const last = update.logs?.at(-1)?.message;
        if (last) console.log(`    ↪ ${last}`);
      } else {
        console.log(`    ↪ status=${update.status}`);
      }
    },
  });

  const data = (result as any).data ?? result;
  const videoUrl: string | undefined = data?.video?.url;
  const seed: number = data?.seed ?? 0;
  if (!videoUrl) {
    throw new Error(`Seedance returned no video url. Raw: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const hookDir = `${videosDir}hooks/`;
  await mkdir(hookDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stamp}.mp4`;
  const hookPath = `${hookDir}${filename}`;

  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Hook download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(hookPath, buf);

  return {
    hookPath,
    hookUrl: videoUrl,
    hookFilename: filename,
    seed,
    durationSeconds: duration,
    aspectRatio: aspect_ratio,
    resolution,
  };
}
