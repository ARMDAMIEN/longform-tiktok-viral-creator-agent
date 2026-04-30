import { mkdir, writeFile } from "node:fs/promises";
import { ELEVENLABS_API_KEY, ELEVENLABS_MODEL } from "../config.js";
import type { VoiceSettings } from "../channels/types.js";

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
  const audioPath = `${voiceDir}${stamp}.mp3`;
  const alignmentPath = `${voiceDir}${stamp}.alignment.json`;

  await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));

  const a = data.alignment;
  const characters: VoiceCharacter[] = a.characters.map((char, i) => ({
    char,
    startSec: a.character_start_times_seconds[i],
    endSec: a.character_end_times_seconds[i],
  }));
  const durationSec = characters.at(-1)?.endSec ?? 0;

  await writeFile(alignmentPath, JSON.stringify({ durationSec, characters }, null, 2), "utf8");

  return { audioPath, alignmentPath, durationSec, characters };
}
