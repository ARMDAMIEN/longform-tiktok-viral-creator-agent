# todo

Feedback from the first end-to-end render (2026-04-29, [videos/2026-04-29T15-53-52-952Z.mp4](data/channels/banditbiographies/videos/2026-04-29T15-53-52-952Z.mp4)).

## Higher-energy voice

- [ ] Voice currently reads too calm — TikTok-native true-crime needs a punchier, more dramatic delivery.
- Options to try, in order of effort:
  - **Tune ElevenLabs settings.** Pass `voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.7, use_speaker_boost: true }` (or similar) in `generateVoice.ts`. Lower `stability` + higher `style` = more expressive, more variation.
  - **Switch model.** Try `eleven_multilingual_v3` (alpha) — better at French dramatic delivery than v2.
  - **Pick a different voice.** The current `qNJqclOgbiButMcyYv6d` might just be the wrong actor. Pick a French male with a "narrator / documentary host" tag, ideally one labeled "intense" or "dramatic" rather than "calm."
- Add a `voiceSettings` field to `ChannelConfig` so each channel tunes its own delivery.

## More clips, shorter cuts

- [ ] Current avg cut length ~10s per clip — far too slow for the channel template (BanditBiographies cuts every 3–5s with kaleidoscopic warps and B-roll inserts).
- Plan:
  - Allow **multiple clips per script segment** in `select_clips` flow. Target 2–4 clips per voice segment, each 2–5s.
  - In `prompts.ts` `bodyBlock`, change "one clip per script segment" → "split each ~10s voice segment into 2–4 visual cuts of 2–5s each, each driven by a different keyword from the segment."
  - Update `RenderSegmentInput` to accept `clips: { videoPath, durationSec }[]` per segment instead of a single `videoPath`. Caption stays one per segment.
  - Update `searchPexelsClips` to allow multiple queries per segment in one call (saves round-trips), or have the agent fan out N queries.

## Transitions + effects

- [ ] Add the visual signatures of the channel: quick fades, hard cuts with momentum, occasional glitch/warp on chapter breaks.
- Tactics, low → high effort:
  - **Ken Burns push-in** on every clip (GSAP timeline: subtle 1.0 → 1.05 scale over the clip's duration). Cheap, immediately makes static stock feel alive.
  - **Hard-cut accent** between segments — nothing fancy, but ensure no visible black gap (currently the FP-precision rounding may leave 30–60ms of black).
  - **Brightness/contrast pulse** on the FIRST frame of each segment to match the script's "hinge word" (e.g., *"Mais…"*, *"Cependant…"*, *"En 2010…"*) — CSS filter flicker via GSAP.
  - **Glitch effect** at major story turns (the betrayal, the arrest, the verdict): chromatic aberration via SVG `feColorMatrix` + horizontal slice translation. Mid-effort.
  - **Kaleidoscope warp** (channel signature in the analyses) at chapter breaks — high effort, would use CSS `clip-path` with mirrored tiles + rotation. Skip for v1.
- Implementation route: extend `renderVideo.ts` to emit a richer GSAP timeline that animates per-clip transforms, instead of just registering an empty paused timeline. Hyperframes captures whatever GSAP renders.

## Stretch / nice-to-have (not from this round of feedback)

- [ ] Mascot anchor frame — channel uses a recurring masked top-hat portrait between body segments. Could be sourced once (Pexels or generated via Seedance/Imagen), then re-used across all videos as a 2s insert every ~25s.
- [ ] Backfill the Notion row for the 2026-04-29 run after the integration gets DB access (current row never wrote).
- [ ] Consider per-channel ElevenLabs `model_id` override (e.g., banditbiographies → v3-alpha for drama, raw-animals → v2 for friendly).
