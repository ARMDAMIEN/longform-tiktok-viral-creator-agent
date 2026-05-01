import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { YoutubeTranscript } from "youtube-transcript";
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
  youtubeUrl?: string;
  audioUrl?: string;
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
  source: "ytdlp+whisper" | "youtube-captions" | "preuploaded+whisper";
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

// Pre-uploaded path: skip yt-dlp entirely. Source mp3 already lives at a public
// URL (typically uploaded via `npm run upload-source` from a residential IP, then
// the URL passed in via the AUDIO_URL env var). No bot detection, no cookies.
async function transcribeViaUrl(input: TranscribeInput, base: string): Promise<TranscribeOutput> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set in .env.");
  if (!input.audioUrl) throw new Error("audioUrl is required for transcribeViaUrl.");

  const audioPath = `${base}.mp3`;
  const dlRes = await fetch(input.audioUrl);
  if (!dlRes.ok) throw new Error(`Audio download failed: ${dlRes.status} ${dlRes.statusText} (${input.audioUrl})`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  if (buf.byteLength > OPENAI_FILE_LIMIT_BYTES) {
    throw new Error(
      `Pre-uploaded audio is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — over OpenAI's 25MB limit. Re-encode at lower bitrate.`
    );
  }
  await writeFile(audioPath, buf);

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
    start: seg.start, end: seg.end, text: seg.text.trim(),
  }));
  const fullText = (data.text ?? segments.map((s) => s.text).join(" ")).replace(/\s+/g, " ").trim();
  const durationSec = data.duration ?? segments.at(-1)?.end ?? 0;

  const transcriptPath = `${base}.transcript.json`;
  await writeFile(
    transcriptPath,
    JSON.stringify(
      { source: "preuploaded+whisper", audioUrl: input.audioUrl, language: data.language ?? WHISPER_LANGUAGE, durationSec, segments, fullText },
      null, 2
    ),
    "utf8"
  );

  return {
    youtubeUrl: input.youtubeUrl ?? "",
    audioPath, transcriptPath,
    language: data.language ?? WHISPER_LANGUAGE,
    durationSec, fullText, segments,
    source: "preuploaded+whisper",
  };
}

// Primary: yt-dlp → mp3 → OpenAI Whisper. Higher transcript quality.
async function transcribeViaYtdlp(input: TranscribeInput, sourcesDir: string, base: string): Promise<TranscribeOutput> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set in .env (used by transcribe_youtube via OpenAI Whisper API).");
  }
  if (!input.youtubeUrl) throw new Error("youtubeUrl is required for transcribeViaYtdlp.");

  const audioPath = `${base}.mp3`;
  const ytCookies = await ensureYoutubeCookies();
  console.log(`    🍪 cookies: ${ytCookies ? `${ytCookies} (env len=${(process.env.YOUTUBE_COOKIES_B64 ?? "").length})` : "NONE — YOUTUBE_COOKIES_B64 env empty"}`);
  const ytArgs = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "64K",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
    "--remote-components", "ejs:github",
    ...(ytCookies ? ["--cookies", ytCookies] : []),
    "-o", `${base}.%(ext)s`,
    input.youtubeUrl,
  ];
  console.log(`    🐛 yt-dlp argv: ${ytArgs.join(" ")}`);
  await run("yt-dlp", ytArgs);

  const sStat = await stat(audioPath);
  if (sStat.size > OPENAI_FILE_LIMIT_BYTES) {
    throw new Error(
      `Audio file ${audioPath} is ${(sStat.size / 1024 / 1024).toFixed(1)}MB — over OpenAI's 25MB limit. Source video is too long; trim it or chunk before retrying.`
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
      { source: "ytdlp+whisper", youtubeUrl: input.youtubeUrl, language: data.language ?? WHISPER_LANGUAGE, durationSec, segments, fullText },
      null, 2
    ),
    "utf8"
  );

  return {
    youtubeUrl: input.youtubeUrl ?? "",
    audioPath,
    transcriptPath,
    language: data.language ?? WHISPER_LANGUAGE,
    durationSec, fullText, segments,
    source: "ytdlp+whisper",
  };
}

// Fallback: YouTube's public caption track. No audio download, no auth, no bot-detection.
async function transcribeViaCaptions(input: TranscribeInput, base: string): Promise<TranscribeOutput> {
  if (!input.youtubeUrl) throw new Error("youtubeUrl is required for transcribeViaCaptions.");
  const items = await YoutubeTranscript.fetchTranscript(input.youtubeUrl, { lang: WHISPER_LANGUAGE });
  if (!items || items.length === 0) {
    throw new Error(`youtube-transcript returned no caption track for ${input.youtubeUrl} (lang=${WHISPER_LANGUAGE}). Source video may not have captions enabled.`);
  }

  const segments: TranscribeSegment[] = items.map((it) => ({
    start: typeof it.offset === "number" ? it.offset : 0,
    end: (typeof it.offset === "number" ? it.offset : 0) + (typeof it.duration === "number" ? it.duration : 0),
    text: (it.text ?? "")
      .replace(/&amp;#39;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim(),
  }));
  const fullText = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const durationSec = segments.at(-1)?.end ?? 0;

  const transcriptPath = `${base}.captions.json`;
  await writeFile(
    transcriptPath,
    JSON.stringify(
      { source: "youtube-captions", youtubeUrl: input.youtubeUrl, language: WHISPER_LANGUAGE, durationSec, segments, fullText },
      null, 2
    ),
    "utf8"
  );

  return {
    youtubeUrl: input.youtubeUrl ?? "",
    audioPath: "",        // no audio in fallback path
    transcriptPath,
    language: WHISPER_LANGUAGE,
    durationSec, fullText, segments,
    source: "youtube-captions",
  };
}

export async function transcribeYoutube(
  input: TranscribeInput,
  sourcesDir: string
): Promise<TranscribeOutput> {
  await mkdir(sourcesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${sourcesDir}${stamp}`;

  if (!input.audioUrl && !input.youtubeUrl) {
    throw new Error("Either audioUrl or youtubeUrl is required.");
  }

  // Pre-uploaded path takes priority — skips bot detection entirely.
  if (input.audioUrl) {
    console.log(`    📥 using pre-uploaded audioUrl (skipping yt-dlp entirely)`);
    return await transcribeViaUrl(input, base);
  }

  try {
    return await transcribeViaYtdlp(input, sourcesDir, base);
  } catch (primary) {
    console.log(`    ⚠️  yt-dlp+whisper failed (${primary instanceof Error ? primary.message : primary}). Falling back to youtube-transcript.`);
    try {
      return await transcribeViaCaptions(input, base);
    } catch (fallback) {
      throw new Error(
        `All transcription paths failed. Primary (yt-dlp+whisper): ${primary instanceof Error ? primary.message : primary}. Fallback (youtube-transcript): ${fallback instanceof Error ? fallback.message : fallback}. Tip: pre-upload the mp3 with 'npm run upload-source' and pass audio_url to the workflow.`
      );
    }
  }
}
