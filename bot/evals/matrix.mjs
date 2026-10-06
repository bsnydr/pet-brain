import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const configs = JSON.parse(process.env.EVAL_CONFIGS || "[]");
if (!Array.isArray(configs) || configs.length > 3) throw new Error("Choose at most three candidate configs");
const runs = configs.length ? configs : [{ triage: process.env.OPENAI_MODEL_TRIAGE, reply: process.env.OPENAI_MODEL_REPLY, expert: process.env.OPENAI_MODEL_EXPERT }];
const outputDir = resolve(process.env.EVAL_OUTPUT_DIR || "eval-results");
mkdirSync(outputDir, { recursive: true });
let failed = false;
for (let i = 0; i < runs.length; i++) {
  const config = runs[i];
  const env = { ...process.env, EVAL_REPORT_PATH: resolve(outputDir, `config-${i + 1}.json`) };
  for (const role of ["triage", "reply", "expert"]) {
    const model = config[role];
    if (!model) continue;
    if (typeof model !== "string" || !/^gpt-[a-z0-9.-]+$/.test(model)) throw new Error("Invalid OpenAI model id");
    env[`OPENAI_MODEL_${role.toUpperCase()}`] = model;
  }
  console.log(`Candidate ${i + 1}:`, JSON.stringify(config));
  const result = spawnSync(process.execPath, [resolve(here, "run.mjs")], { env, stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
