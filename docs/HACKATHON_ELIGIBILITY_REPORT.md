# HACKATHON ELIGIBILITY REPORT (working note)

Checked against docs/02 (rules recorded on Nov 26, 2026). Recheck the official page before submitting: https://dorahacks.io/hackathon/even-realities/detail

## Our entry
- Track: **AI Assistants and Work**.
- Main integration: **Notion** (listed in this track). Reads a page the person chooses and creates approved report pages.
- Research provider: OpenAI (ChatGPT's maker). Whether an OpenAI API counts as the listed "ChatGPT" app is unconfirmed, so Notion carries eligibility on its own.

## Rules check

| Rule | Status | Evidence |
|---|---|---|
| 1 to 4 team members | Owner to confirm | Team section in README |
| Built during the event (from Nov 23) | Met | All code commits are from Nov 26; README "Project history" lists prior open-source tools |
| README explains what existed before Nov 23 | Met | README "Project history" |
| Main integration from the selected track | Met | Notion, real read and write |
| Second-track apps only with a genuine reason | Not used | None |
| No API keys or credentials committed | Met | secrets.test.ts scans the repository and build |
| Financial features safe | Not applicable | AskWise gives no financial advice and makes no purchases |

## Submission requirements

| Item | Status |
|---|---|
| Public GitHub repository | Repository exists; owner to confirm it is public |
| README with setup | Done |
| Demo video up to 3 minutes | Final recording after the owner approves the build; a test recording proves the flow |
| Short project description | docs/SUBMISSION_TEXT.md |
| Selected track | AI Assistants and Work |
| Packaged .ehpk (optional) | `npm run pack` is ready; needs the hosted address first |
| Up to 5 feature requests (optional) | Not drafted yet |

## Judging criteria and how AskWise answers them

| Criteria | Weight | AskWise |
|---|---:|---|
| Usefulness on G2 | 30% | Answer, reason, drawback, evidence and price time on the lens; live progress |
| Read and write integration | 25% | Notion read of a chosen page; approved, duplicate-safe page creation |
| Technical execution | 20% | Checked sources, 76 tests, simulator-driven checks |
| Display and voice experience | 15% | Display done; voice not built |
| Business potential and safety | 10% | Approval before any write, private accounts, spending limits |

## Open questions for the organisers
1. Does using the OpenAI API count as integrating "ChatGPT"?
2. Must judges be able to use a hosted version, or is the video plus repository enough?
