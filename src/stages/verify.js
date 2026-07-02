// Verify stage: enforce "public data only, source URL per claim" MECHANICALLY.
// For each research claim we INDEPENDENTLY re-fetch its cited URL (not the model's
// search loop — that would be confirmation bias) and ask the model whether the page
// text actually supports the claim. Unsupported claims are dropped; survivors carry
// a verbatim supporting quote. Only verified claims are meant to reach a draft.
import { callLLM } from '../llm.js';

const FETCH_TIMEOUT_MS = 12000;
const READER_TIMEOUT_MS = 22000;
const MAX_PAGE_CHARS = 8000;
const MIN_GOOD_CHARS = 400; // below this, a direct fetch is "thin" (likely a JS-rendered SPA)

const VERIFIER_SYSTEM =
  'You are a meticulous fact-checker. Judge the claim ONLY against the provided page text. ' +
  'Do not use outside knowledge. Be strict: mark "supported" only if the page substantiates the claim.';

/**
 * Fetch a URL and reduce it to plain text. Never throws — returns {ok,text|reason,via}.
 * Tries a direct fetch first (fast, no third party). If that is thin (SPA) or blocked
 * (403/timeout), falls back to a rendering reader proxy so JS-heavy or bot-blocked pages
 * still verify instead of becoming false negatives. Disable the fallback with
 * VERIFY_READER=off (then such pages stay 'unverifiable').
 */
export async function fetchPageText(url) {
  const direct = await directFetch(url);
  const thin = direct.ok && direct.text.length < MIN_GOOD_CHARS;
  if (direct.ok && !thin) return { ...direct, via: 'direct' };

  if (process.env.VERIFY_READER === 'off') {
    if (direct.ok) return { ...direct, via: 'direct(thin)' };
    return direct;
  }

  const reader = await readerFetch(url);
  if (reader.ok) return { ...reader, via: 'reader' };
  if (direct.ok) return { ...direct, via: 'direct(thin)' }; // thin beats nothing
  return { ok: false, reason: `direct: ${direct.reason}; reader: ${reader.reason}` };
}

/** Direct HTTP fetch + HTML→text. */
async function directFetch(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TruxtOutbound/1.0; research verifier)' },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ctype = res.headers.get('content-type') || '';
    if (!/html|text|json|xml/i.test(ctype)) return { ok: false, reason: `non-text (${ctype || 'unknown'})` };
    const text = htmlToText(await res.text()).slice(0, MAX_PAGE_CHARS);
    if (!text.trim()) return { ok: false, reason: 'empty after strip' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

/** Rendering reader proxy (r.jina.ai) — renders JS + returns clean text. No key needed. */
async function readerFetch(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READER_TIMEOUT_MS);
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TruxtOutbound/1.0; research verifier)' },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `reader HTTP ${res.status}` };
    const text = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_CHARS);
    if (!text) return { ok: false, reason: 'reader empty' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'reader timeout' : e.message };
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function checkClaim(claim, pageText) {
  const prompt = `Verify this research claim against the ACTUAL text of its cited source page.

CLAIM: ${claim.claim}
CITED URL: ${claim.sourceUrl}

SOURCE PAGE TEXT (may be truncated):
"""
${pageText}
"""

Return ONLY JSON:
{"verdict":"supported|partial|unsupported","quote":"short verbatim quote from the page that supports it, or null","reason":"one line"}`;
  const { json } = await callLLM(prompt, { stage: 'verify', system: VERIFIER_SYSTEM, maxTokens: 1500 });
  return json && json.verdict
    ? json
    : { verdict: 'unsupported', quote: null, reason: 'verifier returned no JSON' };
}

/**
 * Verify every claim in a research object. Returns the research with each claim
 * annotated { verified, verdict, supportingQuote, verifyReason } plus a `verification`
 * summary. 'supported'/'partial' → verified; 'unsupported' → not; fetch failures →
 * 'unverifiable' (kept but not verified — surfaced, never silently dropped).
 */
export async function verifyResearch(research) {
  const claims = Array.isArray(research?.claims) ? research.claims : [];
  const checked = await Promise.all(
    claims.map(async (c) => {
      if (!c?.sourceUrl) {
        return { ...c, verified: false, verdict: 'unverifiable', supportingQuote: null, verifyReason: 'no source URL' };
      }
      const page = await fetchPageText(c.sourceUrl);
      if (!page.ok) {
        return { ...c, verified: false, verdict: 'unverifiable', supportingQuote: null, verifyReason: `fetch failed: ${page.reason}` };
      }
      const r = await checkClaim(c, page.text);
      const verified = r.verdict === 'supported' || r.verdict === 'partial';
      return { ...c, verified, verdict: r.verdict, supportingQuote: r.quote || null, verifyReason: r.reason || null, fetchedVia: page.via };
    })
  );

  const count = (v) => checked.filter((c) => c.verdict === v).length;
  const verification = {
    total: checked.length,
    supported: count('supported'),
    partial: count('partial'),
    unsupported: count('unsupported'),
    unverifiable: count('unverifiable'),
    verifiedAt: new Date().toISOString(),
  };
  return { ...research, claims: checked, verification };
}

/** The claims a draft may anchor on: verified only, with their supporting quote. */
export function verifiedFacts(research) {
  return (research?.claims || [])
    .filter((c) => c.verified)
    .map((c) => ({ claim: c.claim, quote: c.supportingQuote, url: c.sourceUrl }));
}
