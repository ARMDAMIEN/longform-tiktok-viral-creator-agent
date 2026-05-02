import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ELEVENLABS_API_KEY, ELEVENLABS_MODEL } from "../config.js";
import type { VoiceSettings } from "../channels/types.js";

const execFileP = promisify(execFile);

export interface GenerateVoiceInput {
  text: string;
  voiceId: string;
  voiceSettings?: VoiceSettings;
}

export interface VoiceCharacter {
  char: string;
  startSec: number;
  endSec: number;
}

export interface GenerateVoiceOutput {
  audioPath: string;
  alignmentPath: string;
  durationSec: number;
  characters: VoiceCharacter[];
}

interface ElevenLabsTimestampsResponse {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
  normalized_alignment?: ElevenLabsTimestampsResponse["alignment"];
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

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    path,
  ]);
  return parseFloat(stdout.trim());
}

// Trim long pauses GENTLY:
//   - threshold -45dB: only true silence (well below voice tails) — no word clipping
//   - stop_duration 0.8s: only trim genuinely-long pauses (mid-sentence breaths stay)
//   - stop_silence 0.4s: leave 0.4s buffer to avoid hard splices that cause clicks
//   - apply low-pass + small fade on the splice with afade isn't possible cleanly inside
//     silenceremove, so we rely on the buffer instead
async function trimSilences(srcPath: string, dstPath: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", srcPath,
    "-af",
    [
      // Strip ONLY genuinely-leading silence (>0.2s).
      "silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB",
      // Cap internal/trailing silence > 0.8s at 0.4s.
      "silenceremove=stop_periods=-1:stop_duration=0.8:stop_threshold=-45dB:stop_silence=0.4",
    ].join(","),
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    dstPath,
  ]);
}

export async function generateVoice(
  input: GenerateVoiceInput,
  voiceDir: string
): Promise<GenerateVoiceOutput> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set in .env.");
  if (!input.voiceId) throw new Error("voiceId is required (channel narratorVoiceId).");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      model_id: ELEVENLABS_MODEL,
      output_format: "mp3_44100_128",
      ...(input.voiceSettings ? { voice_settings: input.voiceSettings } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as ElevenLabsTimestampsResponse;
  if (!data.audio_base64 || !data.alignment) {
    throw new Error(`ElevenLabs returned malformed response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  await mkdir(voiceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = `${voiceDir}${stamp}.raw.mp3`;
  const audioPath = `${voiceDir}${stamp}.mp3`;
  const alignmentPath = `${voiceDir}${stamp}.alignment.json`;

  // Save the raw ElevenLabs mp3, then post-process: trim silences for snappier pacing.
  await writeFile(rawPath, Buffer.from(data.audio_base64, "base64"));
  const rawDurationSec = data.alignment.character_end_times_seconds.at(-1) ?? 0;
  await trimSilences(rawPath, audioPath);
  const durationSec = await probeDurationSec(audioPath);
  // Drop the raw file — keeps voiceDir clean.
  await rm(rawPath, { force: true }).catch(() => {});

  console.log(`    ✂️  silence-trim: ${rawDurationSec.toFixed(1)}s → ${durationSec.toFixed(1)}s (saved ${(rawDurationSec - durationSec).toFixed(1)}s)`);

  // Note: alignment timestamps are from the RAW (untrimmed) audio. They no longer
  // map 1:1 to the trimmed mp3. The agent doesn't use word-level alignment for
  // anything (it plans segments from durationSec only) so this is safe.
  const a = data.alignment;
  const characters: VoiceCharacter[] = a.characters.map((char, i) => ({
    char,
    startSec: a.character_start_times_seconds[i],
    endSec: a.character_end_times_seconds[i],
  }));

  await writeFile(alignmentPath, JSON.stringify({ durationSec, rawDurationSec, characters }, null, 2), "utf8");

  return { audioPath, alignmentPath, durationSec, characters };
}
