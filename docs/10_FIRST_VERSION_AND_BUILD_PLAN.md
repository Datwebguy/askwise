# 10. FIRST VERSION AND BUILD PLAN

## 1. Our goal

Build a working version of AskWise before the November 29 deadline.

The long-term product vision stays broad.

The first version must prove that AskWise can research, compare, present an answer on G2 and save an approved report to Notion.

## 2. Main user journey

1. The user asks AskWise a question.
2. AskWise understands what the user wants.
3. The backend starts a research job.
4. AskWise searches for information.
5. It analyses the results.
6. It checks important claims.
7. It prepares an answer.
8. The glasses show a short result.
9. The phone shows the full report.
10. The user checks the sources.
11. The user approves saving the report.
12. AskWise saves it to Notion.

## 3. Features required for the first version

### Product research
- Identify exact product models.
- Compare specifications.
- Find reviews.
- Find prices when reliable sources exist.
- Record country, currency and time checked.
- Explain advantages and disadvantages.
- Show missing information.

### General research
Support at least one general research workflow using the same research engine.

### Source checking
Important claims must have sources and clear status labels.

Show when sources disagree.

### G2 display
Show useful short answers.

### Phone report
Show the full report and source links.

### Notion
Read a selected Notion page.

Prepare a report and save it only after approval.

### Reliability
Handle errors and prevent duplicate exports.

## 4. Features for later

- Research history.
- Follow-up questions.
- Saved comparison preferences.
- Automatic price rechecking.
- More countries and currencies.
- More research categories.
- More integrations.
- Multiple model providers.
- Advanced multi-agent systems.

These features remain part of the wider vision. They do not need to be completed for the first demo.

## 5. Build schedule

### November 26
- Set up the project.
- Create the GitHub repository through the owner.
- Use the official G2 template.
- Build basic glasses screens.
- Test OpenAI web research.

### November 27
- Build the research backend.
- Connect the G2 application.
- Submit questions.
- Return research results.
- Add speech-to-text if time allows.

### November 27 to 28
- Add product research.
- Add product comparison.
- Add general research.
- Add source checking.

### November 28
- Connect Notion.
- Read a selected page.
- Prepare an export preview.
- Add approval.
- Save an approved report.
- Build the phone report.

### November 28
- Improve the interface.
- Test the complete workflow.
- Fix important problems.
- Rehearse the demo.

### November 29
- Record the demo on the owner's computer.
- Finish the README.
- Check the repository.
- Submit early, before the deadline.

## 6. If time becomes limited

Protect these features first:

1. Product research and comparison.
2. Source checking.
3. Useful G2 results.
4. Full phone report.
5. One working Notion read and write flow with approval.

Delay secondary features before sacrificing the main experience.

## 7. Definition of a successful first version

A judge should be able to watch AskWise receive a question, research it, compare information, show a useful result on G2, display its sources on the phone and save an approved report to Notion.
