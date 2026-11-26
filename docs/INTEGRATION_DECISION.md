# INTEGRATION DECISION (working note)

Decision already made by the owner: **Notion** is the main integration, **OpenAI** is the research provider.

## Notion (built)

- API: https://developers.notion.com/
- Connection today: an internal connection token kept on the service. It sees only pages the owner shares with it (verified live: AskWise, Reports, Research notes).
- Permissions requested: Read content, Insert content. No user information. No update or delete.
- Reads: plain text of one chosen page, used as information only.
- Writes: one new page per approved report, under one chosen page. Content fingerprint and a one-time key prevent duplicates.
- Revoked access: detected (401/403/404), the connection is marked "connect again" and no further calls are made.
- Next: a "Connect Notion" button using Notion's public OAuth sign-in, so each person connects their own workspace without pasting anything. Needs the owner to switch the connection to public and provide its client ID and secret.

## OpenAI (built)

- Responses API with the `web_search` tool and `web_search_call.action.sources`, strict JSON output.
- Model: `gpt-5.4-nano` (cheapest that does the job). About $0.003 per web search call measured; a full research run is a fraction of a cent to a few cents.
- Sources: only pages returned by the search are allowed in reports (checked on the service).

## Scores (1 to 5)

| Integration | Eligible | Value | Read | Write | Effort | Permissions | Security | Demo reliability | User setup | Long-term |
|---|---|---|---|---|---|---|---|---|---|---|
| Notion | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 3 (5 with OAuth) | 5 |
| Google Drive / Docs | 5 | 4 | 4 | 4 | 2 | 2 | 3 | 3 | 3 | 4 |
| Gmail | 5 | 3 | 4 | 3 | 2 | 1 | 2 | 3 | 3 | 3 |
| Google Calendar | 5 | 2 | 3 | 3 | 3 | 2 | 3 | 4 | 3 | 3 |
| Telegram (other track) | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 5 | 4 |
| Slack / Discord (other track) | 3 | 3 | 3 | 4 | 3 | 3 | 3 | 4 | 3 | 3 |

Reasons in short: Google apps need Google's app verification for sensitive scopes (slow to approve); Gmail scopes are the most sensitive. Telegram is easy and useful for sending questions and receiving reports, and has its own special prize, but it is a different track and must have a genuine reason.

## Recommendation
1. Keep Notion as the main integration and add the Notion sign-in button.
2. Next version: Telegram for asking from anywhere and receiving finished reports.
3. Later: Google Drive for reading selected documents.
