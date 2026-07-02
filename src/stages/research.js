// Stage 3: Deep Account Research (per company, public data only, URL per claim).
import { callLLM } from '../llm.js';

export async function deepResearch(company) {
  const prompt = `STAGE 3: DEEP ACCOUNT RESEARCH — ${company.name} (${company.domain || 'domain unknown'})

Read what is publicly available: their engineering blog, recent press, job postings, GitHub org activity, and recent LinkedIn/X posts from the CTO or VP Engineering over roughly the last 2 months.

Already known (Stage 1): AI tools: ${JSON.stringify(company.aiToolsPublic || [])}; trigger: ${company.triggerEvent || 'none'}; bucket: ${company.bucket} → ${company.matchedOffering}.

Return ONLY JSON:
{
  "caresAbout": ["what this company cares about as an engineering org, in general — each item a short claim"],
  "topOfMind": ["what is top of mind RIGHT NOW: a recent incident, hiring push, public statement on AI tooling spend, launch, reorg"],
  "aiToolsMentioned": ["tools they publicly mention using or evaluating"],
  "devopsMaturity": "low|medium|high|unknown",
  "devopsMaturityEvidence": "string or null",
  "urgencyAnchors": ["anything that could anchor an URGENT, SPECIFIC outreach message — the more recent and concrete the better"],
  "claims": [{"claim": "string", "sourceUrl": "URL backing it", "date": "approx date if known or null"}],
  "summary": "3-4 sentence research brief a founder can skim before a call"
}

Every item in caresAbout / topOfMind / urgencyAnchors must correspond to at least one entry in claims with a real source URL. If you can't source it, leave it out.`;

  const { json } = await callLLM(prompt, { stage: 'research', webSearch: true, maxSearches: 10, maxTokens: 16000 });
  if (!json) throw new Error(`Stage 3 returned no JSON for ${company.name}`);
  return json;
}
