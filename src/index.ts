import "dotenv/config";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { CLAUDE_MODEL, PROJECT_ROOT } from "./config.js";

// The agent-sdk shells out to a native `claude` binary. Auto-detection of the
// binary fails on Debian glibc (the SDK looks at the linux-x64-musl variant).
// We bundle @anthropic-ai/claude-code as a dep — its install.cjs downloads the
// right native binary at `bin/claude.exe` regardless of host platform.
const CLAUDE_BIN = `${PROJECT_ROOT}node_modules/@anthropic-ai/claude-code/bin/claude.exe`;
import { getChannel } from "./channels/index.js";
import { buildSystemPrompt } from "./prompts.js";
import { readAnalysis } from "./tools/readAnalysis.js";
import { transcribeYoutube } from "./tools/transcribeYoutube.js";
import { generateVoice } from "./tools/generateVoice.js";
import { generateHookVideo } from "./tools/generateHookVideo.js";
import { searchPexelsClips } from "./tools/searchPexelsClips.js";
import { downloadPexelsClip } from "./tools/downloadPexelsClip.js";
import { renderVideo } from "./tools/renderVideo.js";
import { uploadVideo } from "./tools/uploadVideo.js";
import { saveRun } from "./tools/saveRun.js";
import { saveToNotion } from "./tools/saveToNotion.js";

const channel = getChannel(process.env.CHANNEL);
const youtubeUrl = process.env.YOUTUBE_URL;
if (!youtubeUrl) {
  throw new Error("YOUTUBE_URL env var is required. Pass the input YouTube source video.");
}

// ─── Tool definitions (closed over channel) ─────────────────────────────────

const readAnalysisTool = tool(
  "read_analysis",
  `Read every .md analysis report from the "${channel.name}" channel's analyses folder. Files are concatenated in filename order with "---" separators. Returns { dir, files, content }.`,
  {},
  async () => {
    console.log("  📖 read_analysis");
    try {
      const r = await readAnalysis(channel.analysesDir);
      console.log(`    → ${r.files.length} file(s), ${r.content.length} chars`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `read_analysis failed: ${err}` }], isError: true };
    }
  },
  { annotations: { readOnlyHint: true } }
);

const transcribeYoutubeTool = tool(
  "transcribe_youtube",
  "Download audio from a YouTube URL via yt-dlp, transcribe via local whisper.cpp. Returns { youtubeUrl, audioPath, transcriptPath, language, durationSec, fullText, segments }.",
  {
    youtubeUrl: z.string().url().describe("The source YouTube video URL."),
  },
  async (args) => {
    console.log(`  🎙️  transcribe_youtube ${args.youtubeUrl}`);
    try {
      const r = await transcribeYoutube({ youtubeUrl: args.youtubeUrl }, channel.sourcesDir);
      console.log(`    → ${r.segments.length} segments, ${r.durationSec.toFixed(1)}s`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `transcribe_youtube failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const generateHookVideoTool = tool(
  "generate_hook_video",
  "Generate the hook segment (8–12s, 9:16) via Seedance 2.0 Fast (fal.ai). Saves to videos/hooks/. generate_audio is hardcoded false.",
  {
    prompt: z.string().describe("Dense Seedance prompt (60–140 words)."),
    duration: z.number().int().min(4).max(15).optional().describe("Seconds, 4–15. Defaults to HOOK_DURATION_SECONDS."),
    resolution: z.enum(["480p", "720p"]).optional(),
    seed: z.number().int().optional(),
  },
  async (args) => {
    console.log(`  🎬 generate_hook_video (${args.duration ?? "default"}s)`);
    try {
      const r = await generateHookVideo(args, channel.videosDir);
      console.log(`    → ${r.hookPath} (seed=${r.seed})`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `generate_hook_video failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const searchPexelsClipsTool = tool(
  "search_pexels_clips",
  "Search Pexels videos by query. Returns up to perPage candidates with id, fileUrl, dimensions, duration, author credit, and pexels page url.",
  {
    query: z.string().describe("English keyword query (2–6 words)."),
    perPage: z.number().int().min(1).max(30).optional(),
    orientation: z.enum(["portrait", "landscape", "square"]).optional(),
  },
  async (args) => {
    console.log(`  🔍 search_pexels_clips "${args.query}"`);
    try {
      const r = await searchPexelsClips(args);
      console.log(`    → ${r.candidates.length} candidates`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `search_pexels_clips failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const downloadPexelsClipTool = tool(
  "download_pexels_clip",
  "Download a Pexels mp4 to the channel's clips/ cache (idempotent by pexelsId). Returns clipPath + credit fields.",
  {
    pexelsId: z.number().int(),
    fileUrl: z.string().url(),
    pageUrl: z.string().url(),
    authorName: z.string(),
    authorUrl: z.string().url(),
  },
  async (args) => {
    console.log(`  ⬇️  download_pexels_clip pexels:${args.pexelsId}`);
    try {
      const r = await downloadPexelsClip(args, channel.clipsDir);
      console.log(`    → ${r.clipPath}${r.fromCache ? " (cached)" : ""}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `download_pexels_clip failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true, destructiveHint: true } }
);

const generateVoiceTool = tool(
  "generate_voice",
  `Generate the full French voiceover via ElevenLabs (voice id: ${channel.narratorVoiceId.slice(0, 8)}…). Returns { audioPath, alignmentPath, durationSec, characters }.`,
  {
    text: z.string().describe("The complete French voiceover text (hook + body, joined)."),
  },
  async (args) => {
    console.log(`  🗣️  generate_voice (${args.text.length} chars)`);
    try {
      const r = await generateVoice({ text: args.text, voiceId: channel.narratorVoiceId, voiceSettings: channel.voiceSettings }, channel.voiceDir);
      console.log(`    → ${r.audioPath} (${r.durationSec.toFixed(1)}s)`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ audioPath: r.audioPath, alignmentPath: r.alignmentPath, durationSec: r.durationSec }) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `generate_voice failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const renderVideoTool = tool(
  "render_video",
  "Compose the final mp4 via Hyperframes. Each segment carries one caption + 1–4 sub-clips that fill the segment's duration in order. Adds a subtle Ken Burns push-in/out per clip. Writes HTML to compositions/, mp4 to videos/.",
  {
    audioPath: z.string(),
    totalDurationSec: z.number(),
    segments: z.array(
      z.object({
        startSec: z.number().describe("Segment start time in the final composition (seconds)."),
        durationSec: z.number().describe("Segment total duration; must equal the sum of clips[].durationSec."),
        text: z.string().optional().describe("Caption shown for the entire segment."),
        clips: z.array(
          z.object({
            videoPath: z.string().describe("Local path to the clip mp4 (hook or downloaded Pexels)."),
            durationSec: z.number().describe("How long this sub-clip plays (2–5s recommended for body; full hook duration for the hook segment)."),
          })
        ).min(1).describe("1 clip for the hook segment; 2–4 clips per body segment."),
      })
    ).min(1),
  },
  async (args) => {
    console.log(`  🎞️  render_video (${args.segments.length} segments, ${args.totalDurationSec.toFixed(1)}s)`);
    try {
      const r = await renderVideo({
        audioPath: args.audioPath,
        totalDurationSec: args.totalDurationSec,
        segments: args.segments,
        compositionsDir: channel.compositionsDir,
        videosDir: channel.videosDir,
      });
      console.log(`    → ${r.videoPath}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `render_video failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const uploadVideoTool = tool(
  "upload_video",
  "Upload the final mp4 to fal.ai storage. Returns { videoUrl, videoFilename } for Notion attachment.",
  {
    videoPath: z.string(),
  },
  async (args) => {
    console.log("  ☁️  upload_video");
    try {
      const r = await uploadVideo(args);
      console.log(`    → ${r.videoUrl}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `upload_video failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

const saveRunTool = tool(
  "save_run",
  "Write the run snapshot JSON (script, segments, credits, paths) to runs/. Returns { runPath }.",
  {
    title: z.string(),
    description: z.string(),
    sourceYoutubeUrl: z.string(),
    scriptText: z.string(),
    hookSeedancePrompt: z.string(),
    segments: z.array(
      z.object({
        index: z.number(),
        startSec: z.number(),
        durationSec: z.number(),
        voiceText: z.string(),
        clips: z.array(
          z.object({
            source: z.enum(["seedance-hook", "pexels"]),
            durationSec: z.number(),
            seedancePrompt: z.string().optional(),
            pexelsId: z.number().optional(),
            pexelsPageUrl: z.string().optional(),
            pexelsAuthorName: z.string().optional(),
            pexelsAuthorUrl: z.string().optional(),
            query: z.string().optional(),
            localPath: z.string(),
          })
        ),
      })
    ),
    audioPath: z.string(),
    htmlPath: z.string(),
    videoPath: z.string(),
    videoUrl: z.string(),
    totalDurationSec: z.number(),
    aspectRatio: z.string(),
    hookSeed: z.number(),
    analysis: z.string(),
  },
  async (args) => {
    console.log("  💾 save_run");
    try {
      const r = await saveRun({ channel: channel.name, ...args }, channel.runsDir);
      console.log(`    → ${r.runPath}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `save_run failed: ${err}` }], isError: true };
    }
  },
  { annotations: { destructiveHint: true } }
);

const saveToNotionTool = tool(
  "save_to_notion",
  `Create a row in the "${channel.name}" Notion database. Attaches ONLY the final composited video (hook+body) via fal storage URL.`,
  {
    title: z.string(),
    description: z.string(),
    scriptText: z.string(),
    sourceYoutubeUrl: z.string(),
    hookSeedancePrompt: z.string(),
    videoUrl: z.string(),
    videoFilename: z.string(),
    runPath: z.string(),
    totalDurationSec: z.number(),
    aspectRatio: z.string(),
    clipCredits: z.array(
      z.object({
        pexelsId: z.number(),
        pageUrl: z.string(),
        authorName: z.string(),
        authorUrl: z.string(),
      })
    ),
    hookSeed: z.number(),
  },
  async (args) => {
    console.log("  📘 save_to_notion");
    try {
      const r = await saveToNotion({ channel: channel.name, ...args }, channel.notionDbId);
      console.log(`    → ${r.pageUrl}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `save_to_notion failed: ${err}` }], isError: true };
    }
  },
  { annotations: { openWorldHint: true } }
);

// ─── MCP server ─────────────────────────────────────────────────────────────

const mcpServer = createSdkMcpServer({
  name: "longform_tiktok_viral_creator",
  version: "1.0.0",
  tools: [
    readAnalysisTool,
    transcribeYoutubeTool,
    generateHookVideoTool,
    searchPexelsClipsTool,
    downloadPexelsClipTool,
    generateVoiceTool,
    renderVideoTool,
    uploadVideoTool,
    saveRunTool,
    saveToNotionTool,
  ],
});

// ─── Task prompt ────────────────────────────────────────────────────────────

const taskPrompt = `Produce one 1m05–1m30 narrated vertical video for the "${channel.name}" channel from the source YouTube video.

YOUTUBE_URL = ${youtubeUrl}

Follow the workflow in your system prompt exactly. Begin by calling read_analysis, then transcribe_youtube with the URL above.`;

console.log(`\n🚀 longform-tiktok-viral-creator-agent | channel=${channel.name} | model=${CLAUDE_MODEL}`);
console.log(`   source: ${youtubeUrl}\n`);

async function main() {
  for await (const message of query({
    prompt: taskPrompt,
    options: {
      systemPrompt: buildSystemPrompt(channel),
      model: CLAUDE_MODEL,
      mcpServers: { longform_tiktok_viral_creator: mcpServer },
      tools: [],
      allowedTools: ["mcp__longform_tiktok_viral_creator__*"],
      permissionMode: "bypassPermissions",
      maxTurns: 60,
      sandbox: { enabled: false, failIfUnavailable: false },
      pathToClaudeCodeExecutable: CLAUDE_BIN,
      stderr: (data: string) => process.stderr.write(`[cli-stderr] ${data}`),
    } as any,
  })) {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          console.log(`\n🤖 ${block.text.slice(0, 400)}`);
        }
        if (block.type === "tool_use") {
          console.log(`\n🔧 ${block.name}`);
        }
      }
    }
    if (message.type === "result") {
      if (message.subtype === "success") {
        console.log(`\n✅ Done. Cost: $${message.total_cost_usd?.toFixed(4) ?? "?"}`);
      } else {
        console.error(`\n❌ Agent failed:`, (message as any).errors);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
