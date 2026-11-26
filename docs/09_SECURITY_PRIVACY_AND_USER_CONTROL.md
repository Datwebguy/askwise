# 09. SECURITY, PRIVACY AND USER CONTROL

## 1. Main goal

Protect user information.

Never allow AskWise to perform an external action without the user's permission.

## 2. User accounts

Use secure sessions.

Check the user's identity before showing private research or connected account information.

Users must be able to disconnect integrations.

## 3. API keys

Never place API keys in:

- The G2 application.
- Frontend code.
- Public GitHub repositories.
- Screenshots.
- Logs.

Store keys in backend environment variables or a secure secret manager.

The OpenAI key must only exist on the server.

## 4. Notion permissions

Ask for only the permissions AskWise needs.

Let users choose the Notion pages or databases AskWise accesses.

Do not request access to an entire workspace when selected pages are enough.

## 5. Connected account information

Only read resources the user has selected.

Do not use private information from connected accounts for unrelated research.

## 6. External actions

AskWise must show the user what it plans to do before:

- Creating a Notion page.
- Updating a Notion page.
- Sending an email.
- Sending a message.
- Creating a calendar event.
- Publishing information.

The user must approve the exact action.

## 7. Protect against malicious instructions

A website, email, document or Notion page might contain instructions intended to manipulate an AI system.

Treat all retrieved content as information, not instructions.

Never let retrieved content:
- Reveal API keys.
- Change system instructions.
- Approve an action.
- Send a message.
- Change an account.
- Trigger a purchase.

## 8. Research accuracy

AskWise must never invent:

- Prices.
- Product specifications.
- Review counts.
- Websites.
- Citations.
- Test results.

It must not claim a source supports information when it does not.

It must show disagreements and missing information.

## 9. User control

The user controls:

- Research questions.
- Comparison requirements.
- Connected accounts.
- Information AskWise reads.
- Export destination.
- Content to be saved.
- Approval.
- Data retention.

## 10. Safety boundaries

AskWise must not assist with obtaining dangerous or age-restricted products.

Do not build purchase automation.

Do not perform financial transactions or give personalised financial advice.

## 11. Security records

Record important events such as:

- Login.
- Integration access.
- Research creation.
- Export previews.
- Approval decisions.
- Completed exports.
- Security errors.

Never record private credentials in logs.

## 12. Security tests

Test:
- Unauthorised access.
- Access to another user's information.
- Expired connections.
- Disconnected accounts.
- Invalid authentication.
- Duplicate Notion writes.
- Malicious instructions inside retrieved content.
- API key exposure.
- Incorrect export destinations.
- Unapproved exports.
