// Sales-assistant mode (modeled on OpenAI's GTM Assistant): call prep, product Q&A,
// objection handling, offering/angle recommendations. Retrieves from the product
// knowledge base (loaded directly into context — small enough for now; swap in
// embeddings/RAG when it grows) plus any stored research for the named account.
import { callLLM, KNOWLEDGE_BASE } from './llm.js';
import * as store from './store.js';

const ASSISTANT_SYSTEM = `You are Truxt's internal sales assistant for the founder.
You answer call-prep questions, product Q&A, and objections — grounded ONLY in the product
knowledge base provided. Truxt has real users and customers — never call it "pre-revenue"
or say it has no customers/case studies. Don't invent specific customer names, logos, or
metrics not in the knowledge base; label any purely illustrative figure as such. Ground objection answers in the
session-to-commit linkage, the Knowledge Graph, and delivery-outcome correlation.
Be direct and practical. Answer in plain prose (not JSON).

PRODUCT KNOWLEDGE BASE:
${KNOWLEDGE_BASE}`;

export async function askAssistant(question, companyId = null) {
  let accountContext = '';
  if (companyId) {
    const company = store.get('companies', companyId);
    if (company) {
      const contacts = store.list('contacts', (c) => c.companyId === companyId);
      accountContext = `\n\nACCOUNT CONTEXT — ${company.name}:\n${JSON.stringify({
        bucket: company.bucket,
        matchedOffering: company.matchedOffering,
        matchedMechanism: company.matchedMechanism,
        score: company.score,
        routing: company.routing,
        research: company.research || null,
        contacts: contacts.map((c) => ({ name: c.name, title: c.title, rationale: c.rationale })),
      }, null, 2)}`;
    }
  }

  const { text } = await callLLM(`${question}${accountContext}`, {
    stage: 'assistant',
    system: ASSISTANT_SYSTEM,
    maxTokens: 8000,
  });
  return text;
}
