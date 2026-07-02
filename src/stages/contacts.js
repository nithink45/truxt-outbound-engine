// Stage 4: Decision-Maker Identification.
// Preferred path: pull REAL people from Apollo (system of record), then use the LLM ONLY
// to rank them by who most likely owns AI-tooling spend — the model never invents a person.
// Fallback (no Apollo key / no results): LLM identification from public sources.
import { callLLM } from '../llm.js';
import { findDecisionMakers, enrichPerson } from '../apollo.js';

const TARGET_PERSONAS = [
  'CTO', 'Chief Technology Officer',
  'VP Engineering', 'VP of Engineering',
  'Director of Engineering',
  'Head of Developer Productivity', 'Head of Developer Experience',
  'Head of Platform Engineering', 'VP Platform Engineering',
];

export async function identifyContacts(company, research) {
  const apolloPeople = await findDecisionMakers(company, TARGET_PERSONAS);
  if (apolloPeople.length) return rankRealContacts(company, research, apolloPeople);
  return llmIdentify(company, research);
}

// Rank REAL Apollo people. The model returns indices + rationale only; we map back to the
// real records so names/titles/emails can never be hallucinated or altered.
async function rankRealContacts(company, research, people) {
  const roster = people.map((p, i) => `${i}. ${p.name} — ${p.title}`).join('\n');
  const prompt = `STAGE 4: RANK DECISION-MAKERS — ${company.name}

These are REAL people at ${company.name} (from Apollo). Do NOT invent, rename, or add anyone.
Rank the top 3 by who most likely holds authority over AI-tooling spend, given the account.

Context: bucket ${company.bucket} → ${company.matchedOffering}.
Research brief: ${research?.summary || company.notes || 'n/a'}

PEOPLE:
${roster}

Return ONLY JSON (best first, max 3):
{"ranked": [{"index": <number from the list>, "rank": 1, "rationale": "one line: why this person likely owns AI-tool spend"}]}`;

  const { json } = await callLLM(prompt, { stage: 'contacts', maxTokens: 2000 });
  const ranked = (json?.ranked || []).filter((r) => people[r.index]);
  const top3 = ranked.length
    ? ranked.slice(0, 3).map((r) => ({ ...people[r.index], rank: r.rank || 1, rationale: r.rationale || null }))
    : people.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1, rationale: null }));

  // Enrich only the #1 contact (reveal full name + email) — one Apollo credit per company.
  const primary = top3.find((c) => c.rank === 1) || top3[0];
  if (primary?.needsEnrichment && primary.apolloId) {
    const enriched = await enrichPerson(primary.apolloId);
    if (enriched) {
      Object.assign(primary, {
        name: enriched.name || primary.name,
        title: enriched.title || primary.title,
        linkedin: enriched.linkedin || primary.linkedin,
        email: enriched.email,
        emailVerified: enriched.emailVerified,
        needsEnrichment: false,
        nameObfuscated: false,
      });
    }
  }
  return top3;
}

// Fallback: identify contacts from public sources via the LLM (lower confidence than Apollo).
async function llmIdentify(company, research) {
  const prompt = `STAGE 4: DECISION-MAKER IDENTIFICATION — ${company.name}

Identify the best contact for Truxt outreach: the person most likely to hold authority over AI-tooling spend, among CTO, VP Engineering, Director of Engineering, Head of Developer Productivity, or Platform Engineering lead.

Context: bucket ${company.bucket} → ${company.matchedOffering}. Research brief: ${research?.summary || company.notes || 'n/a'}

Search public sources (company site, LinkedIn public pages, press, conference speaker bios). Use only names and titles that are publicly verifiable — include the source URL. Do NOT guess email addresses or phone numbers; leave those null (Apollo enrichment fills them when connected).

Return ONLY JSON. If confident in one person, return them ranked #1 with alternates; if uncertain, return three ranked options:
{
  "contacts": [{
    "rank": 1,
    "name": "string",
    "title": "string",
    "persona": "CTO|CFO office|VP Engineering|Director of Engineering|Engineering Manager|Head of Developer Productivity|Platform lead",
    "linkedin": "public LinkedIn URL or null",
    "email": null,
    "phone": null,
    "rationale": "one line: why this person likely owns AI-tool spend",
    "sourceUrl": "URL verifying name+title"
  }]
}`;

  const { json } = await callLLM(prompt, { stage: 'contacts', webSearch: true, maxSearches: 8, maxTokens: 8000 });
  if (!json?.contacts) throw new Error(`Stage 4 returned no contacts for ${company.name}`);
  return json.contacts.map((c) => ({ ...c, source: 'llm' }));
}
