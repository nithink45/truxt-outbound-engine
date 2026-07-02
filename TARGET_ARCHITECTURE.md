# Target Architecture — Best-Results Rebuild

Goal: **maximum output quality**, not minimum cost. The automation's failure modes are
(1) hallucinated facts / fake source URLs, (2) wrong decision-maker, (3) generic or salesy
drafts. This design attacks those three directly. The model is one part; **evidence and
verification are the larger levers.**

Guiding principle: **facts come from systems of record; judgment comes from the model;
every claim is verified against a real URL before it can reach a draft.**

---

## 1. Layers (new shape)

```
                ┌─────────────────────────────────────────────┐
                │  llm.js  — provider/model router (per stage) │
                │  Anthropic (Opus 4.8) primary; OpenRouter    │
                │  + Gemini as swappable fallbacks             │
                └─────────────────────────────────────────────┘
                                    ▲
   ┌──────────────┐  evidence   ┌───┴────────┐  contacts   ┌──────────────┐
   │ search.js    │────────────▶│  pipeline  │◀────────────│ apollo.js    │
   │ Exa + fetch  │             │  (stages)  │             │ real people  │
   └──────────────┘             └───┬────────┘             └──────────────┘
                                    │
                              ┌─────▼──────┐
                              │ verify.js  │  re-fetch each cited URL,
                              │ claim-check│  confirm support, drop the rest
                              └────────────┘
```

New modules: `src/search.js` (grounding), `src/apollo.js` (contacts), `src/stages/verify.js`
(claim verification). Reworked: `src/llm.js` (router), `src/stages/*` (consume evidence
instead of self-grounding).

---

## 2. Grounding — Claude's native web search  (DECIDED: Claude-only)

**Decision (2026-07):** grounding runs on **Claude's native server-side web search**
(`web_search_20260209`, already wired in `src/llm.js` `callAnthropic`). Verified live on
Opus 4.8 — a discovery run returned real, current, verifiable source URLs (no hallucination).

Why native over a bolt-on search API (Exa/Tavily):
- **Agentic/iterative** — the model searches, reads, refines its query, and searches again
  in one turn. Beats a fixed fan-out for research depth.
- Already integrated; one vendor, one key, one failure mode.
- Returns citations, satisfying "source URL per claim" at the point of retrieval.

Verification uses an **independent page-fetch** (§5), NOT the same search loop — re-fetching
the specific cited URL avoids confirmation bias and needs no search vendor.

**Exa is optional and deferred** — worth adding only for (a) Stage-1 *discovery* semantic
recall, or (b) provider-independent grounding if we ever run cheap non-Claude models. Not
the backbone. If added later, it lives in `src/search.js` returning
`{ query, url, title, text }[]`.

---

## 3. Model router — `src/llm.js`

Keep the current `{ json, text, usage, stopReason }` contract. Add:
- **`provider` + per-call `model`/`tier`** so each stage picks its model.
- Providers: `anthropic` (primary), `openrouter` (many models via one key), `gemini`
  (current test path). All behind the same `callLLM(prompt, opts)`.
- **Stage → model map** (cost aside, quality-first):

| Stage | Task | Model |
|---|---|---|
| 2 Bucket/score | structured JSON judgment | **Opus 4.8** |
| 3 Research synthesis | reason over fetched evidence | **Opus 4.8** |
| Verify (claim-check) | entailment: does URL support claim? | **Opus 4.8** (faithfulness-critical) |
| 5–6 Drafting | voice-sensitive writing | **Opus 4.8**, multi-sample |
| Draft judge | critique + select best variant | **Opus 4.8** (separate call, adversarial) |
| 8 Follow-up trigger | mechanical "no reply in 3d?" | small fast model (Haiku / free OpenRouter) |

Only truly mechanical steps downshift. Everything touching judgment or writing stays on the
frontier model — routing-down is a cost trade we're explicitly not making here.

Token hygiene (independent of model): stop sending the full system prompt + knowledge base
on every call — cache them; send trimmed context per stage; cap `maxTokens` per stage.

---

## 4. Decision-makers — `src/apollo.js`  (kills a hallucination surface)

Replace LLM-guessed contacts (today it invented "Gavin Stark") with **Apollo** (already
connected via MCP: `apollo_contacts_search`, `apollo_people_match`, `apollo_organizations_enrich`).

- Query Apollo by company domain + target personas (CTO, VP Eng, Dir Eng, Head of DevProd,
  Platform lead) → **real names, titles, seniority, verified emails.**
- The LLM's only job: **rank** the returned real people by who most likely owns AI-tool
  spend, given the research brief. It never invents a person.

Interface:
```js
export async function findDecisionMakers(company, personas) → RealContact[]   // Apollo
// then: rank via callLLM over the real list, not free-form generation
```

---

## 5. Verification stage — `src/stages/verify.js`  (the step most people skip)

Runs after research, before drafting. Enforces the guardrail "public data only, source URL
per claim" **mechanically** instead of trusting the model.

For each claim `{ claim, sourceUrl }` from research:
1. `search.fetchPage(sourceUrl)`.
2. Ask the model: *does this page text support this claim? (yes / no / partial)* + quote.
3. **Drop unsupported claims.** Only verified claims flow into drafting.

Output adds `verified: true` + `supportingQuote` to each surviving claim. Drafts can then
only be built from verified evidence → no fabricated urgency anchors, no fake dates.

---

## 6. Drafting — multi-sample + judge  (`src/stages/drafting.js`)

- Generate **N variants from different angles** (risk-first, ROI-first, peer-credibility)
  — separate calls, higher temperature.
- A **judge call** scores them against the guardrails (specific? mechanism named? no hype?
  no fabricated results? placeholder labels present?) and picks/merges the best.
- Rationale is produced for the winner only. Human gate unchanged.

Why: outreach quality is high-variance; sample-and-select reliably beats one-shot.

---

## 7. Data model additions (`data/db.json`)

- `company.evidence`: the raw `EvidenceItem[]` bundle (audit trail).
- `research.claims[].verified` + `.supportingQuote`.
- `contact.source: 'apollo'` + `.emailVerified`.
- `draft.judgeScore` + `.rejectedVariants` (why they lost).

---

## 8. Build phases (when the Claude key lands)

1. **Router** — ✅ DONE. `llm.js` Anthropic-primary (Opus 4.8) with per-stage tier map +
   OpenRouter/Gemini fallbacks. Live and verified.
2. **Grounding** — ✅ DONE via Claude native web search (no separate module needed).
   Verified live. Exa deferred (optional).
3. **Verify** — ✅ DONE. `src/stages/verify.js`: independently re-fetches each cited URL
   (direct fetch → r.jina.ai reader fallback for JS/blocked pages, VERIFY_READER=off to
   disable) and claim-checks it on Opus. Unsupported claims dropped; survivors carry a
   verbatim quote. Drafting anchors ONLY on verified facts. Verified live on Ramp
   (8/10 supported, draft used only verified specifics).
4. **Apollo contacts** — ✅ DONE + validated live. `src/apollo.js`: search (roster by
   domain+titles) → `enrichPerson` (reveal name+email, 1 credit) — two-step, matching
   Apollo's API. `src/stages/contacts.js`: real people → LLM ranks (indices only, never
   invents) → enrich #1. Falls back to LLM with no key. Validated via the Apollo connector:
   Datadog search → real people; ranked → VP Eng #1 → enriched to verified work email.
   ✅ FULLY LIVE: app has its own APOLLO_API_KEY; endpoint is mixed_people/api_search
   (the old mixed_people/search is deprecated for API callers). Validated end-to-end.
5. **Draft judge** — ✅ DONE. `src/stages/drafting.js`: 3 distinct-angle variants
   (risk-first / roi-first / peer-credibility) generated in parallel, then a separate judge
   call scores each against the guardrails and picks the winner with line-by-line rationale.
   Verified live on Ramp (A 25/25; judge dinged a labeled-but-awkward placeholder in B and
   a salesy phrase in C). judgeScores persisted on the draft.

Each phase is independently shippable and independently improves quality.

---

## Why this over "just use the biggest model"

A frontier model guessing beats a weak model guessing — but **any** model guessing loses to
a model reasoning over real, fetched, verified evidence. The wins here come from *removing
the model's need to recall facts* (search + Apollo) and *checking it when it does* (verify),
then spending the frontier model's capability where it's actually decisive: judgment,
matching, and voice. That is the honest path to best results.
