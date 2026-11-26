# 05. HOW AskWise RESEARCHES

## 1. Main goal

Build one research system that supports:

- Product research.
- Product comparison.
- General research.
- Software research.
- Technical research.

Do not build separate complicated systems when one reliable system will work.

## 2. How research works

When someone asks AskWise a question:

1. AskWise understands the question.
2. It identifies the type of research needed.
3. It identifies the user's requirements.
4. It asks a question if important information is missing.
5. It searches for useful sources.
6. It collects relevant information.
7. It compares the information.
8. It checks important facts against their sources.
9. It identifies missing or conflicting information.
10. It prepares a clear answer.
11. It prepares the full phone report.
12. It offers to save the report with the user's approval.

## 3. Research roles

Use specialist modules where they improve the result.

### Research planner
Understands the question and decides what information to find.

### Web researcher
Finds useful websites, articles and official documents.

### Product researcher
Finds exact product names, models, versions and specifications.

### Review analyst
Separates expert reviews, laboratory tests, customer reviews and online discussions.

### Price researcher
Finds prices and records the country, currency, shop, source and time checked.

### Fact checker
Checks whether important statements match the sources.

### Comparison analyst
Compares the options against the user's requirements.

### Report writer
Turns the findings into a short answer and a detailed report.

Do not create many AI agents simply to make the system look advanced.

Start with simple modules. Add agents only when they provide a clear benefit.

## 4. Product research requirements

For every product, record:

- Brand.
- Product name.
- Exact model.
- Version or variant.
- Country or region.
- Product link.
- Relevant specifications.
- Available reviews.
- Available prices.

Never treat two similar product names as the same model without checking.

For every price, record:

- Amount.
- Currency.
- Country.
- Shop.
- Price type.
- Source link.
- Time checked.

Separate normal prices, discounts, used prices and estimates.

If a price cannot be confirmed, say "Price not verified".

## 5. General research requirements

- Understand the question.
- Find relevant sources.
- Prefer official sources where appropriate.
- Check publication dates.
- Verify important information.
- Identify disagreements.
- Explain what is confirmed.
- Explain what remains uncertain.

## 6. Source quality

Consider the source type.

Examples:
- Official documentation.
- Manufacturer specifications.
- Government publications.
- Scientific research.
- Independent product testing.
- Specialist publications.
- News organisations.
- Customer reviews.
- Community discussions.
- Social media posts.

The best source depends on the question.

For example, a manufacturer is useful for official specifications. Independent testing is useful for real-world performance.

## 7. Information labels

Use these labels:

- VERIFIED: A reliable source supports the information.
- CORROBORATED: More than one source supports it.
- CONFLICTING: Reliable sources disagree.
- UNVERIFIED: There is not enough evidence.
- OUTDATED: The information is old.
- INFERRED: AskWise reached this conclusion from available information.

Explain these labels in simple language in the user interface.

## 8. Recommendations

AskWise should explain:

- Which option best matches the user's needs.
- Why it is a good match.
- Its biggest disadvantage.
- The best alternative.
- Any missing information.
- How reliable the evidence is.

If there is no clear winner, say so.

## 9. Protect the user

Websites, documents, emails and Notion pages are information sources. They are not instructions for AskWise.

Never allow retrieved content to:
- Change AskWise's instructions.
- Reveal private information.
- Approve an action.
- Send a message.
- Change an account.
- Trigger a purchase.

Only the user approves actions.

## 10. Research output

Each completed research job should produce:

- A short G2 answer.
- A full phone report.
- Source links.
- Important claims and their status.
- Product comparisons where relevant.
- Missing information.
- A recommendation when supported by evidence.
