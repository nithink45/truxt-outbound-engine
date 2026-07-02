// Stage 5 + 6: Email Drafting with a JUDGE.
// Generate N variants from DISTINCT angles (parallel), then a separate judge call scores
// them against the guardrails and picks the winner with a line-by-line rationale.
// Every specific claim must come from VERIFIED FACTS (verify stage); nothing is invented.
import { callLLM, KNOWLEDGE_BASE } from '../llm.js';
import { verifiedFacts } from './verify.js';

const ANGLES = [
  { label: 'A', name: 'risk-first', guide: 'Lead with a concrete technical risk in their current AI-coding setup that standard vendor dashboards miss.' },
  { label: 'B', name: 'roi-first', guide: 'Lead with the measurement gap: already paying for AI coding tools without delivery-outcome (DORA) visibility.' },
  { label: 'C', name: 'peer-credibility', guide: 'Open engineer-to-engineer: name the mechanism itself as the hook, assuming a technical reader.' },
];

export async function draftEmail(company, research, contact) {
  const facts = verifiedFacts(research);
  const verificationRan = !!research?.verification;
  const factsBlock = facts.length
    ? facts.map((f, i) => `  ${i + 1}. ${f.claim}${f.quote ? `  [source quote: "${f.quote}"]` : ''}  <${f.url}>`).join('\n')
    : '  (none passed verification)';

  // Generate one variant per angle, in parallel, for genuine diversity.
  const generated = await Promise.all(
    ANGLES.map((angle) => generateVariant({ company, research, contact, angle, factsBlock, verificationRan, facts })
      .catch(() => null))
  );
  const variants = generated.filter(Boolean);
  if (!variants.length) throw new Error(`Stage 5 produced no variants for ${company.name}`);

  // Judge picks the winner against the guardrails and explains it line by line.
  const judged = await judgeVariants({ company, contact, variants });
  return {
    variants,
    chosen: judged.chosen,
    chosenReason: judged.chosenReason,
    rationale: judged.rationale,
    judgeScores: judged.scores,
  };
}

async function generateVariant({ company, research, contact, angle, factsBlock, verificationRan, facts }) {
  const prompt = `STAGE 5: EMAIL DRAFT — ${company.name} (angle: ${angle.name})

Target: ${contact.name}, ${contact.title} at ${company.name}.
Matched offering: ${company.matchedOffering}
Matched mechanism: ${company.matchedMechanism}
Match reasoning: ${company.matchReasoning}

ANGLE FOR THIS VARIANT: ${angle.guide}

VERIFIED FACTS — every specific, public detail you cite about ${company.name} MUST come from
this list (each was re-fetched from its source and confirmed). Do NOT introduce any company
specific (dates, launches, numbers, tool names) that is not here:
${factsBlock}
${verificationRan && !facts.length ? '\n>> No facts passed verification. Do NOT invent specifics. Keep it honest and general; this draft will need manual grounding.\n' : ''}
Research brief (context only — not a source of citable specifics):
${JSON.stringify({ summary: research?.summary, topOfMind: research?.topOfMind, urgencyAnchors: research?.urgencyAnchors }, null, 2)}

PRODUCT KNOWLEDGE BASE (ground every product claim here — nothing else):
${KNOWLEDGE_BASE}

Write ONE cold email in the founder's voice: plain, direct, technically fluent, short
sentences, no hype, no exclamation marks, under 120 words. Posture: there to help, not sell.
Requirements:
1. Open with a SPECIFIC, VERIFIED public signal about ${company.name}, per the angle above.
2. Describe ONE plausible scenario where ${company.matchedOffering} helps, NAMING the mechanism.
3. Reinforce the shared-audience hook where natural (paying for AI coding tools, no clear ROI).
4. Truxt HAS real users/customers — never say "pre-revenue" or "no case studies". Don't invent specific customer names/logos/metrics not in the knowledge base; label any purely illustrative number as [illustrative]/"hypothetical".
5. Close with a light CTA.

Return ONLY JSON: {"subject": "string", "body": "string (use \\n for line breaks)"}`;

  const { json } = await callLLM(prompt, { stage: 'drafting', maxTokens: 4000 });
  if (!json?.subject || !json?.body) return null;
  return { label: angle.label, angle: angle.name, subject: json.subject, body: json.body };
}

async function judgeVariants({ company, contact, variants }) {
  const block = variants
    .map((v) => `--- VARIANT ${v.label} (${v.angle}) ---\nSubject: ${v.subject}\n${v.body}`)
    .join('\n\n');

  const prompt = `STAGE 6: JUDGE THE DRAFTS — ${company.name}, to ${contact.name} (${contact.title}).

Score each variant 0-5 on each guardrail, then pick the single strongest to send.
Guardrails:
- specific: opens on a specific, real public signal (not generic "we help engineering teams")
- mechanismNamed: names the Truxt mechanism, not just a value prop
- noHype: plain founder voice, no hype/exclamation, under ~120 words
- noFabrication: no "pre-revenue"/"no customers" claims (Truxt has real customers); no invented specific customer names/metrics; illustrative numbers labeled [illustrative]/hypothetical
- helpfulPosture: there-to-help, not salesy; light CTA

VARIANTS:
${block}

Pick the highest total (break ties toward the most specific + most credible). Then explain
the WINNER line by line.

Return ONLY JSON:
{
  "scores": [{"label":"A","specific":0,"mechanismNamed":0,"noHype":0,"noFabrication":0,"helpfulPosture":0,"total":0,"notes":"one line"}],
  "chosen": "A",
  "chosenReason": "one line: why this variant wins",
  "rationale": [{"line":"exact line from the chosen variant","why":"why it's there and how it raises reply odds"}]
}`;

  const { json } = await callLLM(prompt, { stage: 'judge', maxTokens: 6000 });
  const chosen = json?.chosen && variants.some((v) => v.label === json.chosen) ? json.chosen : variants[0].label;
  return {
    chosen,
    chosenReason: json?.chosenReason || null,
    rationale: Array.isArray(json?.rationale) ? json.rationale : [],
    scores: Array.isArray(json?.scores) ? json.scores : [],
  };
}
