# 11. TESTING AND QUALITY CHECKS

## 1. Research tests

Check that:

- AskWise receives questions.
- Research jobs start correctly.
- Job status updates.
- Failed searches show useful errors.
- Completed reports are saved.
- Duplicate jobs are handled.
- Cancelled jobs stop correctly.

## 2. Product research tests

Check that:

- AskWise identifies exact models.
- Different versions are not mixed up.
- Specifications have sources.
- Prices show currency.
- Prices show the country or region.
- Prices show when they were checked.
- Missing prices remain unverified.
- Recommendations match the user's requirements.
- Conflicting information is visible.

## 3. General research tests

Check that:

- AskWise uses relevant sources.
- Important claims are checked.
- Old information is identified.
- Conflicting information is shown.
- Unsupported claims are never marked VERIFIED.
- Facts are separated from conclusions.

## 4. G2 tests

Run the official simulator on the owner's computer.

Check:

- App opens.
- Text fits.
- Navigation works.
- Touch controls work.
- Loading screens work.
- Error screens work.
- Network recovery works.
- App suspension does not corrupt the research.
- Long reports remain on the phone.

## 5. Notion tests

Check:

- Notion connects successfully.
- Only selected pages are accessed.
- Disconnecting works.
- Export preview shows the exact content.
- Rejecting an export prevents the write.
- Approval creates the report.
- Repeating approval does not create duplicates.
- Revoked access stops further requests.

## 6. Security tests

Check:

- API keys stay on the server.
- Invalid tokens are rejected.
- One user cannot access another user's research.
- Malicious website instructions do not control AskWise.
- Unapproved exports never happen.
- Logs do not reveal private information.

## 7. Most important tests

Complete these first:

1. No invented sources.
2. No invented prices.
3. No invented specifications.
4. No unapproved Notion writes.
5. No duplicate exports.
6. No exposed API keys.
7. G2 screens work in the simulator.

## 8. Demo test

Follow the complete workflow:

1. Reset AskWise.
2. Open the application.
3. Ask a product comparison question.
4. Wait for the research.
5. View the answer on G2.
6. Open the phone report.
7. Check the sources.
8. Check one supported claim.
9. Check one uncertainty or disagreement.
10. Approve saving the report.
11. Open Notion and confirm the page exists.
12. Repeat the approval and confirm no duplicate appears.

## 9. Required report

Create TEST_REPORT.md.

For every test, record:
- Test name.
- Expected result.
- Actual result.
- Pass or fail.
- Evidence.
- Known problems.
- Remaining risks.
