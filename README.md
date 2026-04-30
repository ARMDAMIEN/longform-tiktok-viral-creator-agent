# longform-tiktok-viral-creator-agent

Sister project to `tiktok-viral-creator-agent`. Where that one ships **5–15s silent** AI-generated TikToks, this one ships **65–90s narrated vertical micro-docs** repackaged from a source YouTube video.

Hybrid stack:

- **Hook (0:00–~0:10)** — single dense AI shot via **Seedance 2.0 Fast** (fal.ai). One Seedance generation per video, kept short to keep cost predictable.
- **Body (~0:10–end)** — **Pexels** stock clips, picked by the agent, stitched under the voiceover.
- **Voice** — **ElevenLabs** TTS with word-level alignment.
- **Transcription of source** — local **whisper.cpp** on a yt-dlp-extracted wav.
- **Montage** — **Hyperframes** (HTML composition → MP4).
- **Persistence** — run JSON snapshots locally + Notion row with the final composited video.

## Channels

- `banditbiographies` — French long-form-for-TikTok true-crime micro-biographies (analyses copied from `tiktok-viral-analyzer/data/reports/`).

Add channels by creating `src/channels/<name>.ts` (mirror the existing one) and registering it in `src/channels/index.ts`. Drop one or more `.md` analysis reports into `data/channels/<name>/analyses/`.

## System dependencies

- **Node 22+** and **ffmpeg** (Hyperframes requires both).
- **yt-dlp** on `PATH` — used by `transcribe_youtube` to extract the source audio.
- **whisper.cpp** built locally + a ggml model file. Recommended model for French: `ggml-medium.bin` (~1.5GB). Quick install:
  ```bash
  brew install whisper-cpp           # provides `whisper-cli`
  # or build from source: https://github.com/ggerganov/whisper.cpp
  # then download a model:
  bash ./models/download-ggml-model.sh medium
  ```

## Setup

```bash
npm install
cp .env.example .env
# fill in: ANTHROPIC_API_KEY, FAL_KEY, NOTION_API_KEY, ELEVENLABS_API_KEY,
# PEXELS_API_KEY, ELEVENLABS_VOICE_BANDITBIOGRAPHIES (a serious French male voice id),
# NOTION_DB_BANDITBIOGRAPHIES, WHISPER_BINARY, WHISPER_MODEL_PATH
```

## Notion DB schema (per channel)

Create the database once and paste its id into `.env`. Required properties:

| name | type | notes |
| --- | --- | --- |
| `title` | title | hook-first French title |
| `description` | rich_text | TikTok-voice description + hashtags |
| `script` | rich_text | full French voiceover |
| `source_url` | url | input YouTube URL |
| `hook_seedance_prompt` | rich_text | the prompt sent to Seedance for the hook |
| `video` | files | **only the final composited mp4** (hook + body), uploaded to fal storage and attached as external file |
| `clip_sources` | rich_text | newline-separated Pexels credits (`pexels:<id> — author (page_url)`) |
| `status` | select | options include `Generated` |
| `duration_s` | number | total seconds |
| `aspect_ratio` | select | options include `9:16` |
| `format` | select | options include `long` |
| `hook_seed` | number | Seedance seed for reproducibility |
| `run_file` | rich_text | local path to the run snapshot JSON |
| `created_at` | date | run timestamp |

## Run

```bash
CHANNEL=banditbiographies \
YOUTUBE_URL=https://www.youtube.com/watch?v=XXXX \
npm start
```

The agent will:

1. Read every `.md` in `data/channels/banditbiographies/analyses/`.
2. yt-dlp → wav → whisper-cli the source YouTube → `data/channels/banditbiographies/sources/`.
3. Synthesize a 65–90s French script that follows the channel's structural template (first-person hook → mascot handoff → nested-loop body → cliffhanger).
4. Plan segments (1 hook + 4–8 body), each with `voiceText`, `durationSec`, and (hook) Seedance prompt or (body) Pexels queries.
5. Generate the hook shot via Seedance → `videos/hooks/`.
6. For each body segment: search Pexels → pick best → download to `clips/`.
7. Generate full voiceover via ElevenLabs → `voice/` (mp3 + alignment JSON).
8. Render via Hyperframes (HTML → MP4) → `compositions/` + `videos/`.
9. Upload final mp4 to fal storage → get URL.
10. Save run snapshot JSON → `runs/`.
11. Create a Notion row with the final video URL only (intermediate hook URL stays local).

## Cost ballpark per video

- Seedance 2.0 Fast hook (10s, 720p): ~$1
- ElevenLabs TTS (~80s, multilingual v2): ~$0.10
- Pexels: free (attribution required, written to `clip_sources`)
- whisper.cpp transcription: free (local)
- Anthropic agent calls: ~$0.30–1.00 depending on script length

≈ **$1.50–2.50 per video**, vs ~$10–30 if the entire 90s were Seedance.

## File layout

```
analyses/                            # static, baked into the Docker image
└── banditbiographies/*.md           # virality analyses for the channel
data/channels/banditbiographies/     # runtime — on the Fly volume
├── sources/                         # yt-dlp wav + whisper transcript JSON
├── voice/                           # ElevenLabs mp3 + alignment.json
├── clips/                           # cached Pexels mp4s (cache key = pexelsId)
├── videos/hooks/                    # Seedance hook mp4s
├── compositions/                    # generated Hyperframes HTML
├── runs/                            # snapshot JSON per run
└── videos/                          # final composited mp4 (this is what goes to Notion)
```

## Deploy to Fly.io (recommended runtime)

The local Mac can hit OOM on Hyperframes Chrome capture for 20+ clips. Fly gives a clean 4GB VM per render. The pattern mirrors `../seo-agent/` (Fly = runtime + persistent volume; GH Actions = trigger).

### One-time bootstrap

```bash
# 1. Make it a git repo + push to GitHub (any account)
git init && git add . && git commit -m "initial"
gh repo create <owner>/longform-tiktok-viral-creator-agent --source=. --push --private

# 2. Provision the Fly app + volume (matches fly.toml)
flyctl apps create longform-tiktok-viral-creator-agent
flyctl volumes create longform_data --region cdg --size 5 --app longform-tiktok-viral-creator-agent

# 3. Set Fly secrets (one-time — do NOT use --env per-run for these)
flyctl secrets set --app longform-tiktok-viral-creator-agent \
  ANTHROPIC_API_KEY="..." \
  FAL_KEY="..." \
  NOTION_API_KEY="..." \
  ELEVENLABS_API_KEY="..." \
  PEXELS_API_KEY="..." \
  OPENAI_API_KEY="..." \
  ELEVENLABS_VOICE_BANDITBIOGRAPHIES="..." \
  NOTION_DB_BANDITBIOGRAPHIES="..."

# 4. First deploy — creates the canonical volume-attached machine
flyctl deploy --app longform-tiktok-viral-creator-agent

# 5. Stop it (it auto-starts after deploy)
flyctl machines list --app longform-tiktok-viral-creator-agent --json | jq -r '.[0].id' \
  | xargs -I{} flyctl machine stop {} --app longform-tiktok-viral-creator-agent

# 6. Add FLY_API_TOKEN to GitHub repo secrets:
flyctl tokens create deploy --app longform-tiktok-viral-creator-agent
# (paste output as GH repo secret named FLY_API_TOKEN)
```

### Per-render trigger

Go to GitHub Actions → "Longform Agent" → "Run workflow":
- mode: `run`
- channel: `banditbiographies`
- youtube_url: `https://www.youtube.com/watch?v=...`

The workflow calls `flyctl machine update --env CHANNEL=... --env YOUTUBE_URL=...`, then `flyctl machine start`, then polls until exit.

After code changes (`src/**`, `analyses/**`, `Dockerfile`, etc.), pushing to `main` auto-rebuilds the image and updates the machine. Or trigger manually with mode `deploy` / `deploy-run`.

## Sister project

`../tiktok-viral-creator-agent/` ships pure-Seedance silent shorts for `raw-animals` and `extreme-work`. Same `read_analysis` pattern and `<name>/analyses/*.md` convention, independent `data/`.
