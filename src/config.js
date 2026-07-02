export const MIN_ENGINEERS = parseInt(process.env.MIN_ENGINEERS || '300', 10);

export const MODEL = process.env.TRUXT_MODEL || 'claude-opus-4-8';

// Gemini model used when LLM_PROVIDER=gemini (temporary testing before Claude key).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

// ── Model router (Phase 1) ────────────────────────────────────────────────
// Two logical tiers per provider. 'frontier' = judgment/writing; 'fast' = cheap
// mechanical steps. Stages resolve to a tier via STAGE_TIERS, then to a concrete
// model via MODEL_TIERS[provider][tier]. Flip the whole pipeline to Opus by setting
// LLM_PROVIDER=anthropic — no stage code changes required.
export const MODEL_TIERS = {
  anthropic: {
    frontier: process.env.ANTHROPIC_MODEL || MODEL,                    // claude-opus-4-8
    fast: process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001',
  },
  gemini: {
    frontier: GEMINI_MODEL,
    fast: process.env.GEMINI_FAST_MODEL || GEMINI_MODEL,               // no cheaper reachable tier on the test key
  },
  openrouter: {
    frontier: process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.8',
    fast: process.env.OPENROUTER_FAST_MODEL || 'meta-llama/llama-3.3-70b-instruct',
  },
};

// Which tier each stage runs on. Every LLM call here is judgment or writing, so all
// run 'frontier'. The 'fast' tier exists for future mechanical LLM steps; the current
// follow-up TRIGGER checks are pure code (FOLLOWUP_RULES) and use no model at all.
export const STAGE_TIERS = {
  discovery: 'frontier',
  bucketing: 'frontier',
  research: 'frontier',
  verify: 'frontier',
  contacts: 'frontier',
  drafting: 'frontier',   // writing the follow-up email is voice-sensitive
  judge: 'frontier',
  assistant: 'frontier',
  followup: 'frontier',
};

export const SCORING = {
  orgSize: 25,          // engineering org >= MIN_ENGINEERS
  aiTools: 20,          // publicly using Copilot / Cursor / Claude Code
  githubCicd: 15,       // uses GitHub + CI/CD
  roiSignal: 15,        // public signal of caring about AI ROI / DORA / dev productivity
  contactAuthority: 10, // contact with authority over AI-tool spend identified
  triggerEvent: 5,      // recent trigger event
  noAiEvidence: -15,    // no public evidence of AI-tool usage
};

export const THRESHOLDS = {
  priority: parseInt(process.env.PRIORITY_THRESHOLD || '70', 10),
  standard: parseInt(process.env.STANDARD_THRESHOLD || '40', 10),
};

export function routeScore(score) {
  if (score >= THRESHOLDS.priority) return 'Priority';
  if (score >= THRESHOLDS.standard) return 'Standard';
  return 'Nurture';
}

export const BUCKETS = {
  roi: {
    offering: 'AI Impact & ROI Measurement',
    mechanism: 'Truxt CLI session-to-commit linkage + Enterprise DevLake DORA correlation',
  },
  security: {
    offering: 'Agentic Execution (Axiom)',
    mechanism: 'Axiom: vuln correlation with the code Knowledge Graph and deployment pipeline; validated AI-driven remediation in hours',
  },
  adoption: {
    offering: 'AI Adoption Coach',
    mechanism: 'AI Coach: in-workflow, personalized coaching from real Truxt CLI session signals',
  },
  visibility: {
    offering: '360° Engineering View',
    mechanism: 'Enterprise DevLake + Knowledge Graph + chat agent over the engineering graph',
  },
};

// Follow-up trigger conditions (days)
export const FOLLOWUP_RULES = [
  { id: 'no_reply_3d', desc: 'No reply in 3 days', condition: (d, now) => d.status === 'sent' && !d.replied && daysSince(d.sentAt, now) >= 3 && !d.followupDrafted },
  { id: 'opened_no_reply_5d', desc: 'Opened but no reply in 5 days', condition: (d, now) => d.status === 'sent' && d.opened && !d.replied && daysSince(d.sentAt, now) >= 5 && !d.followupDrafted2 },
  { id: 'meeting_no_recap_2d', desc: 'Meeting booked but no recap logged in 2 days', condition: (d, now) => d.meetingBooked && !d.recapLogged && daysSince(d.meetingAt || d.sentAt, now) >= 2 && !d.recapFollowupDrafted },
];

function daysSince(iso, now = Date.now()) {
  if (!iso) return 0;
  return (now - new Date(iso).getTime()) / 86400000;
}
