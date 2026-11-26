# 08. DATABASE AND API PLAN

## 1. What information AskWise needs to store

AskWise needs to remember research jobs, sources, results and approved Notion exports.

The long-term system should support:

### Users
User ID, preferences, country, currency and account settings.

### Connections
Connected services, account details, permissions and connection status.

### Research jobs
Question, research type, requirements, status and dates.

### Sources
Website title, URL, publisher, source type and date checked.

### Claims
Important statements, their sources and verification status.

### Products
Brand, product name, exact model, version, region, specifications and price information.

### Reports
Short answer, full report, recommendations, alternatives and disadvantages.

### Export approvals
Destination, approved content, approval status and result.

### Activity records
Important actions and security events.

## 2. Minimum database for the hackathon

Keep the first version simple.

Use three main tables:

### research_jobs
Stores the question, requirements, status, sources, claims, product information and report.

### exports
Stores Notion export details, approval status, content hash and duplicate-prevention key.

### connections
Stores the Notion connection reference and permissions.

Store tokens securely. Do not expose them to the frontend.

## 3. API routes

### Research

POST /api/research

Create a research request.

GET /api/research/:jobId

Check research progress.

GET /api/research/:jobId/report

Get the completed report.

GET /api/research/:jobId/sources

Get the sources.

POST /api/research/:jobId/clarify

Send additional information.

POST /api/research/:jobId/cancel

Cancel a research job.

### Integrations

GET /api/integrations

List connected services.

POST /api/integrations/:provider/connect

Start a connection.

GET /api/integrations/:provider/callback

Handle the connection response.

DELETE /api/integrations/:provider

Disconnect a service.

### Report exports

POST /api/reports/:reportId/export-preview

Prepare the Notion export preview.

POST /api/reports/:reportId/approve-export

Approve and perform the export.

POST /api/reports/:reportId/reject-export

Reject the export.

Adjust these routes to match the selected framework.

## 4. API security

Every private request must:

- Check the user's identity.
- Check ownership of the requested data.
- Validate the input.
- Check the research status.
- Prevent unauthorised access.
- Limit expensive requests.
- Return safe error messages.
- Avoid exposing private tokens.

For the hackathon, a simple pairing code is acceptable if it is implemented safely.

## 5. Notion approval

Before saving a report, show:

- The Notion destination.
- The exact content.
- Whether AskWise will create or update a page.
- Any private information included.

If the report changes after approval, ask for approval again.

## 6. Prevent duplicate writes

Use an idempotency key.

If the user repeats the same approval, AskWise must not create another copy of the same report.

## 7. Data retention

Document:
- What AskWise stores.
- How long it stores research.
- How users disconnect Notion.
- How users delete their data.
- How connected content is handled.

Only store information needed for the service.
