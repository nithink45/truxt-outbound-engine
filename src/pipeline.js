// Orchestration: chains the discrete stages and persists state so the dashboard
// (and CLI) can start a run, research checked rows, draft, approve, and follow up.
import * as store from './store.js';
import { discover } from './stages/discovery.js';
import { bucketize } from './stages/bucketing.js';
import { deepResearch } from './stages/research.js';
import { verifyResearch } from './stages/verify.js';
import { identifyContacts } from './stages/contacts.js';
import { draftEmail } from './stages/drafting.js';
import { alertPriorityLead, sendApproved } from './senders.js';

// Stages 1 + 2: discovery → bucket/offering/mechanism → scored table
export async function startRun({ query = null, companyNames = [] }) {
  const run = store.insert('runs', {
    query, companyNames,
    status: 'discovering',
    startedAt: new Date().toISOString(),
  });
  try {
    const raw = await discover({ query, companyNames });
    store.update('runs', run.id, { status: 'bucketing' });
    const scored = await bucketize(raw);
    const companyIds = [];
    for (const c of scored.sort((a, b) => b.score - a.score)) {
      const doc = store.insert('companies', { ...c, runId: run.id, stage: 'scored' });
      companyIds.push(doc.id);
      if (doc.routing === 'Priority') await alertPriorityLead(doc);
    }
    store.update('runs', run.id, { status: 'scored', companyIds });
    store.logEvent('run_scored', { runId: run.id, count: companyIds.length });
    return store.get('runs', run.id);
  } catch (e) {
    store.update('runs', run.id, { status: 'error', error: e.message });
    throw e;
  }
}

// Stages 3 + 4 for the checked rows
export async function researchCompanies(companyIds) {
  const results = [];
  for (const cid of companyIds) {
    const company = store.get('companies', cid);
    if (!company) continue;
    store.update('companies', cid, { stage: 'researching' });
    try {
      const rawResearch = await deepResearch(company);
      // Verify stage: independently re-fetch each cited URL and claim-check it.
      const research = process.env.VERIFY_ENABLED === 'off'
        ? rawResearch
        : await verifyResearch(rawResearch);
      const contacts = await identifyContacts(company, research);
      const contactIds = contacts.map((ct) =>
        store.insert('contacts', { ...ct, companyId: cid }).id);
      // re-score: a ranked contact with spend authority adds +10
      const { computeScore } = await import('./stages/bucketing.js');
      const rescored = computeScore({ ...company, contactAuthority: contacts.length > 0 });
      store.update('companies', cid, {
        research, contactIds, stage: 'researched', ...rescored,
      });
      results.push(store.get('companies', cid));
    } catch (e) {
      store.update('companies', cid, { stage: 'error', error: e.message });
    }
  }
  return results;
}

// Stages 5 + 6 for researched companies → pending drafts in the review view
export async function draftForCompanies(companyIds) {
  const drafts = [];
  for (const cid of companyIds) {
    const company = store.get('companies', cid);
    if (!company?.research) continue;
    const contact = (company.contactIds || [])
      .map((id) => store.get('contacts', id))
      .sort((a, b) => (a?.rank || 9) - (b?.rank || 9))[0];
    if (!contact) continue;
    store.update('companies', cid, { stage: 'drafting' });
    try {
      const out = await draftEmail(company, company.research, contact);
      const chosenVariant = out.variants.find((v) => v.label === out.chosen) || out.variants[0];
      const doc = store.insert('drafts', {
        companyId: cid,
        contactId: contact.id,
        runId: company.runId,
        variants: out.variants,
        chosen: out.chosen,
        chosenReason: out.chosenReason,
        rationale: out.rationale,
        judgeScores: out.judgeScores,
        subject: chosenVariant.subject,
        body: chosenVariant.body,
        status: 'pending', // Stage 7: nothing sends without explicit approval
        channel: 'email',
      });
      store.update('companies', cid, { stage: 'drafted' });
      store.logEvent('draft_created', { draftId: doc.id, companyId: cid });
      drafts.push(doc);
    } catch (e) {
      store.update('companies', cid, { stage: 'error', error: e.message });
    }
  }
  return drafts;
}

// Stage 7: the ONLY path to a send — explicit approval of a specific draft
export async function approveAndSend(draftId, edits = null) {
  const draft = store.get('drafts', draftId);
  if (!draft) throw new Error('draft not found');
  if (draft.status === 'sent') throw new Error('already sent');
  if (edits) store.update('drafts', draftId, edits);
  const fresh = store.get('drafts', draftId);
  const company = store.get('companies', fresh.companyId);
  const contact = store.get('contacts', fresh.contactId);
  const result = await sendApproved(fresh, company, contact);
  store.update('drafts', draftId, {
    status: 'sent',
    sentAt: new Date().toISOString(),
    sentVia: result.via,
  });
  return store.get('drafts', draftId);
}

// Instrumentation rollup
export function metrics() {
  const drafts = store.list('drafts');
  const sent = drafts.filter((d) => d.status === 'sent');
  const events = store.list('events');
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const touchTimes = sent
    .map((d) => {
      const c = store.get('companies', d.companyId);
      return c ? (new Date(d.sentAt) - new Date(c.createdAt)) / 3600000 : null;
    })
    .filter((x) => x != null);
  const byMechanism = {};
  for (const d of sent) {
    const c = store.get('companies', d.companyId);
    const key = c?.matchedOffering || 'unknown';
    byMechanism[key] = byMechanism[key] || { sent: 0, opened: 0, replied: 0, meetings: 0 };
    byMechanism[key].sent++;
    if (d.opened) byMechanism[key].opened++;
    if (d.replied) byMechanism[key].replied++;
    if (d.meetingBooked) byMechanism[key].meetings++;
  }
  return {
    companies: store.list('companies').length,
    draftsPending: drafts.filter((d) => d.status === 'pending').length,
    sent: sent.length,
    openRate: sent.length ? sent.filter((d) => d.opened).length / sent.length : null,
    replyRate: sent.length ? sent.filter((d) => d.replied).length / sent.length : null,
    meetingRate: sent.length ? sent.filter((d) => d.meetingBooked).length / sent.length : null,
    avgHoursDiscoveryToFirstTouch: avg(touchTimes),
    byMechanism,
    events: events.length,
  };
}
