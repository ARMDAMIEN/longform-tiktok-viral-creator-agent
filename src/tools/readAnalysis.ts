import { readdir, readFile } from "node:fs/promises";

export interface ReadAnalysisResult {
  dir: string;
  files: string[];
  content: string;
}

export async function readAnalysis(analysesDir: string): Promise<ReadAnalysisResult> {
  let entries: string[];
  try {
    entries = await readdir(analysesDir);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        `Analyses directory not found at ${analysesDir}. Create it and drop at least one .md analysis file inside.`
      );
    }
    throw err;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  if (mdFiles.length === 0) {
    throw new Error(
      `No .md analysis files found in ${analysesDir}. Drop at least one report before running the agent.`
    );
  }

  const parts: string[] = [];
  for (const name of mdFiles) {
    const body = await readFile(`${analysesDir}${name}`, "utf8");
    parts.push(`<!-- file: ${name} -->\n${body.trim()}`);
  }
  const content = parts.join("\n\n---\n---\n\n");

  return { dir: analysesDir, files: mdFiles, content };
}
