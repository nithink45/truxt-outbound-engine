#!/usr/bin/env node
// CLI: run stages independently from the console.
//   node cli.js discover "mid-market fintechs using Cursor"
//   node cli.js batch "Shopify, Datadog, Chime"
//   node cli.js research <companyId> [companyId...]
//   node cli.js draft <companyId> [companyId...]
//   node cli.js drafts                      # list pending drafts
//   node cli.js approve <draftId>           # explicit human approval
//   node cli.js followups                   # Stage 8 trigger check
//   node cli.js ask "How do I answer 'we already have a DORA dashboard'?"
//   node cli.js metrics
import { startRun, researchCompanies, draftForCompanies, approveAndSend, metrics } from './src/pipeline.js';
import { checkFollowups } from './src/stages/followup.js';
import { askAssistant } from './src/assistant.js';
import * as store from './src/store.js';

const [cmd, ...args] = process.argv.slice(2);
const out = (x) => console.log(JSON.stringify(x, null, 2));

try {
  switch (cmd) {
    case 'discover': {
      const run = await startRun({ query: args.join(' ') });
      printScoredTable(run);
      break;
    }
    case 'batch': {
      const names = args.join(' ').split(',').map((s) => s.trim()).filter(Boolean);
      const run = await startRun({ companyNames: names });
      printScoredTable(run);
      break;
    }
    case 'research': out(await researchCompanies(args)); break;
    case 'draft': out(await draftForCompanies(args)); break;
    case 'drafts':
      out(store.list('drafts', (d) => d.status === 'pending').map((d) => ({
        id: d.id, company: store.get('companies', d.companyId)?.name, subject: d.subject,
      })));
      break;
    case 'approve': out(await approveAndSend(args[0])); break;
    case 'followups': out(await checkFollowups()); break;
    case 'ask': console.log(await askAssistant(args.join(' '))); break;
    case 'metrics': out(metrics()); break;
    default:
      console.log('commands: discover <query> | batch <names,csv> | research <ids...> | draft <ids...> | drafts | approve <draftId> | followups | ask <q> | metrics');
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}

function printScoredTable(run) {
  const companies = (run.companyIds || []).map((id) => store.get('companies', id)).filter(Boolean);
  console.log(`\nRun ${run.id} — ${companies.length} companies\n`);
  for (const c of companies) {
    console.log(`  ${String(c.score).padStart(3)}  ${c.routing.padEnd(8)}  ${c.name.padEnd(28)}  ${c.bucket.padEnd(10)}  ${c.matchedOffering}`);
    console.log(`       id=${c.id}  ${c.matchReasoning || ''}\n`);
  }
}
