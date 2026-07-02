// Stage 8: Condition-Based Follow-Up. Scans sent drafts against trigger rules and
// drafts follow-ups referencing the prior touch + same mechanism. Every follow-up
// is queued as a NEW pending draft — it passes the same human approval gate.
import { callLLM, KNOWLEDGE_BASE } from '../llm.js';
import { FOLLOWUP_RULES } from '../config.js';
import * as store from '../store.js';

export async function checkFollowups() {
  const now = Date.now();
  const sent = store.list('drafts', (d) => d.status === 'sent');
  const created = [];

  for (const d of sent) {
    for (const rule of FOLLOWUP_RULES) {
      if (!rule.condition(d, now)) continue;
      const company = store.get('companies', d.companyId);
      const contact = store.get('contacts', d.contactId);
      const fu = await draftFollowup(d, company, contact, rule);
      const doc = store.insert('drafts', {
        companyId: d.companyId,
        contactId: d.contactId,
        runId: d.runId,
        parentDraftId: d.id,
        followupRule: rule.id,
        variants: fu.variants,
        chosen: fu.chosen,
        chosenReason: fu.chosenReason,
        rationale: fu.rationale,
        subject: fu.variants.find((v) => v.label === fu.chosen)?.subject,
        body: fu.variants.find((v) => v.label === fu.chosen)?.body,
        status: 'pending', // approval gate — never auto-send
        channel: d.channel || 'email',
        isFollowup: true,
      });
      // mark the parent so the same rule doesn't re-fire
      const flag = rule.id === 'no_reply_3d' ? 'followupDrafted'
        : rule.id === 'opened_no_reply_5d' ? 'followupDrafted2' : 'recapFollowupDrafted';
      store.update('drafts', d.id, { [flag]: true });
      created.push(doc);
    }
  }
  return created;
}

async function draftFollowup(parent, company, contact, rule) {
  const prompt = `STAGE 8: FOLLOW-UP DRAFT

Trigger condition: ${rule.desc}.
Prior email to ${contact?.name || 'the contact'} (${contact?.title || ''}) at ${company?.name}:
Subject: ${parent.subject}
Body:
${parent.body}

Matched offering: ${company?.matchedOffering}. Mechanism: ${company?.matchedMechanism}.

PRODUCT KNOWLEDGE BASE:
${KNOWLEDGE_BASE}

Write 2 short follow-up variants (under 80 words) that reference the prior touch and the SAME mechanism from a fresh angle. Founder voice: plain, direct, no hype, no guilt-tripping ("just bumping this"). Add one new piece of value (a sharper question, a concrete hypothetical scenario labeled as such, or a relevant observation). Placeholders labeled. Light CTA.

Return ONLY JSON:
{"variants": [{"label": "A", "subject": "string (Re: prior subject unless a better one exists)", "body": "string"}], "chosen": "A", "chosenReason": "one line", "rationale": [{"line": "string", "why": "string"}]}`;

  const { json } = await callLLM(prompt, { stage: 'followup', maxTokens: 8000 });
  if (!json?.variants?.length) throw new Error('Stage 8 returned no follow-up variants');
  return json;
}
