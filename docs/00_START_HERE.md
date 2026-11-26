# 00. START HERE: OWNER RULES AND START INSTRUCTIONS

Read this file first. Then read README.md and every file in docs/, starting with docs/13_INSTRUCTIONS_FOR_THE_AI_AGENT.md. These documents are the plan.

## Product

AskWise: an AI research and decision assistant for Even Realities G2 glasses.

Decisions already made by the owner:
- Track: AI Assistants and Work.
- Research provider: OpenAI.
- Main integration: Notion.

Deadline: November 29, 2026, 19:59 UTC.

The owner only has a phone and no laptop.

## Owner rules (these override anything in the other documents)

1. **No hard-coded data and no fake data anywhere.** Not in the app, the API, the glasses screens, the phone report, the README or the demo. Every result must come from a real call (OpenAI web search, Notion). No mock responses, no placeholder results, no seeded or "demo mode" data, no backup demo data. Test fixtures may exist only inside test files and must be clearly labelled as fixtures. If a real call fails or a key is missing, tell the owner about the blocker. Never replace it with made-up output.

2. **Do not stop halfway.** Keep working until the whole goal is achieved: a working app, tested end to end, repository ready, README written, demo video recorded, and submission text ready. Pause only to ask the owner about spending money, publishing anything, submitting a form, or a missing key. While waiting, continue with other work.

3. **Do not skip necessary things.** Everything in docs/10 (first version) and docs/11 (tests) must be built and tested. Do not leave required parts out and call the work finished.

4. **Do not remove things that should be there** (features, safety checks, tests) to make something pass or to save time. If a test fails, fix the cause. Do not delete or weaken the test.

5. **Never say "done" without proof.** Before saying any task is complete:
   - Run the tests and show the output.
   - Run the full flow in the simulator.
   - Show a screenshot of each screen.
   - Show the real Notion page that was created.
   - Search the code for TODO, placeholder, mock, fake, lorem and hard-coded results, and show that none remain.
   - Search the product files for the words "hackathon" and for developer words (see rule 7), and show that none remain.

   At the end, give the owner a completion audit: every requirement in docs/10 and docs/11, with the evidence for each. Tell the owner honestly, in chat, about anything unfinished.

6. **No hackathon wording in the build.** The words "hackathon", "judges", "track", "submission", "prize" and "deadline" must not appear in the app screens, the glasses screens, the phone pages, the code, code comments, the README, the screenshots or the demo video. Hackathon information is used only in the official submission form on the event page.
   - The README must still show what existed before the project started. Do this with a neutral "Project history" section: the project started on November 23, 2026, and it lists the open-source libraries and tools used. Do not use the word hackathon.

7. **No developer wording in the user interface.** Everything a user sees must be plain, everyday language, for glasses and phone. Never show these words or anything like them: API, JSON, backend, server, token, key, endpoint, SDK, WebView, simulator, job, queue, status codes, stack traces, IDs, "null", "undefined", "error 500".
   - Use friendly words for information labels:
     - VERIFIED: "Confirmed"
     - CORROBORATED: "Backed by several sources"
     - CONFLICTING: "Sources disagree"
     - UNVERIFIED: "Not confirmed yet"
     - OUTDATED: "May be out of date"
     - INFERRED: "Our conclusion"
   - For an unconfirmed price, say "Check the shop for today's price."
   - Messages must be short, warm and helpful. Example: "Let's try that again." Not "Request failed."

8. **No limitations and no negativity written anywhere in the product or repository.**
   - Do not write "Known limitations", "not supported", "coming soon", "planned", "demo only", "unavailable", "failed" or similar in the app, README, code comments or video.
   - Never claim something that does not work. If something is not built, leave it out of the product and the text. Do not describe the gap.
   - Do not show or mention voice input unless it really works end to end.
   - Problems, limits and unfinished work go to the owner privately in chat. They never go into the product or the public repository.

9. **Public repository cleanup at the end.** The final public repository must be product-only:
   - Rewrite README.md for the product: what AskWise does, how to use it, how to set it up, the Project history section from rule 6. No hackathon information, no limitations section.
   - Move the internal planning documents in docs/ (they mention the hackathon, rules, competitors and limits) out of the public repository. Ask the owner where to keep them before moving anything.

## Correction to the other documents: the simulator can run in the sandbox

The official simulator can run in the agent sandbox. This was tested on November 26, 2026:

```
apt-get install -y xvfb libwebkit2gtk-4.1-0 xauth
npm install @evenrealities/evenhub-simulator@0.9.5 @evenrealities/sim-linux-x64
xvfb-run -a -s "-screen 0 1280x800x24" <sim-linux-x64 binary> --automation-port 9898 <your app URL>
```

Record the screen with ffmpeg (`-f x11grab`) and send the owner the video file.

There is no microphone in the sandbox, so the demo question is typed on the phone page.

## Git rules

- Commit as `datwebguy <princeabel2000@gmail.com>`.
- Never add Claude, Claude Code or Anthropic as author or co-author.
- No Co-Authored-By lines. No "Generated with" lines. No session links.
- Do not create other repositories.
- Commit messages are short and plain. They must not mention the hackathon.

## Keys and approvals

- Ask for API keys through a secure form. Never in ordinary chat.
- Ask the owner before spending money, publishing anything, or submitting a form.

## Where to start

Write your plan from the documents first. Then build in this order:

1. Project skeleton from the official Even Hub template.
2. Backend with real OpenAI research.
3. Glasses screens connected to the real backend.
4. Phone report.
5. Notion: read a selected page and write an approved report.
6. Tests.
7. Demo recording.
8. README and submission text.

While the backend is not ready, screens may show empty or loading states. They must never show invented results.
