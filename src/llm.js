// LLM wrapper: every reasoning stage goes through callLLM().
// Provider-switchable so we can test on Gemini now and flip back to Claude later
// with a single env var (LLM_PROVIDER=anthropic).
// - Gemini path: gemini-2.5-pro, Google Search grounding for web-search stages.
// - Anthropic path: claude-opus-4-8, adaptive thinking, server-side web search.
// - robust JSON extraction (research stages combine tools + JSON output).
// Both paths return the same shape: { json, text, usage, stopReason }.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODEL, GEMINI_MODEL, MODEL_TIERS, STAGE_TIERS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Provider selection: explicit LLM_PROVIDER wins; otherwise infer from which key exists.
export const PROVIDER =
  process.env.LLM_PROVIDER ||
  (process.env.GEMINI_API_KEY ? 'gemini' : 'anthropic');

const anthropic = PROVIDER === 'anthropic' ? new Anthropic() : null;

/**
 * Resolve the concrete model for a call. Precedence:
 *   opts.model (explicit) > opts.tier > STAGE_TIERS[opts.stage] > 'frontier'.
 * Then MODEL_TIERS[PROVIDER][tier]. Lets each stage pick a tier without knowing
 * which provider/model is active — flip providers via LLM_PROVIDER alone.
 */
export function resolveModel(opts = {}) {
  if (opts.model) return opts.model;
  const tier = opts.tier || STAGE_TIERS[opts.stage] || 'frontier';
  const table = MODEL_TIERS[PROVIDER] || {};
  return table[tier] || table.frontier || MODEL;
}

export const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'agent_system_prompt.md'), 'utf8');
export const KNOWLEDGE_BASE = fs.readFileSync(
  path.join(__dirname, '..', 'product_knowledge_base.md'), 'utf8');

/**
 * Call the configured LLM and return parsed JSON.
 * @param {string} userPrompt
 * @param {object} opts
 *   stage: logical stage name → tier via STAGE_TIERS (e.g. 'research', 'followup')
 *   tier: 'frontier' | 'fast' (overrides stage)
 *   model: explicit model id (overrides tier)
 *   webSearch: enable server-side web search / grounding (default false)
 *   maxSearches: cap web_search uses, Anthropic only (default 8)
 *   system: override system prompt (default agent system prompt)
 *   maxTokens: default 16000
 */
export async function callLLM(userPrompt, opts = {}) {
  const model = resolveModel(opts);
  if (PROVIDER === 'gemini') return callGemini(userPrompt, { ...opts, model });
  if (PROVIDER === 'openrouter') return callOpenRouter(userPrompt, { ...opts, model });
  return callAnthropic(userPrompt, { ...opts, model });
}

// ---------------------------------------------------------------------------
// Gemini (Google Generative Language REST API — no SDK dependency)
// ---------------------------------------------------------------------------
async function callGemini(userPrompt, opts = {}) {
  const {
    webSearch = false,
    system = SYSTEM_PROMPT,
    maxTokens = 16000,
    model = GEMINI_MODEL,
  } = opts;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Google Search grounding is a separate, tight quota on some keys. GEMINI_GROUNDING=off
  // disables it globally; otherwise a grounded call that hits the grounding quota
  // auto-falls-back to a non-grounded call so one dead quota never hard-fails a stage.
  // NOTE: without grounding, research claims/source URLs are model-generated, NOT
  // verified web retrieval — do not send such drafts unedited.
  let grounded = webSearch && process.env.GEMINI_GROUNDING !== 'off';

  const buildBody = () => ({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    // Grounding tool disables JSON response-mime, so we rely on extractJSON().
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  });

  // Retry on 429 (per-minute rate limit) and transient 5xx, honoring the API's
  // suggested retryDelay when present, else exponential backoff. Max ~5 tries.
  let data;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(buildBody()),
    });

    if (res.ok) {
      data = await res.json();
      break;
    }

    const errText = await res.text();

    // Grounding-quota 429s have no retryDelay/QuotaFailure detail. If we're grounded
    // and hit that, drop grounding and retry immediately (degraded, no web retrieval).
    if (res.status === 429 && grounded && !/retryDelay/.test(errText)) {
      grounded = false;
      console.log('Gemini grounding quota exhausted — falling back to non-grounded (degraded, unverified sources).');
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5) {
      throw new Error(`Gemini API ${res.status}: ${errText}`);
    }

    // Prefer the server's RetryInfo.retryDelay (e.g. "42s"); else backoff.
    let waitMs = Math.min(60000, 15000 * Math.pow(2, attempt));
    const m = errText.match(/"retryDelay":\s*"(\d+)(?:\.\d+)?s"/);
    if (m) waitMs = Math.max(waitMs, (parseInt(m[1], 10) + 1) * 1000);
    console.log(`Gemini ${res.status} — retry ${attempt + 1}/5 in ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  const cand = data.candidates?.[0];
  // Skip thinking parts (thought:true) — only keep the visible answer text.
  const text = (cand?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text)
    .join('\n');

  return {
    json: extractJSON(text),
    text,
    usage: data.usageMetadata,
    stopReason: cand?.finishReason,
  };
}

// ---------------------------------------------------------------------------
// Anthropic (claude-opus-4-8) — kept for the shift back to Claude.
// ---------------------------------------------------------------------------
async function callAnthropic(userPrompt, opts = {}) {
  const {
    webSearch = false,
    maxSearches = 8,
    system = SYSTEM_PROMPT,
    maxTokens = 16000,
    model = MODEL,
  } = opts;

  const tools = webSearch
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }]
    : undefined;

  let messages = [{ role: 'user', content: userPrompt }];
  let response;

  // pause_turn loop: server-side tools may pause; re-send to resume (cap 5)
  for (let i = 0; i < 5; i++) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      ...(tools ? { tools } : {}),
      messages,
    });
    response = await stream.finalMessage();
    if (response.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: response.content }];
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return { json: extractJSON(text), text, usage: response.usage, stopReason: response.stop_reason };
}

// ---------------------------------------------------------------------------
// OpenRouter (OpenAI-compatible gateway — one key, many models). No SDK dep.
// webSearch uses OpenRouter's web plugin (paid add-on); grounding will move to
// search.js in Phase 2, so most stages call this without webSearch.
// ---------------------------------------------------------------------------
async function callOpenRouter(userPrompt, opts = {}) {
  const {
    webSearch = false,
    system = SYSTEM_PROMPT,
    maxTokens = 16000,
    model = MODEL_TIERS.openrouter.frontier,
  } = opts;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
    ...(webSearch ? { plugins: [{ id: 'web' }] } : {}),
  };

  let data;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Optional attribution headers per OpenRouter docs.
        'X-Title': 'Truxt Outbound Engine',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) { data = await res.json(); break; }

    const errText = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5) {
      throw new Error(`OpenRouter API ${res.status}: ${errText}`);
    }
    const waitMs = Math.min(60000, 15000 * Math.pow(2, attempt));
    console.log(`OpenRouter ${res.status} — retry ${attempt + 1}/5 in ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  const text = data.choices?.[0]?.message?.content || '';
  return {
    json: extractJSON(text),
    text,
    usage: data.usage,
    stopReason: data.choices?.[0]?.finish_reason,
  };
}

/** Pull the first JSON object/array out of model text (handles code fences, prose). */
export function extractJSON(text) {
  if (!text) return null;
  // strip code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  for (const c of candidates) {
    const trimmed = c.trim();
    // try direct parse first
    try { return JSON.parse(trimmed); } catch {}
    // find first balanced {...} or [...]
    for (const open of ['{', '[']) {
      const close = open === '{' ? '}' : ']';
      const start = trimmed.indexOf(open);
      if (start === -1) continue;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = !inStr;
        if (inStr) continue;
        if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { break; }
          }
        }
      }
    }
  }
  return null;
}
