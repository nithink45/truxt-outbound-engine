# Truxt Outbound Engine — Project Config

Internal outbound discovery-to-outreach engine for Truxt (an AI-native Software Engineering
Intelligence platform with real users and customers). Discovers ICP-fit companies from public data, matches
each company's specific public pain to the specific Truxt mechanism that addresses it,
identifies the right decision-maker, drafts personalized outreach, and presents everything
for human review. **A human approves every outbound message. Nothing sends automatically.**

Product truth lives in [product_knowledge_base.md](product_knowledge_base.md). The
end-to-end agent prompt lives in [agent_system_prompt.md](agent_system_prompt.md).

## Architecture

- Node.js (ESM), Express dashboard at `src/server.js` (default port 3333), CLI at `cli.js`.
- All reasoning via the Anthropic API (`claude-opus-4-8`, adaptive thinking, server-side
  web search for research stages). Client wrapper: `src/llm.js`.
- Persistence: JSON file store at `data/db.json` (`src/store.js`). Runs are resumable.
- Pipeline stages are discrete modules in `src/stages/` — each takes structured input and
  returns structured JSON so stages chain or re-run independently.
- `ANTHROPIC_API_KEY` (and optional sender keys) load from environment / `.env`. Never
  commit credentials.

## ICP parameters (tune in src/config.js or via env)

- `MIN_ENGINEERS` (env, default **300**): minimum engineering org size. Enterprise tier
  10,000+. Lower it for pipeline volume — very large orgs publicly naming their AI tools
  are a small pool.
- Fit signals: publicly using/evaluating AI coding tools (Copilot, Cursor, Claude Code,
  Gemini CLI, OpenCode); uses GitHub + CI/CD; public signals of caring about AI ROI,
  developer productivity, DORA metrics, or AI adoption.
- Buyer personas: CTO, CFO office, VP Engineering, Director of Engineering, Engineering
  Manager, Head of Developer Productivity / Platform Engineering.

## Fit-scoring rubric (additive, 0–100; thresholds in src/config.js)

| Signal | Points |
|---|---|
| Engineering org ≥ MIN_ENGINEERS | +25 |
| Publicly using Copilot, Cursor, or Claude Code | +20 |
| Uses GitHub + CI/CD | +15 |
| Public signal of caring about AI ROI / DORA / dev productivity | +15 |
| Contact holds authority over AI-tool spend (CTO, VP Eng, CFO office) | +10 |
| Recent trigger event (AI rollout, DevEx/platform hiring push, incident, public statement on AI spend) | +5 |
| No public evidence of AI-tool usage | −15 |

**Routing:** ≥70 → **Priority** (Slack alert to founder). 40–69 → **Standard** (enter
sequence). <40 → **Nurture** (light touch or drop).

## Bucket → offering → mechanism match

| Bucket | Signal | Lead offering | Lead mechanism |
|---|---|---|---|
| `roi` | ROI-skeptical / AI spend without clear returns | AI Impact & ROI Measurement | CLI session-to-commit + DevLake DORA |
| `security` | Security / quality / vuln-backlog pressure | Agentic Execution (Axiom) | Vuln correlation with Knowledge Graph; remediation in hours |
| `adoption` | Low or uneven AI adoption, rollout struggles | AI Adoption Coach | In-workflow coaching from real session signals |
| `visibility` | Fragmented metrics, no cross-team visibility | 360° Engineering View | DevLake + Knowledge Graph + chat agent |

Pick the **single strongest** offering per company. One offering, one mechanism, one message.

## Tone and messaging rules (apply wherever drafts are generated)

1. Default posture: **there to help, not to sell.**
2. Lead with the account's **specific, public pain** + one matched offering and its
   mechanism. Never a generic "we help engineering teams" pitch.
3. Reinforce the shared-audience hook: already spending on AI coding tools without clear
   ROI visibility.
4. Specific and urgent over broad and safe — anchor to a real, recent, public signal.
5. **Name the mechanism**, not just the value prop (technical credibility with engineering
   leaders).
6. Any invented number is visibly labeled `[placeholder]` or "hypothetical scenario" so it
   is never sent as fact.

## Guardrails (non-negotiable)

- Human approves every outbound message, **including follow-ups**. No auto-send, ever.
- Truxt has real users and customers. **Never** describe it as "pre-revenue" or say it has
  "no customers/case studies" — that is false. Do not fabricate specific customer names,
  logos, or metrics not in the knowledge base / verified research; label any purely
  illustrative figure as `[illustrative]` or "hypothetical".
- All research uses **public data only**. Store a source URL for every research claim.
- Label placeholder data as placeholder in every draft.
- API keys and credentials stay out of the codebase — environment variables only.

## Workflow

Research → review → send, always in that order:

1. **Discover + score** (Stages 1–2): batch or query → scored, bucketed table.
2. **Founder checks rows** → **deep research + decision-maker ID** (Stages 3–4) run only
   for checked rows.
3. **Draft + rationale** (Stages 5–6): 2–3 variants in the founder's voice, line-by-line
   rationale stored with the draft.
4. **Review gate** (Stage 7): founder edits/approves in the dashboard. Only approved
   drafts send; sends log to CRM; Priority leads fire a Slack alert.
5. **Follow-ups** (Stage 8): condition-triggered ("no reply in 3 days", "opened but no
   reply in 5 days", "meeting booked but no recap in 2 days") — drafted, then queued for
   the same approval gate.
6. **Instrument**: track time-to-first-touch, open/reply/meeting rates per message and
   pattern; tune thresholds and prompts from real results.
