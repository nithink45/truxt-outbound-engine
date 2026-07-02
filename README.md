# Truxt Outbound Engine

Discovery-to-outreach engine for Truxt. Discovers ICP-fit companies from public data,
matches each company's specific public pain to the Truxt mechanism that addresses it,
identifies the decision-maker, drafts personalized outreach with line-by-line rationale,
and presents everything in a review dashboard. **A human approves every send — including
follow-ups. Nothing sends automatically.**

## Quick start

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or `ant auth login`
npm start                              # dashboard at http://localhost:3333
```

Optional: copy `.env.example` and fill in Slack / Instantly / HubSpot keys. Without them,
approved sends are written to `data/outbox/` (dry-run) so you can test end to end.

## The pipeline

| Stage | What | Where |
|---|---|---|
| 1 | ICP signal discovery (web search, source URLs per claim) | `src/stages/discovery.js` |
| 2 | Bucket + offering/mechanism match + deterministic fit score | `src/stages/bucketing.js` |
| 3 | Deep account research (blog, press, jobs, GitHub, exec posts) | `src/stages/research.js` |
| 4 | Decision-maker identification (3 ranked options if uncertain) | `src/stages/contacts.js` |
| 5+6 | Email drafting (2–3 variants, founder voice) + line-by-line rationale | `src/stages/drafting.js` |
| 7 | Review-then-send gate (the dashboard) | `src/server.js` + `public/` |
| 8 | Condition-based follow-ups → back through the approval gate | `src/stages/followup.js` |

Sales-assistant mode (call prep, product Q&A, objection handling) is in `src/assistant.js`
and the dashboard's bottom panel; it retrieves from `product_knowledge_base.md`.

## Dashboard workflow

1. Enter a discovery query **or** a comma-separated batch of companies → **Start run**.
2. Review the scored table (score, route, bucket, offering, mechanism, reasoning).
3. Check rows → **Research checked** (Stages 3–4), then **Draft checked** (Stages 5–6).
4. In the review section: switch variants, edit subject/body, read the rationale, then
   **Approve & send** or **Reject**. Priority leads fire a Slack alert at discovery time.
5. Mark outcomes (opened / replied / meeting booked) — these feed the metrics header and
   the Stage 8 follow-up triggers ("no reply in 3 days", "opened but no reply in 5 days",
   "meeting booked but no recap in 2 days").

## CLI

```sh
npm run cli -- discover "mid-market fintechs publicly using Cursor"
npm run cli -- batch "CompanyA, CompanyB, CompanyC"
npm run cli -- research <companyId> ...
npm run cli -- draft <companyId> ...
npm run cli -- drafts
npm run cli -- approve <draftId>
npm run cli -- followups
npm run cli -- ask "How is this different from Copilot's own usage report?"
npm run cli -- metrics
```

(`npm run cli --` loads `.env` automatically; bare `node cli.js` works too if the env vars are already exported.)

## Configuration

- ICP + scoring rubric + routing thresholds: `src/config.js` (`MIN_ENGINEERS`,
  `PRIORITY_THRESHOLD`, `STANDARD_THRESHOLD` also via env).
- Tone rules, match logic, workflow: `CLAUDE.md`.
- Product truth (all messaging grounds here): `product_knowledge_base.md`.
- End-to-end agent prompt: `agent_system_prompt.md`.

## Guardrails baked in

- Human approval gate on every send and follow-up (`status: pending` → explicit approve).
- Accuracy guardrail: Truxt has real users/customers (never "pre-revenue"); prompts forbid
  inventing specific customer names/metrics, and any illustrative number carries an
  `[illustrative]` label.
- Public data only; every research claim carries a source URL.
- Credentials via environment variables only; `data/` and `.env` are gitignored.

## Suggested first test

Run a small batch of 3–5 companies end to end before scaling:

```sh
npm run cli -- batch "Company1, Company2, Company3"
```
