import { Client } from "@notionhq/client";
import { NOTION_API_KEY } from "../config.js";

const notion = new Client({ auth: NOTION_API_KEY });

export interface NotionClipCredit {
  pexelsId: number;
  pageUrl: string;
  authorName: string;
  authorUrl: string;
}

export interface SaveToNotionInput {
  channel: string;
  title: string;
  description: string;
  scriptText: string;
  sourceYoutubeUrl: string;
  hookSeedancePrompt: string;
  videoUrl: string;
  videoFilename: string;
  runPath: string;
  totalDurationSec: number;
  aspectRatio: string;
  clipCredits: NotionClipCredit[];
  hookSeed: number;
}

export interface SaveToNotionOutput {
  pageId: string;
  pageUrl: string;
}

export async function saveToNotion(
  input: SaveToNotionInput,
  notionDbId: string
): Promise<SaveToNotionOutput> {
  const creditsText = input.clipCredits
    .map((c) => `pexels:${c.pexelsId} — ${c.authorName} (${c.pageUrl})`)
    .join("\n");

  const page = await notion.pages.create({
    parent: { database_id: notionDbId },
    properties: {
      title: { title: [{ text: { content: input.title } }] },
      description: { rich_text: [{ text: { content: input.description } }] },
      script: { rich_text: [{ text: { content: input.scriptText.slice(0, 2000) } }] },
      source_url: { url: input.sourceYoutubeUrl },
      hook_seedance_prompt: {
        rich_text: [{ text: { content: input.hookSeedancePrompt.slice(0, 2000) } }],
      },
      video: {
        files: [
          {
            name: input.videoFilename,
            external: { url: input.videoUrl },
          },
        ],
      },
      clip_sources: { rich_text: [{ text: { content: creditsText.slice(0, 2000) } }] },
      status: { select: { name: "Generated" } },
      duration_s: { number: input.totalDurationSec },
      aspect_ratio: { select: { name: input.aspectRatio } },
      format: { select: { name: "long" } },
      hook_seed: { number: input.hookSeed },
      run_file: { rich_text: [{ text: { content: input.runPath } }] },
      created_at: { date: { start: new Date().toISOString() } },
    },
  });

  return {
    pageId: page.id,
    pageUrl: (page as any).url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
  };
}
