# 04. INTEGRATION DISCOVERY

## 1. Decisions already made

The product owner has selected:

- AI research provider: OpenAI.
- Main hackathon integration: Notion.
- Hackathon track: AI Assistants and Work.

Do not change these decisions without permission.

Other integrations should be investigated for future versions.

## 2. Applications listed in the hackathon

### AI Assistants and Work
- Claude.
- ChatGPT.
- OpenRouter.
- Notion.
- Gmail.
- Google Calendar.
- Google Drive.

### Messaging and News
- Telegram.
- Discord.
- Slack.

Other tracks also list financial applications. Check the official rules before considering any of them.

Do not assume Gemini, Perplexity or Outlook qualify.

## 3. How AskWise should use the integrations

### Notion
Our first integration.

AskWise should:
- Connect to Notion.
- Read pages selected by the user.
- Use those pages when answering relevant questions.
- Prepare research reports.
- Show the report before saving.
- Save only after the user approves.

### Google Workspace
Possible future features:

- Use selected Gmail conversations as research context.
- Check selected Calendar events.
- Use selected Drive documents.
- Prepare information for the user to review.

### Slack and Discord
Possible future features:

- Research information from selected channels.
- Summarise relevant discussions.
- Save approved research reports.

### Telegram
Possible future features:

- Send research questions to AskWise.
- Receive completed reports.
- Share approved summaries.

## 4. Research the APIs

For each application, investigate:

- Official API documentation.
- Authentication method.
- Required permissions.
- What information AskWise is allowed to read.
- What AskWise is allowed to create or update.
- Security requirements.
- Approval or verification requirements.
- Setup difficulty.
- Cost.
- Demo reliability.
- Whether it qualifies for the hackathon track.

Do not assume an API has permissions simply because its website describes a feature.

## 5. OpenAI

OpenAI is our selected research provider.

Official documentation:
https://platform.openai.com/docs/guides/tools-web-search

Investigate:
- Web search.
- Source links and citations.
- Structured responses.
- Model costs.
- Rate limits.
- Speech-to-text options.
- Reliability.
- Error handling.

Record the current pricing and limits from official documentation.

## 6. Notion

Official documentation:
https://developers.notion.com/

Investigate:
- Authentication.
- Connecting a workspace.
- Reading selected pages.
- Reading databases.
- Creating pages.
- Updating pages.
- Required permissions.
- Token security.

The user should choose which Notion pages AskWise accesses.

## 7. Compare integrations

Create a comparison table.

Score each integration from 1 to 5 based on:

- Hackathon eligibility.
- Value to AskWise.
- Ability to read information.
- Ability to write information.
- Development effort.
- Permission requirements.
- Security.
- Demo reliability.
- User setup.
- Long-term value.

Explain every score.

## 8. Important rule

Using an AI model API does not automatically mean we have integrated a listed hackathon application.

Confirm the rules.

Notion must remain a working integration for the first version.

## 9. Required report

Create INTEGRATION_DECISION.md.

Include the research, API links, permissions, limitations, eligibility, cost, security and final recommendations.
