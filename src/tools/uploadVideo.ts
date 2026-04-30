import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fal } from "@fal-ai/client";
import { FAL_KEY } from "../config.js";

fal.config({ credentials: FAL_KEY });

export interface UploadVideoInput {
  videoPath: string;
}

export interface UploadVideoOutput {
  videoUrl: string;
  videoFilename: string;
}

export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoOutput> {
  const buf = await readFile(input.videoPath);
  const filename = basename(input.videoPath);
  // @fal-ai/client's File polyfill works in Node 22+
  const file = new File([buf], filename, { type: "video/mp4" });
  const videoUrl = await fal.storage.upload(file);
  return { videoUrl, videoFilename: filename };
}
