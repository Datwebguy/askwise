# 06. EVEN REALITIES G2 DESIGN AND DEVICE REQUIREMENTS

## 1. Main design rule

Design for smart glasses.

Do not copy a normal phone interface onto the glasses.

The glasses show short answers. The phone shows the full information.

## 2. Official documentation

Read the current Even Realities documentation:

https://hub.evenrealities.com/docs/ship/app-submission

https://hub.evenrealities.com/docs/build/display

https://hub.evenrealities.com/docs/build/device-apis

https://hub.evenrealities.com/docs/build/networking

https://hub.evenrealities.com/docs/build/background-lifecycle

https://hub.evenrealities.com/docs/test/simulator

Official templates:
https://github.com/even-realities/evenhub-templates

Check the latest SDK versions before implementation.

## 3. Device facts recorded on November 26

- Display resolution: 576 x 288.
- Display uses green 4-bit greyscale.
- Maximum 4 image containers and 8 other containers.
- Exactly one container captures input.
- No custom fonts.
- No emoji support in the display content.
- A full screen holds roughly 400 to 500 characters.
- Text brightness ranges from 0 to 4.
- Initial content limits and update limits depend on the SDK operation.
- The device uses touchpads and supports the optional R1 ring.
- Gestures include press, double press, swipe up and swipe down.
- Long press exists but the operating system might use it.
- The glasses have microphones.
- They do not have a built-in keyboard.
- They have no camera, speaker or haptics.
- The glasses do not provide built-in speech-to-text.
- Speech-to-text needs a service.
- The app uses network permissions and approved domains.
- API keys must stay on the backend.

Check the official documentation before relying on exact SDK limits.

## 4. One application, two experiences

Build one web application with two interfaces.

### Glasses interface
Designed for short answers and simple interactions.

### Phone interface
Designed for:
- Full research reports.
- Comparison tables.
- Sources.
- Settings.
- Research history.
- Notion connection.
- Export approval.

## 5. Glasses experience

### Home
Show AskWise's name and a short instruction.

### Ask
The user asks a question through the microphone or types on the phone.

### Researching
Show the actual progress of the research.

Do not display fake activity.

### Result
Show:
- Main answer.
- Best option when justified.
- Main reason.
- Main disadvantage.
- Evidence status.
- Price check time when relevant.

### More options
Allow users to view alternatives or continue the research.

### Save
Let the user open the phone report and approve saving it.

Do not allow one accidental touch to approve an external action.

## 6. Phone experience

The phone should show:

- Full research report.
- Product comparison table.
- Product specifications.
- Prices and dates checked.
- Source links.
- Conflicting information.
- Missing information.
- Previous research.
- Follow-up questions.
- Notion connection.
- Save preview and approval.

Use a clean, light design.

## 7. Connection and background behaviour

The backend handles research.

The glasses send questions and receive results.

The app must handle:
- Network failures.
- Slow responses.
- Reconnection.
- App suspension.
- Lost connection.
- Saved research progress.

Do not assume the app keeps running in the background.

The glasses cannot show AskWise notifications while another app is open or while AskWise is closed.

## 8. Simulator

Use the official Even Realities simulator.

The agent's sandbox does not support running the simulator.

The product owner must run it on their own computer and record the demo.

Test:
- Display layout.
- Text limits.
- Touch controls.
- Loading screens.
- Error screens.
- Network interruption.
- Reconnection.
- App suspension.

## 9. Final experience test

A user should understand AskWise's answer from the glasses alone.

They should only need the phone for the full explanation and evidence.
