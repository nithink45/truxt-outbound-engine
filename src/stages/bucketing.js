// Stage 2: Bucketing + Offering/Mechanism match + fit score.
// Bucket assignment is model judgment (from Stage 1 signals); the fit score is computed
// deterministically in code from the rubric so it stays auditable and tunable.
import { callLLM } from '../llm.js';
import { SCORING, MIN_ENGINEERS, BUCKETS, routeScore } from '../config.js';

export function computeScore(c) {
  let score = 0;
  const parts = [];
  const add = (cond, key, label) => {
    if (cond) { score += SCORING[key]; parts.push(`${label} (${SCORING[key] > 0 ? '+' : ''}${SCORING[key]})`); }
  };
  add(c.estEngineers != null && c.estEngineers >= MIN_ENGINEERS, 'orgSize', `eng org >= ${MIN_ENGINEERS}`);
  const hasAi = (c.aiToolsPublic || []).length > 0;
  add(hasAi, 'aiTools', 'publicly using AI coding tools');
  add(c.usesGithubCicd, 'githubCicd', 'GitHub + CI/CD');
  add(c.roiSignal, 'roiSignal', 'public AI-ROI/DORA/productivity signal');
  add(!!c.contactAuthority, 'contactAuthority', 'AI-spend-authority contact identified');
  add(!!c.triggerEvent, 'triggerEvent', 'recent trigger event');
  add(!hasAi, 'noAiEvidence', 'no public AI-tool evidence');
  score = Math.max(0, Math.min(100, score));
  return { score, scoreBreakdown: parts, routing: routeScore(score) };
}

export async function bucketize(companies) {
  const prompt = `STAGE 2: BUCKETING + OFFERING/MECHANISM MATCH

For each company below, pick the ONE bucket whose pain signal is strongest, per the match logic:
- "roi": ROI-skeptical or spending on AI tools without clear returns
- "security": security, quality, or vulnerability-backlog pressure
- "adoption": low or uneven AI adoption, rollout struggles
- "visibility": fragmented metrics, no cross-team visibility

Companies (Stage 1 signals):
${JSON.stringify(companies.map(({ name, industry, estEngineers, aiToolsPublic, usesGithubCicd, roiSignal, roiSignalDetail, triggerEvent, devopsMaturity, notes }) => ({ name, industry, estEngineers, aiToolsPublic, usesGithubCicd, roiSignal, roiSignalDetail, triggerEvent, devopsMaturity, notes })), null, 2)}

Return ONLY JSON:
{"matches": [{"name": "string (exactly as given)", "bucket": "roi|security|adoption|visibility", "reasoning": "one line: the specific signal that picked this bucket"}]}`;

  const { json } = await callLLM(prompt, { stage: 'bucketing', maxTokens: 8000 });
  if (!json?.matches) throw new Error('Stage 2 returned no matches');

  return companies.map((c) => {
    const m = json.matches.find((x) => x.name === c.name) || { bucket: 'roi', reasoning: 'default: shared-audience hook (AI spend without ROI visibility)' };
    const bucket = BUCKETS[m.bucket] ? m.bucket : 'roi';
    const scored = computeScore(c);
    return {
      ...c,
      bucket,
      matchedOffering: BUCKETS[bucket].offering,
      matchedMechanism: BUCKETS[bucket].mechanism,
      matchReasoning: m.reasoning,
      ...scored,
    };
  });
}
