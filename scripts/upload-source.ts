// Local helper: download a YouTube video's audio with yt-dlp, upload to fal
// storage, print the public URL. Pipe-friendly (URL is the only stdout line).
//
// Usage:
//   npm run upload-source -- "https://www.youtube.com/watch?v=..."
//   # → prints: https://v3b.fal.media/files/.../<stamp>.mp3
//
// Then trigger GH Actions "Longform Agent" workflow with audio_url=<that URL>.
// This sidesteps Fly's bot-detection problem with YouTube — yt-dlp runs on
// your residential IP, only the mp3 leaves your machine.

import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fal } from "@fal-ai/client";

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error("FAL_KEY not set in .env. Required to upload the mp3.");
  process.exit(2);
}
fal.config({ credentials: FAL_KEY });

const youtubeUrl = process.argv[2];
if (!youtubeUrl) {
  console.error("Usage: npm run upload-source -- '<youtube-url>'");
  process.exit(2);
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

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "longform-source-"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(dir, stamp);
  const audioPath = `${base}.mp3`;

  console.error(`→ yt-dlp → ${audioPath}`);
  await run("yt-dlp", [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "64K",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
    "-o", `${base}.%(ext)s`,
    youtubeUrl,
  ]);

  console.error("→ uploading to fal storage…");
  const buf = await readFile(audioPath);
  const file = new File([buf], `${stamp}.mp3`, { type: "audio/mpeg" });
  const url = await fal.storage.upload(file);

  // Only the URL goes to stdout — pipe-friendly.
  console.log(url);
  console.error(`✓ ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB uploaded.`);

  await rm(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
