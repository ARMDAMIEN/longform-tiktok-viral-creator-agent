import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { OPENAI_API_KEY, WHISPER_LANGUAGE, WHISPER_MODEL } from "../config.js";

let cookiesPath: string | null = null;
async function ensureYoutubeCookies(): Promise<string | null> {
  if (cookiesPath) return cookiesPath;
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return null;
  const path = `${tmpdir()}/yt-cookies.txt`;
  await writeFile(path, Buffer.from(b64, "base64"));
  cookiesPath = path;
  return path;
}

export interface TranscribeInput {
  youtubeUrl: string;
}

export interface TranscribeSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeOutput {
  youtubeUrl: string;
  audioPath: string;
  transcriptPath: string;
  language: string;
  durationSec: number;
  fullText: string;
  segments: TranscribeSegment[];
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

const OPENAI_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

export async function transcribeYoutube(
  input: TranscribeInput,
  sourcesDir: string
): Promise<TranscribeOutput> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set in .env (used by transcribe_youtube via OpenAI Whisper API).");
  }

  await mkdir(sourcesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${sourcesDir}${stamp}`;
  const audioPath = `${base}.mp3`;

  // yt-dlp → mono 64kbps mp3 (small enough for OpenAI's 25MB limit even on 30+ min sources)
  // Datacenter IPs (Fly) trip YouTube's bot detection, so we authenticate with
  // a Netscape-format cookies file shipped via the YOUTUBE_COOKIES_B64 secret.
  // player_client diversification helps when YouTube's primary client is rate-limited.
  const ytCookies = await ensureYoutubeCookies();
  const ytArgs = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "64K",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
    "--extractor-args", "youtube:player_client=ios,android,web",
    ...(ytCookies ? ["--cookies", ytCookies] : []),
    "-o", `${base}.%(ext)s`,
    input.youtubeUrl,
  ];
  await run("yt-dlp", ytArgs);

  const s = await stat(audioPath);
  if (s.size > OPENAI_FILE_LIMIT_BYTES) {
    throw new Error(
      `Audio file ${audioPath} is ${(s.size / 1024 / 1024).toFixed(1)}MB — over OpenAI's 25MB limit. Source video is too long; trim it or chunk before retrying.`
    );
  }

  const buf = await readFile(audioPath);
  const form = new FormData();
  form.set("file", new File([buf], basename(audioPath), { type: "audio/mpeg" }));
  form.set("model", WHISPER_MODEL);
  form.set("language", WHISPER_LANGUAGE);
  form.set("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Whisper failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    text: string;
    duration?: number;
    language?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const segments: TranscribeSegment[] = (data.segments ?? []).map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text.trim(),
  }));
  const fullText = (data.text ?? segments.map((s) => s.text).join(" ")).replace(/\s+/g, " ").trim();
  const durationSec = data.duration ?? segments.at(-1)?.end ?? 0;

  const transcriptPath = `${base}.transcript.json`;
  await writeFile(
    transcriptPath,
    JSON.stringify(
      { youtubeUrl: input.youtubeUrl, language: data.language ?? WHISPER_LANGUAGE, durationSec, segments, fullText },
      null,
      2
    ),
    "utf8"
  );

  return {
    youtubeUrl: input.youtubeUrl,
    audioPath,
    transcriptPath,
    language: data.language ?? WHISPER_LANGUAGE,
    durationSec,
    fullText,
    segments,
  };
}
