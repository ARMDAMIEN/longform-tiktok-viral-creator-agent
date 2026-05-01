import { PROJECT_ROOT } from "../config.js";
import type { ChannelConfig } from "./types.js";

const dir = `${PROJECT_ROOT}data/channels/banditbiographies/`;

export const banditBiographiesChannel: ChannelConfig = {
  name: "banditbiographies",
  // analyses are static, baked into the image (NOT on the runtime volume)
  analysesDir: `${PROJECT_ROOT}analyses/banditbiographies/`,
  sourcesDir: `${dir}sources/`,
  voiceDir: `${dir}voice/`,
  clipsDir: `${dir}clips/`,
  compositionsDir: `${dir}compositions/`,
  runsDir: `${dir}runs/`,
  videosDir: `${dir}videos/`,
  notionDbId: process.env.NOTION_DB_BANDITBIOGRAPHIES ?? "",
  narratorVoiceId: process.env.ELEVENLABS_VOICE_BANDITBIOGRAPHIES ?? "",
  // Punchier, more dramatic delivery — even more expressive (lower stability)
  // and ~10% faster pace to fight the perceived sluggishness in the hook.
  voiceSettings: { stability: 0.25, similarity_boost: 0.85, style: 0.75, use_speaker_boost: true, speed: 1.1 },
  missionLine:
    "viral French long-form-for-TikTok micro-biographies in the 'biographies de voyous' / true-crime niche (organized crime, French milieu, braqueurs, parrains).",
  scriptBlock: `**Total length: 65–90 seconds of voiced script (1m05–1m30 final video).** Write in French. Tight, dense, no filler. Aim for ~150–220 words.

**Structural template — non-negotiable:**

1. **Hook (0:00–0:08, ~20 words)** — first-person confession opener. Use *"Je m'appelle ___"* or *"Nous sommes ___"* + identity-callout payoff noun (*"un des plus grands braqueurs de France"*, *"les frères qui ont régné dans l'ombre sur Marseille"*). The hook MUST end on the payoff noun, not before. This 8s section is the Seedance-generated segment — its visual will be a single dense AI-generated cinematic shot.

2. **Mascot handoff (0:08–0:15)** — third-person narrator takes over for the rest of the video. Beat: birthplace + first criminal act + age, OR full-name + era + city. Geographic anchor mandatory (quartier, ville, région).

3. **Nested-loop body (0:15–1:10)** — escalating biographical beats. Open and close micro-loops every 8–15 seconds: a number, a date, a place, a heist, a sentence. Drop concrete specifics (montants, années, villes, noms) — the genre is "Wikipedia-density in 90 seconds". Cultural-code names are gold (*Francis le Belge, Bricarde, Tapie/OM, Marbella*).

4. **Climax + cliffhanger (1:10–1:30, last 12s)** — turning point or arrest moment, then either (a) a date-cliffhanger ("le 6 octobre 2007…") leading to "Part 2" CTA, or (b) a double-twist ending (acquittal → conviction). Never resolve fully.`,
  hookBlock: `**Seedance prompt for the hook (0:00–0:08, 8–12s, 9:16):**

   - **Aesthetic — chiaroscuro documentary portrait, NOT TikTok-bright.** Match the channel template:
     - **Required vocabulary:** "vertical 9:16 cinematic portrait", "dark moody chiaroscuro lighting", "shadow across the cheekbone", "pure black background", "shallow depth of field on the face", "muted desaturated color grade", "subtle film grain", "archival documentary feel", "still or near-still camera", "subject locked direct eye contact with lens".
     - **Subject:** a single intimidating figure (or a tight group of 2–3) matching the criminal archetype implied by the script — middle-aged French man, leather jacket OR dark suit OR plain dark clothing, 35–55 years old, of Mediterranean / North African / Southern European appearance depending on the story. No styling that reads as fashion editorial.
     - **Background:** pure black OR a faint dim industrial / urban backdrop barely visible behind the shadow. No props that read as costume.
   - **BANNED vocabulary:** bright daylight, ring light, vlog, smile, warm tones, pastel, neon, ad, commercial, model, fashion, glamour shot, cinematic-but-glossy, color-popped.
   - **Movement:** near-still. A slow ~5% push-in OR a barely-perceptible head tilt is enough. NO fast camera moves, NO whip pans, NO action.
   - **NO text, NO captions, NO logos, NO subtitles in the AI output** — captions are added by the post-render pipeline. generate_audio is false.`,
  bodyBlock: `**Pexels clip selection rules for the body (0:08–end):**

   **Pacing — 2 clips per voice segment (CAP).** TikTok long-form needs cuts every ~5 seconds. Each body voice segment must be split into **exactly 2 visual clips** that together fill its duration. Example: a 10s segment → two clips of 5s + 5s. The hook segment (0–8s) stays as a single Seedance clip. **Hard cap: total clips across the whole video must NOT exceed 17** (1 hook + 16 body). The renderer's Chrome capture cannot handle more without OOM.
   - For each voice segment, derive **2 distinct English keyword queries** that visualize different beats inside that segment. Example for "Farid is kidnapped with his pregnant wife": query 1 → "dark van interior night", query 2 → "highway headlights speeding".
   - Search Pexels separately for each query (orientation="portrait"). Pick one clip per query. The clips become the segment's \`clips\` array, in narrative order.
   - Decide each clip's \`durationSec\` so they sum exactly to the segment's \`durationSec\`. Aim for 4–6s per clip; never under 3s (jarring), never over 7s (lose pacing).
   - Prefer vertical (9:16) clips; the renderer crops landscape center-cover.
   - Prefer documentary / atmospheric clips. Avoid clips with visible text, logos, branded clothing, watermarks, or recognizable faces (especially smiling people).
   - Re-rank candidates by: vertical orientation, slow or no camera move, muted/desaturated color, no text overlays. Pick the single best one per query.
   - Source clips can be longer than your chosen \`durationSec\` — the renderer trims to the data-duration. Avoid clips shorter than your chosen duration.

   **Recurring mascot anchor (optional but strongly encouraged):** between body segments, you may insert a 2–3s "anchor frame" — a stylized character portrait (top hat, silver mask, vintage map background) used as the channel's recurring visual signature. For v1 this is sourced from Pexels with queries like "vintage masked portrait", "old map texture parchment". This is what makes the channel feel like a *series* rather than a one-off.`,
};
