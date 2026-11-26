# 07. ASKWISE SYSTEM ARCHITECTURE

## 1. How the system works

AskWise has three main parts:

1. The G2 glasses application.
2. The phone interface.
3. The backend that handles research.

The glasses and phone communicate with the backend.

The backend handles AI research, sources, comparisons and Notion.

## 2. Main system

G2 glasses and phone interface
        |
        v
AskWise backend
        |
        |-- User authentication
        |-- Research requests
        |-- Research engine
        |-- Product comparison
        |-- General research
        |-- Source checking
        |-- Report creation
        |-- Notion connection
        |-- Database
        |
        v
Research results

## 3. First version technology

The selected research provider is OpenAI.

The selected integration is Notion.

The proposed backend is Vercel with a small database.

Confirm the deployment limits and costs before choosing the final setup.

The first version should use a simple research job with a time limit. The app can check the backend for updates.

Avoid building a complicated queue unless testing shows we need one.

## 4. Important design rules

- Keep the glasses application lightweight.
- Run research on the backend.
- Keep API keys on the backend.
- Save research results.
- Record source information.
- Handle errors.
- Prevent duplicate Notion writes.
- Require user approval before external actions.

## 5. Research job stages

Use these stages:

- CREATED
- NEEDS_CLARIFICATION
- QUEUED
- RUNNING
- VERIFYING
- READY
- NEEDS_REVIEW
- APPROVED_FOR_EXPORT
- EXPORTED
- FAILED
- CANCELLED

The backend must update the status correctly.

## 6. OpenAI

Use OpenAI as the first research provider.

Investigate its Responses API, web search, citations, structured outputs, limits and costs.

Keep the provider code separate so another provider can be added later.

## 7. Notion

Build a separate Notion integration module.

It should support:
- Connecting.
- Checking connection status.
- Reading selected pages.
- Preparing a report.
- Showing an export preview.
- Writing an approved report.
- Disconnecting.

## 8. External actions

The AI model must never approve its own actions.

Before AskWise writes to Notion, the backend must confirm:

- The user is authenticated.
- The report exists.
- The user approved the action.
- The destination is correct.
- The approved content has not changed.
- The action has not already been completed.

## 9. Demo data

Demo data must be clearly labelled.

Do not describe saved sample results as live research.

Keep live research, test integrations and demonstration data separate.
