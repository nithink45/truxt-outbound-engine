// Stage 1: ICP Signal Discovery.
// Given a discovery query or a supplied batch of company names, find companies matching
// the ICP and capture raw fit signals with source URLs. Uses server-side web search.
import { callLLM } from '../llm.js';
import { MIN_ENGINEERS } from '../config.js';

const SCHEMA_HINT = `{
  "companies": [{
    "name": "string",
    "domain": "string (best guess, e.g. acme.com)",
    "industry": "string",
    "estEngineers": number (estimated engineering headcount; null if unknown),
    "aiToolsPublic": ["Copilot"|"Cursor"|"Claude Code"|"Gemini CLI"|"OpenCode"|"other: <name>"],
    "usesGithubCicd": boolean (public evidence of GitHub + a CI/CD pipeline),
    "roiSignal": boolean (public signal of caring about AI ROI, DORA, or dev productivity),
    "roiSignalDetail": "string or null",
    "triggerEvent": "string describing a recent trigger event, or null",
    "devopsMaturity": "low|medium|high|unknown",
    "sourceUrls": ["every claim above must be backed by at least one URL here"],
    "notes": "one-line summary of why this company fits or doesn't"
  }]
}`;

export async function discover({ query = null, companyNames = [] }, { maxCompanies = 8 } = {}) {
  const target = companyNames.length
    ? `Research this supplied batch of companies (do NOT invent others): ${companyNames.join(', ')}.`
    : `Find up to ${maxCompanies} companies matching the ICP via this discovery query: "${query}". Prioritize companies that publicly name the AI coding tools they use.`;

  const prompt = `STAGE 1: ICP SIGNAL DISCOVERY

${target}

ICP: engineering org of roughly ${MIN_ENGINEERS}+ software engineers (10,000+ = enterprise tier); publicly using or evaluating AI coding tools (Copilot, Cursor, Claude Code, or similar); uses GitHub plus CI/CD; public signals of caring about AI ROI, developer productivity, DORA metrics, or AI adoption.

Search the web for evidence: engineering blogs, job postings, GitHub org activity, press, conference talks, exec posts. Every signal you report must be backed by a source URL in sourceUrls. If you cannot find public evidence for a signal, report it as false/null — do not guess.

Return ONLY JSON matching:
${SCHEMA_HINT}

Sort companies by apparent fit, best first.`;

  const { json } = await callLLM(prompt, { stage: 'discovery', webSearch: true, maxSearches: 12, maxTokens: 20000 });
  if (!json?.companies) throw new Error('Stage 1 returned no companies — check API output');
  return json.companies;
}
