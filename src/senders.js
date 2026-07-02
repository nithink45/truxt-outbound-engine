// Send / CRM / alert integrations. Everything here runs ONLY after explicit human
// approval in the dashboard (Stage 7 gate). Each integration is env-gated: with no
// credentials configured, sends are recorded to the local outbox (data/outbox/) so the
// pipeline is fully testable end-to-end without touching an external service.
//
//   SLACK_WEBHOOK_URL   — Priority-lead alerts + send notifications
//   INSTANTLY_API_KEY   — cold email at scale (Instantly V2 API)
//   HUBSPOT_TOKEN       — CRM logging (private app token)
//   Gmail / HeyReach    — wire via their APIs or MCP when connected (stubs below)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX = path.join(__dirname, '..', 'data', 'outbox');

export async function sendApproved(draft, company, contact) {
  const record = {
    draftId: draft.id,
    to: contact?.email || `[no verified email — connect Apollo/Clay] ${contact?.name || ''}`,
    company: company?.name,
    subject: draft.subject,
    body: draft.body,
    channel: draft.channel || 'email',
    approvedAt: new Date().toISOString(),
  };

  let via = 'outbox';
  if (process.env.INSTANTLY_API_KEY && contact?.email && draft.channel !== 'linkedin') {
    via = await sendViaInstantly(record) ? 'instantly' : 'outbox';
  }
  // Gmail one-off / HeyReach LinkedIn: add here when credentials are connected.

  if (via === 'outbox') {
    fs.mkdirSync(OUTBOX, { recursive: true });
    fs.writeFileSync(path.join(OUTBOX, `${draft.id}.json`), JSON.stringify(record, null, 2));
  }

  await logToHubspot(record);
  await slackNotify(`📤 Sent (${via}): "${draft.subject}" → ${record.to} @ ${company?.name}`);
  store.logEvent('send', { draftId: draft.id, companyId: company?.id, via });
  return { via, record };
}

export async function alertPriorityLead(company) {
  const msg = `🔥 Priority lead: *${company.name}* (score ${company.score}) — ${company.matchedOffering}\n${company.matchReasoning || ''}`;
  await slackNotify(msg);
  store.logEvent('priority_alert', { companyId: company.id });
}

async function slackNotify(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) { console.log(`[slack:dry-run] ${text}`); return; }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error('Slack notify failed:', e.message);
  }
}

async function sendViaInstantly(record) {
  try {
    // Instantly V2: add the lead to the configured campaign; Instantly handles delivery.
    const res = await fetch('https://api.instantly.ai/api/v2/leads', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        campaign: process.env.INSTANTLY_CAMPAIGN_ID,
        email: record.to,
        company_name: record.company,
        personalization: record.body,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Instantly send failed:', e.message);
    return false;
  }
}

async function logToHubspot(record) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) { console.log(`[hubspot:dry-run] logged send to ${record.company}`); return; }
  try {
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        properties: {
          hs_note_body: `Truxt outbound sent to ${record.to} @ ${record.company}\nSubject: ${record.subject}\n\n${record.body}`,
          hs_timestamp: Date.now(),
        },
      }),
    });
  } catch (e) {
    console.error('HubSpot log failed:', e.message);
  }
}
