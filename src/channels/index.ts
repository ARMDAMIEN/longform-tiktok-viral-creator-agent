import { banditBiographiesChannel } from "./banditbiographies.js";
import type { ChannelConfig } from "./types.js";

export type { ChannelConfig } from "./types.js";

export const CHANNELS: Record<string, ChannelConfig> = {
  banditbiographies: banditBiographiesChannel,
};

export function getChannel(name: string | undefined): ChannelConfig {
  if (!name) {
    throw new Error(
      `CHANNEL env var is required. Set it to one of: ${Object.keys(CHANNELS).join(", ")}.`
    );
  }
  const c = CHANNELS[name];
  if (!c) {
    throw new Error(
      `Unknown channel "${name}". Available: ${Object.keys(CHANNELS).join(", ")}.`
    );
  }
  if (!c.notionDbId) {
    throw new Error(
      `Channel "${name}" has no Notion DB id. Set NOTION_DB_${name
        .toUpperCase()
        .replace(/-/g, "_")} in .env.`
    );
  }
  if (!c.narratorVoiceId) {
    throw new Error(
      `Channel "${name}" has no ElevenLabs narrator voice id. Set ELEVENLABS_VOICE_${name
        .toUpperCase()
        .replace(/-/g, "_")} in .env.`
    );
  }
  return c;
}
