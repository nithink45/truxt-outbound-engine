// Apollo.io — REAL decision-makers from a system of record instead of the LLM guessing.
// Two-step, matching Apollo's API design:
//   1) SEARCH (mixed_people/search): builds a roster by domain + titles. Cheap, but last
//      names are obfuscated and NO email is returned — only a has_email flag.
//   2) ENRICH (people/match): reveals full name + email for ONE person (costs a credit).
// So we search to rank, then enrich only the top-ranked contact before drafting/sending.
// Gated on APOLLO_API_KEY; returns []/null when unavailable so callers fall back to the LLM.
export const APOLLO_ENABLED = !!process.env.APOLLO_API_KEY;

// Apollo deprecated mixed_people/search for API callers; api_search is the current endpoint.
const SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const MATCH_URL = 'https://api.apollo.io/api/v1/people/match';

function headers(key) {
  return { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key };
}

/**
 * Roster of likely decision-makers at a company by domain + titles.
 * Names may be obfuscated and emails absent here — enrich the chosen one via enrichPerson().
 * @returns {Promise<RealContact[]>} (rank unset), or [] if unavailable.
 */
export async function findDecisionMakers(company, personas, { perPage = 10 } = {}) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return [];
  const domain = company.domain || null;
  if (!domain) return [];

  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        person_titles: personas,
        person_seniorities: ['c_suite', 'vp', 'director', 'head'],
        q_organization_domains_list: [domain],
        page: 1,
        per_page: perPage,
      }),
    });
    if (!res.ok) {
      console.log(`Apollo search HTTP ${res.status} for ${domain} — falling back to LLM contacts.`);
      return [];
    }
    const data = await res.json();
    return (data.people || []).map(normalizeSearchPerson).filter((p) => p.name && p.title);
  } catch (e) {
    console.log(`Apollo error (${e.message}) — falling back to LLM contacts.`);
    return [];
  }
}

/**
 * Reveal full name + email for one person by Apollo id. Costs an Apollo credit.
 * @returns {Promise<{name,email,linkedin,title}|null>} or null if unavailable/failed.
 */
export async function enrichPerson(apolloId) {
  const key = process.env.APOLLO_API_KEY;
  if (!key || !apolloId) return null;
  try {
    const res = await fetch(MATCH_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({ id: apolloId, reveal_personal_emails: false }),
    });
    if (!res.ok) {
      console.log(`Apollo enrich HTTP ${res.status} for ${apolloId} — leaving contact un-enriched.`);
      return null;
    }
    const p = (await res.json()).person;
    if (!p) return null;
    const rawEmail = p.email || null;
    const email = rawEmail && !/email_not_unlocked|not_unlocked/i.test(rawEmail) ? rawEmail : null;
    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || null,
      title: p.title || null,
      linkedin: p.linkedin_url || null,
      email,
      emailVerified: !!email && p.email_status === 'verified',
    };
  } catch (e) {
    console.log(`Apollo enrich error (${e.message}) — leaving contact un-enriched.`);
    return null;
  }
}

function normalizeSearchPerson(p) {
  // Search obfuscates last names on most plans; keep first + obfuscated last for display,
  // flag needsEnrichment so we reveal the chosen contact before it's used to send.
  const lastMasked = p.last_name || p.last_name_obfuscated || '';
  const name = [p.first_name, lastMasked].filter(Boolean).join(' ') || p.name || null;
  return {
    name,
    title: p.title || null,
    persona: p.title || null,
    linkedin: p.linkedin_url || null,
    email: null,                       // never present in search results
    emailVerified: false,
    apolloId: p.id || null,
    needsEnrichment: true,
    nameObfuscated: !p.last_name && !!p.last_name_obfuscated,
    source: 'apollo',
  };
}
