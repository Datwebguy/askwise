# HANDOFF (working note for the next session)

Read docs/00_START_HERE.md first (owner rules override everything), then this file.
Branch: `ccr-63594271-40tzca`. Commit as `datwebguy <princeabel2000@gmail.com>`, no co-author or session lines.

## State on Nov 26, 2026 (end of session 1)

Done and proven (see docs/TEST_REPORT.md):
- Research engine (OpenAI gpt-5.4-nano + web_search), checking step, job states, time limit, cancel, follow-up question.
- Glasses screens (Even Hub SDK 0.0.16), phone pages (dark + light themes, Geist fonts, one-screen report with tabs), new logo (web/public/icon.svg, web/src/phone/logo.ts).
- Instant access: no sign-in; each device gets a private space (`POST /api/session/guest`). Limits: 10/hour per device, 150/day total.
- Notion: owner mode (service token, owner account via `npm run invite -- --owner`), shared public page for everyone ("AskWise shared reports", id 424669a3-d1fd-811f-ad46-f66d0c26cfd6), visitor OAuth "Connect Notion" (built + tested with fixtures; needs hosting + owner's public Notion connection).
- 86 automated tests pass. Simulator full flow + 4 harder checks passed in the official simulator.

Done and proven in the simulator (see TEST_REPORT "Voice"):
- Voice input. Hold touchpad -> listening -> release -> `POST /api/voice` (WAV) -> OpenAI transcription (gpt-4o-mini-transcribe) -> draft on glasses -> tap sends, double-tap discards.
  Files: server/voice/transcribe.ts, server/app.ts (/api/voice), web/src/glasses/voice.ts, web/src/glasses/controller.ts, screens.ts (voice screens), app.json (g2-microphone).
  Rule 8: voice must not be mentioned in README/UI claims until proven end to end. Glasses hints already say "Hold: speak" -> remove if it cannot be proven.

## Next steps, in order
1. (Done) Voice tests: tests/voice.test.ts.
2. (Done) Voice proven in the simulator with a virtual microphone. To repeat: start the simulator with `--aid alsa:pulse`, then `node scripts/simulator-voice.mjs <outDir> <token> <question.wav>` (set DISCARD=1 to test discarding):
   - `apt-get install -y pulseaudio pulseaudio-utils sox xvfb xdotool ffmpeg libwebkit2gtk-4.1-0`
   - `pulseaudio -D --exit-idle-time=-1`; `pactl load-module module-null-sink sink_name=askwise_voice`; `pactl load-module module-remap-source master=askwise_voice.monitor source_name=askwise_mic`; `pactl set-default-source askwise_mic`
   - Spoken question: ElevenLabs is connected through the proxy (no key needed): `POST https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=pcm_16000`. Verified OpenAI transcribes it word for word.
   - Simulator automation (port 9898): `POST /api/input {"action":"long_press"}`, play audio with `paplay -d askwise_voice`, then `{"action":"long_press_release"}`, screenshot, `{"action":"click"}`.
   - Then add voice to README and screenshots only if it works.
3. Vercel deployment (owner chose Vercel and approved preparing it; ask before creating the project): SQLite file is not persistent on Vercel -> move storage to Neon Postgres (free), run research within the request (up to 300 s on the free plan, use waitUntil or a streaming/polling design). Then set env vars in Vercel (owner enters secrets in the dashboard).
4. After hosting: guide the owner to create a Notion public (OAuth) connection with redirect `https://<host>/api/integrations/notion/callback`; owner sets NOTION_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI in Vercel.
5. Owner to-do: Notion -> AskWise shared reports -> Share -> Publish; send the public link (set NOTION_SHARED_PAGE_URL).
6. Final demo video only after the owner approves the build (scripts/simulator-run.mjs + ffmpeg x11grab; intro/outro cards).
7. Final cleanup only when the owner asks (rule 9).

## Environment notes (build sandbox)
- Keys are injected by the proxy for api.openai.com, api.notion.com, api.elevenlabs.io. Run the service with:
  `NODE_USE_ENV_PROXY=1 OPENAI_API_KEY=proxy-injected NOTION_TOKEN=proxy-injected NOTION_SHARED_PAGE_ID=424669a3-d1fd-811f-ad46-f66d0c26cfd6 npx tsx server/index.ts`
- Notion pages (owner workspace "Isheno Ebenezer's Notion"): AskWise 424669a3-d1fd-81fc-a21d-c65858f0883c, Reports 424669a3-d1fd-8102-a0dc-c9e3ca70ae3a, Research notes 424669a3-d1fd-8179-9665-c0baaa7d5489.
- Simulator: `@evenrealities/sim-linux-x64` binary under node_modules; run on Xvfb :99 with `--automation-port 9898`. Phone page is the left 600x800 webview at screen offset (204,50); type into it with xdotool.
- Gotchas: `pkill -f` patterns must not match your own shell (use `[x]vfb` style); never chain `git commit` after `vitest | grep` (grep succeeds even when tests fail); simulator webview keeps localStorage between runs.
- Owner prefers: plain human wording, dark+light themes, no hackathon wording in product, asks before spending/publishing.
