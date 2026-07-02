# Truxt Product Knowledge Base

> Single source of truth for all outbound messaging and sales-assistant answers.
> Every draft and every product answer MUST be grounded in this file. Never invent
> capabilities, customers, logos, or results that are not here.

## What Truxt is

Truxt is an AI-native **Software Engineering Intelligence** platform. It sits on top of a
team's dev tools, watches how AI is actually used in real code and delivery, and turns that
into dashboards and a chat agent so engineering leaders can see whether AI is worth the
spend — and how to fix what is not working.

## The core buyer question Truxt answers

> "We are paying for Copilot, Cursor, and Claude Code. Are they actually helping us ship
> better, faster, and safer? If our DORA metrics are bad, why, and what do we change?"

## Company stage (IMPORTANT for messaging)

Truxt has **real users and real customers** — real companies use Truxt today, and there are
real data points that demonstrate its impact. **Never** describe Truxt as "pre-revenue," and
never claim it has "no customers," "no case studies," or "no results." That framing is false
and undersells the product — do not use it anywhere.

Anti-fabrication still applies (this is about accuracy, not stage): do NOT invent specific
customer names, logos, or metrics that are not recorded in this file or backed by verified
research. When real customer proof is available, cite it with its source. Any purely
illustrative figure must be labeled (e.g. "[illustrative]" or "hypothetical scenario") so it
is never presented as a specific real result.

<!-- TODO (fill in): real customers, logos, and verified data points, each with a source,
     so drafts can cite concrete proof instead of illustrative scenarios. -->

---

## The four offerings

Lead with the offering (buyer value), back it with the mechanism (technical credibility).

### 1. AI Impact & ROI Measurement — "PROVE THE ROI"

- **Buyer value:** Outcome metrics tied to delivery, not activity counts. See which AI
  tools, teams, and workflows actually improve cycle time, PR quality, and defect rates —
  and which are pure cost.
- **Mechanism:** The **Truxt CLI** sits in the Git workflow and captures every AI coding
  session (prompts, responses, accept/edit/reject decisions), linking each session to the
  commit it produced. It stores metadata only and keeps Git history clean. Team-level
  analytics aggregate this across developers and tools. **Enterprise DevLake** ingests
  GitHub, CI/CD, incidents, and planning data to compute DORA metrics.
- **Result shape:** From micro ("for this commit: 47 prompts, 38 accepted, X% reached
  production") up to macro ("teams using tool X in domain Y ship 20% faster with 15%
  fewer defects" — numbers like these in outreach must be labeled hypothetical).

### 2. Agentic Execution — product name **Axiom** — "AUTO-FIX"

- **Buyer value:** Critical vulnerabilities and SDLC gaps resolved before they slow teams.
  Remediation cut from weeks or months to hours.
- **Mechanism:** Axiom correlates vulnerability findings (SAST/DAST) with the code
  **Knowledge Graph** and the deployment pipeline, prioritizes findings that touch
  high-value services and exploitable paths, then orchestrates and validates AI-driven
  remediation.

### 3. AI Adoption Coach — "DRIVE ADOPTION"

- **Buyer value:** Engineers move from first exposure to confident, high-impact AI usage,
  faster.
- **Mechanism:** **AI Coach** uses real Truxt CLI session signals (prompt clarity,
  iteration behavior, acceptance vs rejection) to give each developer in-workflow,
  personalized coaching — e.g. "specify file, function, expected behavior, and
  constraints" — and shows trends like "acceptance rate rose from 30% to 60% after
  including test cases in prompts" (illustrative example, label as such in outreach).

### 4. 360° Engineering View — "FULL SDLC VISIBILITY"

- **Buyer value:** One unified, real-time view across all teams, tools, and AI usage. The
  baseline leaders need to measure and drive progress.
- **Mechanism:** **Enterprise DevLake** unifies commits, PRs, deployments, incidents, and
  planning. The **Knowledge Graph** turns the codebase into a queryable graph of functions,
  calls, dependencies, blast radius, coupling, and dead code. A **chat agent** lets leaders
  ask "why has lead time increased for backend team B?" and answers from the engineering
  graph, not static charts.

---

## Underlying components (name-drop only where it adds credibility)

| Component | Role |
|---|---|
| **Truxt CLI** | AI coding session capture (prompt → response → accept/edit/reject → commit linkage; metadata only) |
| **Knowledge Graph / Code Intelligence** | Codebase as a queryable graph: functions, calls, dependencies, blast radius, coupling, dead code |
| **Enterprise DevLake** | Data backbone: GitHub, CI/CD, incidents, planning → DORA metrics |
| **AI Coach** | In-workflow, per-developer coaching from real session signals |
| **Axiom** | Security remediation: vuln correlation + prioritization + validated AI-driven fixes |

## Integrations

GitHub, Git, Jira, SonarQube, CI/CD systems, and AI coding tools: GitHub Copilot, Cursor,
Claude Code, Gemini CLI, OpenCode.

---

## Bucket → offering → mechanism match logic

| Buyer pain signal (public) | Bucket | Lead offering | Lead mechanism |
|---|---|---|---|
| Spending on AI coding tools without clear returns; ROI-skeptical statements; CFO pressure on AI spend | `roi` | AI Impact & ROI Measurement | CLI session-to-commit linkage + DevLake DORA correlation |
| Security, quality, or vulnerability-backlog pressure; incidents; compliance pushes | `security` | Agentic Execution (Axiom) | Vuln correlation with Knowledge Graph + deployment pipeline; remediation in hours |
| Low or uneven AI adoption; rollout struggles; "we bought licenses but usage is flat" | `adoption` | AI Adoption Coach | In-workflow coaching from real CLI session signals |
| Fragmented metrics; no cross-team visibility; "every team reports differently" | `visibility` | 360° Engineering View | DevLake + Knowledge Graph + chat agent over the engineering graph |

## Objection-handling anchors

- **"We already have a DORA dashboard."** DORA dashboards show *what* changed, not *why*.
  Truxt links each AI coding session to the commit it produced and then to the delivery
  outcome, so you can attribute a cycle-time or defect-rate shift to a specific tool,
  team, or workflow — and DevLake computes the DORA baseline in the same platform.
- **"Copilot has its own usage report."** Vendor reports count activity (suggestions
  shown/accepted), not outcomes. They can't tell you whether accepted code reached
  production, caused defects, or moved cycle time — and they can't compare Copilot vs
  Cursor vs Claude Code on delivery outcomes. Truxt's session-to-commit-to-DORA chain does.
- **"We can build this ourselves."** The hard parts are the session-to-commit linkage
  (Truxt CLI), the codebase Knowledge Graph, and delivery-outcome correlation across all
  tools — a multi-quarter platform build vs. an install.
- **"Is this surveillance of developers?"** Truxt CLI stores metadata only, keeps Git
  history clean, and the AI Coach is developer-facing value (personalized coaching), not
  a leaderboard.

## Shared-audience hook (reinforce in every message)

Companies already spending on AI coding tools **without clear ROI visibility**. That
overlap — real spend, no outcome measurement — is the wedge in every message.
