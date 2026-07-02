const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let currentRunId = null;

// ---------- metrics ----------
async function loadMetrics() {
  try {
    const m = await api('/api/metrics');
    const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
    $('#metrics').innerHTML = `
      <span>Companies <b>${m.companies}</b></span>
      <span>Pending <b>${m.draftsPending}</b></span>
      <span>Sent <b>${m.sent}</b></span>
      <span>Open <b>${pct(m.openRate)}</b></span>
      <span>Reply <b>${pct(m.replyRate)}</b></span>
      <span>Meetings <b>${pct(m.meetingRate)}</b></span>`;
  } catch {}
}

// ---------- runs ----------
async function loadRuns() {
  const runs = await api('/api/runs');
  const picker = $('#runPicker');
  picker.innerHTML = runs.map((r) =>
    `<option value="${r.id}">${esc(r.query || (r.companyNames || []).join(', ') || r.id)} — ${r.status}</option>`).join('');
  if (runs.length && !currentRunId) currentRunId = runs[0].id;
  if (currentRunId) picker.value = currentRunId;
}

async function loadCompanies() {
  if (!currentRunId) return;
  const run = await api(`/api/runs/${currentRunId}`);
  $('#runLabel').textContent = `· ${run.status}`;
  const tbody = $('#companyTable tbody');
  tbody.innerHTML = (run.companies || []).map((c) => `
    <tr>
      <td><input type="checkbox" class="rowCheck" value="${c.id}" /></td>
      <td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.domain || '')}</span></td>
      <td class="score">${c.score}</td>
      <td><span class="badge ${c.routing}">${c.routing}</span></td>
      <td>${esc(c.bucket)}</td>
      <td>${esc(c.matchedOffering)}</td>
      <td class="muted">${esc(c.matchedMechanism)}</td>
      <td class="muted">${esc(c.matchReasoning || '')}</td>
      <td>${esc(c.stage)}${c.error ? ` <span class="status-rejected">${esc(c.error)}</span>` : ''}</td>
    </tr>`).join('');
  // assistant account picker
  const all = await api('/api/companies');
  $('#assistantCompany').innerHTML = '<option value="">(no account context)</option>' +
    all.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

const checkedIds = () => [...document.querySelectorAll('.rowCheck:checked')].map((x) => x.value);

// ---------- draft trust surfaces ----------
// Verification + contact-source chips: at-a-glance "why is this draft trustworthy".
function trustChips(d) {
  const chips = [];
  const v = d.company?.research?.verification;
  if (v && v.total) {
    const ok = (v.supported || 0) + (v.partial || 0);
    const cls = ok === v.total ? 'ok' : ok > 0 ? 'warn' : 'bad';
    chips.push(`<span class="chip ${cls}">✓ ${ok}/${v.total} claims verified</span>`);
  }
  const c = d.contact || {};
  if (c.source === 'apollo') {
    const tail = c.emailVerified ? 'verified email' : c.email ? 'email on file' : 'no email';
    chips.push(`<span class="chip ok">Apollo · ${esc(tail)}</span>`);
  } else if (c.name) {
    chips.push(`<span class="chip warn">LLM-identified contact</span>`);
  }
  return chips.join(' ');
}

// Per-variant judge scorecard (winner highlighted).
function judgeScorecard(d) {
  if (!(d.judgeScores || []).length) return '';
  const rows = d.judgeScores.map((s) => {
    const angle = (d.variants || []).find((v) => v.label === s.label)?.angle || '';
    return `<tr class="${s.label === d.chosen ? 'winner' : ''}">
      <td>${esc(s.label)}${s.label === d.chosen ? ' ★' : ''}</td><td class="muted">${esc(angle)}</td>
      <td>${s.specific ?? ''}</td><td>${s.mechanismNamed ?? ''}</td><td>${s.noHype ?? ''}</td>
      <td>${s.noFabrication ?? ''}</td><td>${s.helpfulPosture ?? ''}</td><td><b>${s.total ?? ''}</b></td>
      <td class="muted">${esc(s.notes || '')}</td></tr>`;
  }).join('');
  return `<details><summary>Judge scorecard (${d.judgeScores.length} variants)</summary>
    <div class="scroll-x"><table class="scorecard"><thead><tr><th>Var</th><th>Angle</th><th>Spec</th><th>Mech</th>
    <th>Hype</th><th>Fab</th><th>Help</th><th>Total</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody></table></div></details>`;
}

// Research claims with per-claim verdict badges + supporting quote/source.
function factsPanel(d) {
  const claims = d.company?.research?.claims || [];
  if (!claims.length) return '';
  const v = d.company?.research?.verification;
  const head = v ? `${(v.supported || 0) + (v.partial || 0)}/${v.total} verified` : '';
  const items = claims.map((cl) => {
    const detail = cl.supportingQuote
      ? `<div class="why">“${esc(cl.supportingQuote)}” — <a href="${esc(cl.sourceUrl)}" target="_blank" rel="noopener">source</a>${cl.fetchedVia ? ` · via ${esc(cl.fetchedVia)}` : ''}</div>`
      : cl.verifyReason ? `<div class="why">${esc(cl.verifyReason)} — <a href="${esc(cl.sourceUrl)}" target="_blank" rel="noopener">source</a></div>` : '';
    return `<li><span class="vbadge ${esc(cl.verdict || 'unknown')}">${esc(cl.verdict || '?')}</span> ${esc(cl.claim)}${detail}</li>`;
  }).join('');
  return `<details><summary>Research claims (${claims.length}) · ${head}</summary>
    <ul class="rationale facts">${items}</ul></details>`;
}

// ---------- drafts / review ----------
async function loadDrafts() {
  const drafts = await api('/api/drafts');
  $('#drafts').innerHTML = drafts.map((d) => {
    const variants = (d.variants || []).map((v) =>
      `<button class="ghost pickVariant" data-id="${d.id}" data-label="${v.label}">Variant ${v.label}${v.angle ? ` · ${esc(v.angle)}` : ''}${v.label === d.chosen ? ' ★' : ''}</button>`).join('');
    const rationale = (d.rationale || []).map((r) =>
      `<li><div class="line">“${esc(r.line)}”</div><div class="why">${esc(r.why)}</div></li>`).join('');
    const pending = d.status === 'pending';
    return `
    <div class="draft ${d.status}" data-id="${d.id}">
      <h3>${esc(d.company?.name || '?')} → ${esc(d.contact?.name || '?')} <span class="muted">(${esc(d.contact?.title || '')})</span>
        ${d.isFollowup ? '<span class="badge Standard">follow-up</span>' : ''}
        <span class="status-${d.status}">${d.status}</span></h3>
      <div class="meta">${esc(d.company?.matchedOffering || '')} · ${esc(d.company?.matchedMechanism || '')}</div>
      <div class="trustbar">${trustChips(d)}</div>
      <div class="variants">${variants}</div>
      ${d.chosenReason ? `<div class="pickreason">Judge picked <b>${esc(d.chosen)}</b>: ${esc(d.chosenReason)}</div>` : ''}
      <input class="subj" value="${esc(d.subject)}" ${pending ? '' : 'disabled'} />
      <textarea class="body" ${pending ? '' : 'disabled'}>${esc(d.body)}</textarea>
      <details><summary>Line-by-line rationale (${(d.rationale || []).length})</summary><ul class="rationale">${rationale}</ul></details>
      ${judgeScorecard(d)}
      ${factsPanel(d)}
      <div class="row">
        ${pending ? `
          <button class="approve approveBtn" data-id="${d.id}">Approve &amp; send</button>
          <button class="ghost rejectBtn" data-id="${d.id}">Reject</button>` : ''}
        ${d.status === 'sent' ? `
          <label><input type="checkbox" class="outcome" data-id="${d.id}" data-k="opened" ${d.opened ? 'checked' : ''}/> opened</label>
          <label><input type="checkbox" class="outcome" data-id="${d.id}" data-k="replied" ${d.replied ? 'checked' : ''}/> replied</label>
          <label><input type="checkbox" class="outcome" data-id="${d.id}" data-k="meetingBooked" ${d.meetingBooked ? 'checked' : ''}/> meeting booked</label>
          <label><input type="checkbox" class="outcome" data-id="${d.id}" data-k="recapLogged" ${d.recapLogged ? 'checked' : ''}/> recap logged</label>
          <span class="muted">sent via ${esc(d.sentVia || '')} ${esc(d.sentAt || '')}</span>` : ''}
      </div>
    </div>`;
  }).join('') || '<div class="muted">No drafts yet — research + draft some checked rows above.</div>';

  // wire buttons
  document.querySelectorAll('.pickVariant').forEach((b) => b.onclick = async () => {
    const drafts2 = await api('/api/drafts');
    const d = drafts2.find((x) => x.id === b.dataset.id);
    const v = d.variants.find((x) => x.label === b.dataset.label);
    await api(`/api/drafts/${d.id}`, { method: 'PATCH', body: { subject: v.subject, body: v.body } });
    loadDrafts();
  });
  document.querySelectorAll('.approveBtn').forEach((b) => b.onclick = async () => {
    const card = b.closest('.draft');
    b.disabled = true; b.textContent = 'Sending…';
    try {
      await api(`/api/drafts/${b.dataset.id}/approve`, {
        method: 'POST',
        body: { edits: { subject: card.querySelector('.subj').value, body: card.querySelector('.body').value } },
      });
    } catch (e) { alert(e.message); }
    loadDrafts(); loadMetrics();
  });
  document.querySelectorAll('.rejectBtn').forEach((b) => b.onclick = async () => {
    await api(`/api/drafts/${b.dataset.id}/reject`, { method: 'POST' });
    loadDrafts(); loadMetrics();
  });
  document.querySelectorAll('.outcome').forEach((cb) => cb.onchange = async () => {
    await api(`/api/drafts/${cb.dataset.id}/outcome`, { method: 'POST', body: { [cb.dataset.k]: cb.checked } });
    loadMetrics();
  });
}

// ---------- actions ----------
$('#startRun').onclick = async () => {
  const query = $('#query').value.trim();
  const batch = $('#batch').value.trim();
  if (!query && !batch) return alert('Enter a discovery query or a batch of company names.');
  const btn = $('#startRun');
  btn.disabled = true; $('#runStatus').innerHTML = '<span class="spinner">Discovering + scoring… (this uses live web search and can take a couple of minutes)</span>';
  try {
    const run = await api('/api/runs', { method: 'POST', body: {
      query: query || null,
      companyNames: batch ? batch.split(',').map((s) => s.trim()).filter(Boolean) : [],
    }});
    currentRunId = run.id;
    $('#runStatus').textContent = `Run ${run.id}: ${run.status} — ${(run.companyIds || []).length} companies`;
  } catch (e) { $('#runStatus').textContent = 'Error: ' + e.message; }
  btn.disabled = false;
  await loadRuns(); await loadCompanies(); await loadMetrics();
};

$('#runPicker').onchange = (e) => { currentRunId = e.target.value; loadCompanies(); };
$('#refreshBtn').onclick = () => { loadRuns(); loadCompanies(); loadDrafts(); loadMetrics(); };

$('#researchBtn').onclick = async () => {
  const ids = checkedIds();
  if (!ids.length) return alert('Check at least one row.');
  const btn = $('#researchBtn'); btn.disabled = true; btn.textContent = 'Researching…';
  try { await api('/api/research', { method: 'POST', body: { companyIds: ids } }); }
  catch (e) { alert(e.message); }
  btn.disabled = false; btn.textContent = 'Research checked (Stages 3–4)';
  loadCompanies();
};

$('#draftBtn').onclick = async () => {
  const ids = checkedIds();
  if (!ids.length) return alert('Check at least one row.');
  const btn = $('#draftBtn'); btn.disabled = true; btn.textContent = 'Drafting…';
  try { await api('/api/draft', { method: 'POST', body: { companyIds: ids } }); }
  catch (e) { alert(e.message); }
  btn.disabled = false; btn.textContent = 'Draft checked (Stages 5–6)';
  loadCompanies(); loadDrafts(); loadMetrics();
};

$('#followupBtn').onclick = async () => {
  const btn = $('#followupBtn'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const created = await api('/api/followups/check', { method: 'POST' });
    alert(`${created.length} follow-up draft(s) queued for approval.`);
  } catch (e) { alert(e.message); }
  btn.disabled = false; btn.textContent = 'Check follow-up triggers (Stage 8)';
  loadDrafts();
};

$('#askBtn').onclick = async () => {
  const q = $('#assistantQ').value.trim();
  if (!q) return;
  const btn = $('#askBtn'); btn.disabled = true;
  $('#assistantA').textContent = 'Thinking…';
  try {
    const { answer } = await api('/api/assistant', { method: 'POST', body: { question: q, companyId: $('#assistantCompany').value || null } });
    $('#assistantA').textContent = answer;
  } catch (e) { $('#assistantA').textContent = 'Error: ' + e.message; }
  btn.disabled = false;
};

// ---------- init ----------
(async () => {
  await loadRuns(); await loadCompanies(); await loadDrafts(); await loadMetrics();
})();
