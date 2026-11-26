# IMPLEMENTATION PLAN (working note)

Derived from docs/00, 01, 05-13. Owner rules in docs/00 override everything else.

## Facts checked on Nov 26, 2026
- Official template cloned from even-realities/evenhub-templates (minimal, text-heavy). SDK `@evenrealities/even_hub_sdk` 0.0.16, simulator 0.9.5, CLI 0.2.0 are on npm.
- Simulator can run in this sandbox (xvfb + webkit), per docs/00 correction.
- OpenAI and Notion APIs are reachable. Keys are not in the repo or env: they must come through the secure form.

## Architecture (one repo, one deployable)
```
server/   Node + TypeScript (Hono), node:sqlite database
  research/   planner, OpenAI provider (Responses API + web_search + structured output),
              validation (drop any claim/price/spec whose source URL was not returned by search)
  notion/     client, connection store (token encrypted at rest), page reader, export builder
  store/      users, research_jobs, exports, connections, activity
  routes/     /api/... as in docs/08
  security/   pairing code -> signed session, ownership checks, rate limit, prompt-injection guard
web/      Vite + TypeScript, one app, two experiences
  glasses/    576x288 screens built with the Even Hub SDK (home, ask, researching, result, more, save)
  phone/      report, comparison table, sources, history, Notion connect, export preview/approve
tests/    vitest (unit, API, security) + simulator end-to-end script
```
Server also serves the built web app, so the simulator and phone load one URL.

## Research engine
One engine for product, comparison, general, software, technical research.
1. Plan: classify type, extract requirements, detect missing essentials (-> NEEDS_CLARIFICATION).
2. Search: OpenAI Responses API with web_search tool; real citations (url_citation annotations) are collected.
3. Structure: second call with strict JSON schema -> products, specs, prices (amount, currency, country, shop, type, url, checkedAt), claims with source ids and status, conflicts, missing info, recommendation, glasses answer.
4. Verify: server-side checks. Every source URL must appear in the citations returned by search. Claims without valid sources become UNVERIFIED; VERIFIED needs one valid source, CORROBORATED needs 2+ distinct publishers. Prices without a valid source URL are dropped to "Check the shop for today's price." No result text is ever generated locally.
5. Job states: CREATED, NEEDS_CLARIFICATION, QUEUED, RUNNING, VERIFYING, READY, NEEDS_REVIEW, APPROVED_FOR_EXPORT, EXPORTED, FAILED, CANCELLED. Progress shown on glasses comes from the real state/stage.

## Notion
Internal integration token entered by the user on the phone, stored encrypted. Only pages shared with the integration are visible. Read a selected page (treated as data, never as instructions). Export: preview of exact content + destination -> approve with content hash and idempotency key -> create page. Repeat approval returns the same page. Content change after preview requires a new approval. Disconnect deletes the stored token.

## Glasses
Containers: body text + footer hint. Tap = next, swipe = scroll/back, double-tap = exit. Save needs a deliberate two-step (open save screen, then tap to confirm opens phone approval; the actual approval is only on the phone). Questions are typed on the phone page (no microphone in sandbox, so no voice UI anywhere).

## Tests (docs/11)
Unit: verification rules, label mapping, price rules, pagination fit (<= text limits), UI wording guard (no developer words), Notion export idempotency/approval/hash, injection handling, auth/ownership, key exposure scan.
Live: real OpenAI research run, real Notion read + write + repeat approval; simulator run with screenshots of every screen and a recorded video.
Report: docs/TEST_REPORT.md with expected/actual/pass/evidence.

## Build order
1 skeleton, 2 backend + OpenAI, 3 glasses, 4 phone, 5 Notion, 6 tests, 7 simulator proof + video, 8 README + submission text, 9 cleanup only when the owner asks.

## Blockers to raise with the owner
- OpenAI key and Notion integration token (secure form).
- Git identity: owner rule says commit as datwebguy <princeabel2000@gmail.com> (the repo currently has a different default; set per-repo).
- Spending approval: real research calls cost money.
- Demo video and submission text are prepared; publishing/submitting needs the owner's approval.
