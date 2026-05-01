import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve as resolvePath, basename } from "node:path";
import { RENDER_WIDTH, RENDER_HEIGHT, RENDER_FPS, PROJECT_ROOT } from "../config.js";

export interface RenderClipInput {
  videoPath: string;
  durationSec: number;
}

export interface RenderSegmentInput {
  startSec: number;
  durationSec: number;
  text?: string;
  clips: RenderClipInput[];
}

export interface RenderVideoInput {
  audioPath: string;
  totalDurationSec: number;
  segments: RenderSegmentInput[];
  compositionsDir: string;
  videosDir: string;
}

export interface RenderVideoOutput {
  htmlPath: string;
  projectDir: string;
  videoPath: string;
  totalDurationSec: number;
}

interface FlatClip {
  index: number;
  startSec: number;
  durationSec: number;
  videoAsset: string;
  // Ken Burns: alternate in/out per clip for visual variety
  zoomDirection: "in" | "out";
}

interface FlatCaption {
  index: number;
  startSec: number;
  durationSec: number;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Round to 3 decimals to avoid FP precision artifacts in HF lint.
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildIndexHtml(opts: {
  width: number;
  height: number;
  totalDurationSec: number;
  audioAsset: string;
  clips: FlatClip[];
  captions: FlatCaption[];
}): string {
  const { width, height, totalDurationSec, audioAsset, clips, captions } = opts;

  const videoEls = clips
    .map((c) => {
      const src = escapeHtml(`assets/${c.videoAsset}`);
      return `      <video id="clip-${c.index}" class="clip" data-start="${r3(c.startSec)}" data-duration="${r3(c.durationSec)}" data-track-index="0" src="${src}" muted playsinline preload="auto"></video>`;
    })
    .join("\n");

  const captionEls = captions
    .map((cap) => {
      const text = escapeHtml(cap.text.trim().toUpperCase());
      return `      <div id="cap-${cap.index}" class="clip caption" data-start="${r3(cap.startSec)}" data-duration="${r3(cap.durationSec)}" data-track-index="2"><span>${text}</span></div>`;
    })
    .join("\n");

  // Ken Burns timeline: each clip scales subtly over its visible window.
  // We avoid touching opacity (HF runtime handles visibility via .clip class).
  const tlLines = clips
    .map((c) => {
      const from = c.zoomDirection === "in" ? 1.0 : 1.06;
      const to = c.zoomDirection === "in" ? 1.06 : 1.0;
      return `      tl.fromTo("#clip-${c.index} > video, video#clip-${c.index}", { transformOrigin: "50% 50%", scale: ${from} }, { scale: ${to}, duration: ${r3(c.durationSec)}, ease: "none" }, ${r3(c.startSec)});`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; font-family: "Helvetica Neue", Arial, sans-serif; }
      #root { position: relative; width: 100%; height: 100%; background: #000; }
      video.clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; will-change: transform; }
      .clip.caption { background: transparent; position: absolute; left: 5%; right: 5%; bottom: 18%; text-align: center; pointer-events: none; }
      .caption span {
        display: inline-block;
        padding: 14px 22px;
        background: rgba(0,0,0,0.55);
        border-radius: 8px;
        color: #fff;
        font-weight: 800;
        font-size: 56px;
        line-height: 1.15;
        letter-spacing: 0.5px;
        text-shadow: 0 4px 20px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9);
        animation: capIn 0.25s ease-out both;
      }
      @keyframes capIn {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: none; }
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${r3(totalDurationSec)}" data-width="${width}" data-height="${height}">
${videoEls}
      <audio id="voice" data-start="0" data-duration="${r3(totalDurationSec)}" data-track-index="1" data-volume="1.0" src="assets/${escapeHtml(audioAsset)}"></audio>
${captionEls}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tlLines}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))
    );
  });
}

// Re-encode a video to Chrome-friendly h264:
// - drops timecode/data/subtitle streams (Pexels mp4s often carry tmcd, which Chrome rejects)
// - normalizes to 30fps with keyframe every 1s (fixes sparse-keyframe seek failures)
// - strips audio (we use a separate ElevenLabs track)
// - faststart so moov atom is at the front
async function normalizeVideo(input: string, output: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", input,
    "-map", "0:v:0",
    "-map", "-0:d",
    "-an", "-sn", "-dn",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-r", "30",
    "-g", "30",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    "-movflags", "+faststart",
    "-pix_fmt", "yuv420p",
    "-write_tmcd", "0",
    output,
  ]);
}

export async function renderVideo(input: RenderVideoInput): Promise<RenderVideoOutput> {
  await mkdir(input.compositionsDir, { recursive: true });
  await mkdir(input.videosDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = `${input.compositionsDir}${stamp}/`;
  const assetsDir = `${projectDir}assets/`;
  await mkdir(assetsDir, { recursive: true });

  // Copy audio as-is (mp3, no normalization needed)
  const audioAsset = basename(input.audioPath);
  await copyFile(resolvePath(input.audioPath), `${assetsDir}${audioAsset}`);

  // Flatten segments into a single clip list with absolute startSec.
  // Each clip in a segment occupies a slice of that segment's duration in order.
  const flatClips: FlatClip[] = [];
  const flatCaptions: FlatCaption[] = [];
  const usedNames = new Map<string, number>();

  let clipIndex = 0;
  let captionIndex = 0;
  for (const seg of input.segments) {
    if (seg.text && seg.text.trim().length > 0) {
      flatCaptions.push({
        index: captionIndex++,
        startSec: seg.startSec,
        durationSec: seg.durationSec,
        text: seg.text,
      });
    }
    let cursor = seg.startSec;
    for (const clip of seg.clips) {
      const base = basename(clip.videoPath);
      const stem = base.replace(/\.[^.]+$/, "");
      const count = usedNames.get(base) ?? 0;
      usedNames.set(base, count + 1);
      const asset = count === 0 ? `${stem}.mp4` : `${stem}-${count}.mp4`;
      // Round each cumulative cursor to 3 decimals to avoid FP drift (e.g.
      // 80.817 + 4.0 → 84.81700000000001, which trips the overlap linter).
      const rStart = r3(cursor);
      flatClips.push({
        index: clipIndex,
        startSec: rStart,
        durationSec: r3(clip.durationSec),
        videoAsset: asset,
        zoomDirection: clipIndex % 2 === 0 ? "in" : "out",
      });
      cursor = r3(rStart + clip.durationSec);
      clipIndex++;
    }
  }

  // Re-encode every distinct source video into assets/ (deduped by asset filename).
  // Cap concurrency at 2 — matches Fly's shared-cpu-2x and avoids ffmpeg thrash.
  const normalizeJobs: Array<() => Promise<void>> = [];
  const seen = new Set<string>();
  let i = 0;
  for (const seg of input.segments) {
    for (const clip of seg.clips) {
      const flat = flatClips[i++];
      if (seen.has(flat.videoAsset)) continue;
      seen.add(flat.videoAsset);
      const src = resolvePath(clip.videoPath);
      const dst = `${assetsDir}${flat.videoAsset}`;
      normalizeJobs.push(() => normalizeVideo(src, dst));
    }
  }

  const NORMALIZE_CONCURRENCY = 2;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < normalizeJobs.length) {
      const job = normalizeJobs[cursor++];
      await job();
    }
  }
  await Promise.all(Array.from({ length: NORMALIZE_CONCURRENCY }, () => worker()));

  const html = buildIndexHtml({
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    totalDurationSec: input.totalDurationSec,
    audioAsset,
    clips: flatClips,
    captions: flatCaptions,
  });
  const htmlPath = `${projectDir}index.html`;
  await writeFile(htmlPath, html, "utf8");

  await writeFile(
    `${projectDir}hyperframes.json`,
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    `${projectDir}meta.json`,
    JSON.stringify({ id: stamp, name: stamp, createdAt: new Date().toISOString() }, null, 2),
    "utf8"
  );

  const videoPath = `${input.videosDir}${stamp}.mp4`;
  const hfBin = `${PROJECT_ROOT}node_modules/.bin/hyperframes`;
  // -w 1: serialize Chrome workers. Default 'auto' opens N pages × M videos
  // simultaneously, blowing past Chrome's media-element parsing budget.
  // One worker still uses both vCPUs for ffmpeg encoding.
  await run(hfBin, [
    "render",
    projectDir,
    "-o", videoPath,
    "-f", String(RENDER_FPS),
    "-q", "standard",
    "-w", "1",
  ]);

  return { htmlPath, projectDir, videoPath, totalDurationSec: input.totalDurationSec };
}
