# TEST REPORT (working note)

Date: November 26, 2026. Every result below comes from a real run in this build environment.

How each kind of test was run:
- **Automated**: `npm test` (Vitest, 75 tests). Uses labelled test fixtures in `tests/fixtures/` only.
- **Live**: real OpenAI web research and the real Notion workspace ("Isheno Ebenezer's Notion", pages AskWise / Reports / Research notes).
- **Simulator**: the official Even Realities simulator 0.9.5 (`@evenrealities/sim-linux-x64`), driven with `scripts/simulator-run.mjs` (full flow) and `scripts/simulator-checks.mjs` (harder moments). The question is typed on the phone page inside the simulator; glasses gestures use the simulator's automation API.

## 7. Most important tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| No invented sources | Only pages returned by the web search can be cited | Unknown source numbers are dropped and the fact becomes "Not confirmed yet"; product links not found by the search are removed | Pass | verify.test.ts "drops source numbers…", "removes product links…"; live reports list only real URLs |
| No invented prices | A price needs a real source, amount, currency, shop and country | Prices without them are removed and "Check the shop for today's price." is shown | Pass | verify.test.ts "keeps only prices with a real source…", "removes a price with an invalid amount…" |
| No invented specifications | Unsourced specs are never shown as confirmed | Marked "Not confirmed yet" | Pass | verify.test.ts "marks specifications without a source…"; live report shows the label on unsourced specs |
| No unapproved Notion writes | Nothing is written before an explicit approval of the exact content | Preview writes nothing; approval needs `approved: true`, the preview and its fingerprint; rejected previews cannot be approved; text in a Notion page asking to "approve the export" has no effect | Pass | api.test.ts Notion group (7 tests) |
| No duplicate exports | Repeating approval returns the existing page | Two approvals at once plus two later ones created exactly one page; live repeat returned `repeated: true` and Notion shows one page | Pass | api.test.ts "never creates a duplicate…"; live check on Nov 26 (one child page under Reports) |
| No exposed API keys | Keys stay on the service | Phone/glasses code never reads keys or calls OpenAI/Notion; no key pattern in the repository or built app; logs redact keys | Pass | secrets.test.ts (4 tests), api.test.ts "never sends the Notion secret…" |
| G2 screens work in the simulator | All screens render, fit and respond to gestures | Home, progress, follow-up question, answer pages, stopped, reconnecting and save screens shown and navigated | Pass | Simulator screenshots in media/ and the demo video |

## 1. Research tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| Receives questions | Valid questions start research; empty or too long are refused kindly | As expected | Pass | api.test.ts "validates questions", live runs |
| Research starts correctly | Plan, search, structure, check, write | Calls run in order and a report is saved | Pass | api.test.ts "receives a question, runs every step…"; 6 live runs |
| Status updates | Real steps are visible while running | Understanding → Searching → Comparing → Checking → Writing, shown on glasses and phone | Pass | api.test.ts "shows real progress…"; simulator progress screenshots |
| Failed searches show useful messages | Friendly message, no technical detail | "AskWise couldn't finish this research. Let's try that again." with no codes or keys | Pass | api.test.ts "shows a friendly message…" |
| Completed reports are saved | Report stored and retrievable | As expected | Pass | api.test.ts; History page |
| Duplicate requests handled | Same request key or same running question returns the same research | One search only | Pass | api.test.ts "handles a repeated request…" |
| Cancelled research stops | Status stays Cancelled; no report written later | As expected, also in the simulator | Pass | api.test.ts "stops cancelled research…"; simulator check 2 |
| Time limit | Research past the limit stops | As expected | Pass | api.test.ts "stops research that runs past the time limit" |
| Follow-up question | Missing key detail triggers one question; answer or skip continues | As expected, also in the simulator | Pass | api.test.ts 2 tests; simulator check 1 |

## 2. Product research tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| Exact models | Brand, model and variant per product | Live: "MacBook Air 13-inch (M4, 2025) 16GB/512GB", "XPS 13 9350", "Zenbook 14 OLED UM3406KA" with SKUs | Pass | Live Notion report page |
| Versions not mixed up | Each product keeps its own model/variant | As expected | Pass | verify.test.ts "keeps exact model and variant separate…" |
| Specs have sources | Every confirmed spec links to a page | As expected | Pass | Live report numbered links; verify.test.ts |
| Prices show currency, country and time checked | All present | e.g. "999 USD at Best Buy, US. Checked 26 Nov 2026, 16:59 UTC" | Pass | Live Notion page; verify.test.ts |
| Missing prices stay unverified | "Check the shop for today's price." | As expected | Pass | verify.test.ts "leaves missing prices unconfirmed" |
| Recommendation matches requirements | Fits the stated budget and needs | Live: picked the MacBook Air M4 within $1,100 and flagged the XPS 13 starting price above budget | Pass | Live report |
| Conflicting information visible | Shown under "Where sources disagree" | As expected | Pass | verify.test.ts; Checks tab |

## 3. General research tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| Relevant sources | Sources match the question | Live passkeys research completed with cited sources | Pass | Simulator check 3 (passkeys) |
| Important claims checked | Each claim has a label and sources | As expected | Pass | Checks tab; verify.test.ts |
| Old information identified | "May be out of date" needs a source | As expected | Pass | verify.test.ts "flags old information only with a source" |
| Conflicts shown | Two or more sources needed to say they disagree | As expected | Pass | verify.test.ts |
| Unsupported claims never confirmed | Never "Confirmed" without a source | As expected | Pass | verify.test.ts "never marks an unsupported claim…" |
| Facts separated from conclusions | Conclusions labelled "Our conclusion" | As expected | Pass | verify.test.ts "keeps conclusions separate…" |

## 4. G2 tests (official simulator)

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| App opens | Welcome/home screen | As expected | Pass | glasses-screens.png |
| Text fits | Every page within the display and limits | Measured with the firmware's text widths for every screen state | Pass | glasses.test.ts "fits every page…"; screenshots |
| Navigation and touch controls | Tap next, swipe up back, double-tap exit | Tapped through all 6 answer screens and back home | Pass | simulator-run.mjs, demo video |
| Loading screens | Real progress | As expected | Pass | progress screenshots |
| Error screens | Calm stopped screen | "Research stopped… Ask again on your phone." | Pass | simulator check 2 |
| Network recovery | Reconnects without action | Phone shows "Reconnecting to AskWise…", glasses keep the last answer, both recover when the service returns | Pass | simulator check 4 (17:04:45 PASS) |
| App suspension | Research continues; reopening shows it | Simulator closed mid-research, research finished, reopened app showed the result | Pass | simulator check 3 |
| Long reports stay on the phone | Glasses show short screens only | As expected | Pass | glasses.test.ts; screenshots |

## 5. Notion tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| Connects | Workspace name shown | "Isheno Ebenezer's Notion" | Pass | Live; Settings page |
| Only selected pages accessed | Only shared pages listed; unshared pages refused; only the chosen page read | Live listing returned exactly AskWise, Reports, Research notes | Pass | api.test.ts 3 tests; live |
| Disconnecting works | Later requests refused | As expected | Pass | api.test.ts "disconnects and then refuses…" |
| Preview shows exact content | Same lines are written | Created page has the same title and block count as the preview | Pass | api.test.ts "creates the page only after approval…" |
| Rejecting prevents the write | No page | As expected | Pass | api.test.ts "writes nothing after the person chooses not to save" |
| Approval creates the report | One new page under the chosen page | Live pages created under AskWise / Reports | Pass | Notion page "AskWise: MacBook Air M4 vs XPS 13 vs Zenbook" |
| Repeating approval makes no duplicate | Same page returned | As expected, live and automated | Pass | see above |
| Revoked access stops requests | Marked "connect again" and no further calls | As expected | Pass | api.test.ts "stops further requests after access is revoked…" |

## 6. Security tests

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| Keys stay on the service | See above | Pass | Pass | secrets.test.ts |
| Invalid sessions rejected | 401 with a friendly message | As expected; sign-in attempts are limited | Pass | api.test.ts sign-in group |
| One person cannot access another's research | 404 for every research and save route | As expected | Pass | api.test.ts "one person cannot see or act on…" |
| Malicious instructions in content | Treated as information | Page text is fenced and labelled; it cannot trigger a save | Pass | openai.test.ts; api.test.ts "reads only the chosen page…" |
| Unapproved exports never happen | See above | Pass | Pass | api.test.ts |
| Logs reveal no private information | Keys and content not logged | As expected | Pass | api.test.ts "keeps activity records free…" |

## 8. Demo test

Run on November 26, 2026 with `scripts/simulator-run.mjs` in the official simulator, recorded to `media/askwise-demo.mp4` (97 seconds; the waiting part is shown 10x faster and labelled).

1. Reset: fresh database and account. Pass
2. Open the app in the simulator. Pass
3. Ask a product comparison question (typed on the phone page). Pass
4. Wait for the research (about 90 seconds, real). Pass
5. View the answer on the glasses (6 screens). Pass
6. Open the phone report. Pass
7. Check the sources (Sources tab). Pass
8. Check one supported claim (Checks tab, "Confirmed" with source links). Pass
9. Check one uncertainty ("What we couldn't confirm", "Not confirmed yet"). Pass
10. Approve saving the report. Pass
11. Confirm the Notion page exists (read back through Notion). Pass
12. Repeat approval and confirm no duplicate. Pass (automated and live API check)

## Known problems and remaining risks (owner only)

- The cheap research model sometimes names the same spec differently for each product, which leaves gaps ("—") in the comparison table.
- Research takes 60 to 120 seconds with the low-cost model.
- The service runs in this build environment only; it is not hosted anywhere public yet.
- Voice input is not built.
- The demo video has no narration.

## Simulator checks run (scripts/simulator-checks.mjs, Nov 26, 2026)

```
17:02:46 PASS Follow-up question shows on the glasses
17:02:55 PASS Stopping research shows a calm stopped screen
17:04:15 PASS Research finished while the app was closed
17:04:45 PASS Connection comes back on its own
```
