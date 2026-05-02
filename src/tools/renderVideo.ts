import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { RENDER_WIDTH, RENDER_HEIGHT, RENDER_FPS } from "../config.js";

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
  htmlPath: string;       // re-purposed: path to the captions ASS file (kept for API compat)
  projectDir: string;
  videoPath: string;
  totalDurationSec: number;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

// Per-clip pre-render: drop data/audio streams, scale-and-crop to 9:16 cover,
// apply subtle Ken Burns push-in/out, normalize to 30fps with 1s keyframes.
// Output is a uniform mp4 segment ready for stream-copy concat.
async function renderClipReady(
  srcPath: string,
  dstPath: string,
  durationSec: number,
  kenBurns: "in" | "out"
): Promise<void> {
  const fps = RENDER_FPS;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  // zoompan z is per output frame; with d=1 the zoom evolves continuously over input.
  const zoomExpr =
    kenBurns === "in"
      ? `1+0.06*on/${totalFrames}`
      : `1.06-0.06*on/${totalFrames}`;

  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", srcPath,
    "-map", "0:v:0",
    "-map", "-0:d",
    "-an", "-sn", "-dn",
    "-vf", [
      // Cover the canvas first (object-fit:cover equivalent)
      `scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${RENDER_WIDTH}:${RENDER_HEIGHT}`,
      // Then apply Ken Burns at the final canvas size
      `zoompan=z='${zoomExpr}':d=1:s=${RENDER_WIDTH}x${RENDER_HEIGHT}:fps=${fps}`,
      `setsar=1`,
    ].join(","),
    "-t", String(durationSec),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-r", String(fps),
    "-g", String(fps),
    "-keyint_min", String(fps),
    "-sc_threshold", "0",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    dstPath,
  ]);
}

function secondsToAssTime(s: number): string {
  // ASS format: H:MM:SS.cc (centiseconds)
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function escapeAssText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N")
    .trim()
    .toUpperCase();
}

interface AssCaption { start: number; end: number; text: string; }

// Split a segment's text into shorter caption beats so the on-screen text
// follows the spoken phrasing (TikTok-native pacing) instead of dumping the
// whole 10s sentence-block at once. Splits on .,;:!?… boundaries (any
// punctuation that marks a clause break, not just terminal sentences).
const MAX_CAPTION_CHARS = 50;   // hard cap; longer phrases get word-split
const MIN_CAPTION_CHARS = 8;    // sub-this gets merged with a neighbor

function splitTextIntoPhrases(text: string): string[] {
  // Split on any clause-end punctuation followed by whitespace.
  const raw = text
    .split(/(?<=[.,;:!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (raw.length === 0) return [text.trim()];

  // Hard-cap any single phrase that has no internal punctuation but is long
  // (> MAX_CAPTION_CHARS): split it on word boundaries into ~equal chunks.
  const wordSplit: string[] = [];
  for (const p of raw) {
    if (p.length <= MAX_CAPTION_CHARS) { wordSplit.push(p); continue; }
    const words = p.split(/\s+/);
    let buf = "";
    for (const w of words) {
      if (buf.length + w.length + 1 > MAX_CAPTION_CHARS && buf.length > 0) {
        wordSplit.push(buf);
        buf = w;
      } else {
        buf = buf ? `${buf} ${w}` : w;
      }
    }
    if (buf) wordSplit.push(buf);
  }

  // Merge only ultra-short fragments (< MIN_CAPTION_CHARS) into a neighbor —
  // avoids jarring 0.4s flashes of "Mais." or "OK." but keeps everything else
  // separate for maximum on-screen pacing.
  const merged: string[] = [];
  for (const p of wordSplit) {
    if (
      merged.length &&
      (p.length < MIN_CAPTION_CHARS || merged[merged.length - 1].length < MIN_CAPTION_CHARS)
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${p}`;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

// Distribute a segment's time window across N phrases by char count.
function captionsForSegment(segStart: number, segDur: number, text: string): AssCaption[] {
  const phrases = splitTextIntoPhrases(text);
  if (phrases.length <= 1) {
    return [{ start: segStart, end: segStart + segDur, text: phrases[0] ?? text }];
  }
  const totalChars = phrases.reduce((acc, p) => acc + p.length, 0);
  let cursor = segStart;
  const caps: AssCaption[] = [];
  phrases.forEach((p, idx) => {
    const isLast = idx === phrases.length - 1;
    // Last phrase absorbs any rounding residue so we end exactly at segStart+segDur.
    const dur = isLast ? segDur - (cursor - segStart) : (p.length / totalChars) * segDur;
    caps.push({ start: r3(cursor), end: r3(cursor + dur), text: p });
    cursor += dur;
  });
  return caps;
}

function buildAssFile(captions: AssCaption[], width: number, height: number): string {
  // ASS V4+. Liberation Sans Bold ships with the Dockerfile's fonts-liberation pkg.
  // PrimaryColour: white (&H00FFFFFF). BackColour (box): black 55% alpha (&H8C000000).
  // BorderStyle 3 = opaque box. Alignment 2 = bottom-center. MarginV 300 = lift caption above bottom edge.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Liberation Sans,56,&H00FFFFFF,&H00000000,&H8C000000,1,0,3,4,0,2,80,80,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = captions
    .map((c) => `Dialogue: 0,${secondsToAssTime(c.start)},${secondsToAssTime(c.end)},Caption,,0,0,0,,${escapeAssText(c.text)}`)
    .join("\n");
  return header + events + "\n";
}

export async function renderVideo(input: RenderVideoInput): Promise<RenderVideoOutput> {
  await mkdir(input.compositionsDir, { recursive: true });
  await mkdir(input.videosDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = `${input.compositionsDir}${stamp}/`;
  const partsDir = `${projectDir}parts/`;
  await mkdir(partsDir, { recursive: true });

  // Flatten clips with absolute startSec; round each cumulative cursor to avoid FP drift.
  interface FlatClip {
    startSec: number;
    durationSec: number;
    srcPath: string;
    partPath: string;
    kenBurns: "in" | "out";
  }
  const flatClips: FlatClip[] = [];
  let cursor = 0;
  let i = 0;
  for (const seg of input.segments) {
    for (const clip of seg.clips) {
      const rStart = r3(cursor);
      const rDur = r3(clip.durationSec);
      flatClips.push({
        startSec: rStart,
        durationSec: rDur,
        srcPath: resolvePath(clip.videoPath),
        partPath: `${partsDir}${String(i).padStart(3, "0")}.mp4`,
        kenBurns: i % 2 === 0 ? "in" : "out",
      });
      cursor = r3(rStart + rDur);
      i++;
    }
  }

  // Phase 1 — pre-render each clip in parallel (concurrency 2 = vCPU count).
  const NORMALIZE_CONCURRENCY = 2;
  let cursor2 = 0;
  async function worker(): Promise<void> {
    while (cursor2 < flatClips.length) {
      const fc = flatClips[cursor2++];
      console.log(`    🎬 prepping clip ${fc.partPath.split("/").pop()} (${fc.durationSec}s, KB=${fc.kenBurns})`);
      await renderClipReady(fc.srcPath, fc.partPath, fc.durationSec, fc.kenBurns);
    }
  }
  await Promise.all(Array.from({ length: NORMALIZE_CONCURRENCY }, () => worker()));

  // Phase 2 — concat all parts via the demuxer (stream-copy, fast).
  const concatList = flatClips.map((fc) => `file '${fc.partPath.replace(/'/g, "'\\''")}'`).join("\n");
  const concatListPath = `${projectDir}concat.txt`;
  await writeFile(concatListPath, concatList, "utf8");

  const concatPath = `${projectDir}concat.mp4`;
  console.log(`    🧵 concat ${flatClips.length} parts → ${concatPath.split("/").pop()}`);
  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    "-movflags", "+faststart",
    concatPath,
  ]);

  // Phase 3 — emit ASS captions file. Each segment's text is split into
  // sentence-level captions so on-screen text matches spoken phrasing.
  const captions: AssCaption[] = [];
  let segCursor = 0;
  for (const seg of input.segments) {
    if (seg.text && seg.text.trim().length > 0) {
      captions.push(...captionsForSegment(segCursor, seg.durationSec, seg.text.trim()));
    }
    segCursor = r3(segCursor + seg.durationSec);
  }
  const assPath = `${projectDir}captions.ass`;
  await writeFile(assPath, buildAssFile(captions, RENDER_WIDTH, RENDER_HEIGHT), "utf8");

  // Phase 4 — burn captions and mux audio. Final output.
  const videoPath = `${input.videosDir}${stamp}.mp4`;
  console.log(`    🎞️  burning captions + muxing audio → ${videoPath.split("/").pop()}`);
  // Subtitles filter needs the absolute path with backslash-escaped colons/quotes.
  const assForFilter = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", concatPath,
    "-i", resolvePath(input.audioPath),
    "-vf", `subtitles='${assForFilter}'`,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-r", String(RENDER_FPS),
    "-g", String(RENDER_FPS),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    videoPath,
  ]);

  return {
    htmlPath: assPath, // backward-compat field (now ASS path)
    projectDir,
    videoPath,
    totalDurationSec: input.totalDurationSec,
  };
}
