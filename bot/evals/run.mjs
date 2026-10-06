import { runCase, evalChecks } from "./harness.mjs";
import { CASES } from "./cases.mjs";
import { resolveAIRoute } from "../functions/lib/shared.mjs";
import { writeFileSync } from "node:fs";

const env = process.env;
const routes = Object.fromEntries(["triage", "reply", "expert"].map(role => {
  const { provider, model, reasoningEffort } = resolveAIRoute(env, role);
  return [role, { provider, model, reasoningEffort }];
}));
if (!resolveAIRoute(env, "triage").apiKey) {
  console.error("Set the selected provider's API key to run the evals.");
  process.exit(2);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const cases = wanted.length ? CASES.filter((c) => wanted.includes(c.id)) : CASES;
if (!cases.length) {
  console.error(`No cases matched: ${wanted.join(", ")}`);
  process.exit(2);
}

let pass = 0;
const failures = [];
const results = [];
console.log("Eval routes:", JSON.stringify(routes));
for (const c of cases) {
  try {
    const result = await runCase(c, env);
    const fails = await evalChecks(c, result, env);
    results.push({ id: c.id, route: result.route, pass: !fails.length, failures: fails });
    if (fails.length) {
      failures.push({ c, fails, result });
      console.log(`✗ ${c.id} — ${fails.join("; ")}`);
    } else {
      pass++;
      console.log(`✓ ${c.id}`);
    }
  } catch (err) {
    results.push({ id: c.id, pass: false, failures: [err.message] });
    failures.push({ c, fails: [`ERROR: ${err.message}`], result: null });
    console.log(`✗ ${c.id} — ERROR: ${err.message}`);
  }
}

console.log(`\n${pass}/${cases.length} passed.`);
if (env.EVAL_REPORT_PATH) writeFileSync(env.EVAL_REPORT_PATH, JSON.stringify({
  runAt: new Date().toISOString(), routes, pass, total: cases.length, results,
}, null, 2) + "\n");
if (failures.length) {
  console.log("\n── failures ──");
  for (const f of failures) {
    console.log(`\n${f.c.id}: ${f.fails.join("; ")}`);
    console.log(`  message: "${f.c.message}"`);
    if (f.result) console.log(`  route:   ${f.result.route}`);
    if (f.result) console.log(`  reply:   ${(f.result.reply || "(none)").replace(/\s+/g, " ").slice(0, 400)}`);
  }
  process.exit(1);
}
