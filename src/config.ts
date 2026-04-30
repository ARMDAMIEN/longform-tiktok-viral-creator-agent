import "dotenv/config";

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
export const FAL_KEY = process.env.FAL_KEY!;
export const NOTION_API_KEY = process.env.NOTION_API_KEY!;
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
export const PEXELS_API_KEY = process.env.PEXELS_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-7";
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";

export const PROJECT_ROOT = new URL("../", import.meta.url).pathname;

export const SEEDANCE_MODEL = process.env.SEEDANCE_MODEL ?? "bytedance/seedance-2.0/fast/text-to-video";
export const HOOK_DURATION_SECONDS = Number(process.env.HOOK_DURATION_SECONDS ?? 10);
export const HOOK_RESOLUTION = (process.env.HOOK_RESOLUTION ?? "720p") as "480p" | "720p";
export const VIDEO_ASPECT_RATIO = (process.env.VIDEO_ASPECT_RATIO ?? "9:16") as
  | "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

// Render canvas (9:16 vertical TikTok long-form)
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;
export const RENDER_FPS = 30;

// OpenAI Whisper API (whisper-1)
export const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? "fr";
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "whisper-1";
