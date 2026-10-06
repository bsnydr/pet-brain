import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveAIRoute,
  redact, stripSections, truncateForContext, CONTEXT_FILES, FETCHABLE_FILES, PROFILE_STRIP_SECTIONS,
  askAI, askAIWithTools,
} from "../functions/lib/shared.mjs";
import {
  SYSTEM_PROMPT, REPLY_SYSTEM, DECISION_SCHEMA, FETCH_TOOL, WEB_SEARCH_TOOL, detectIdLookup, lookupId,
} from "../functions/telegram-background.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // bot/evals → repo root
const readRepo = (f) => { try { return readFileSync(join(REPO, f), "utf-8"); } catch { return ""; } };
export function buildLocalContext() {
  return CONTEXT_FILES.map(({ file, cap, strip, tail }) => {
    let text = readRepo(file);
    if (!text) return "";
    if (strip) text = stripSections(text, PROFILE_STRIP_SECTIONS);
    return `===== ${file} =====\n${truncateForContext(redact(text), cap, tail)}\n`;
  }).filter(Boolean).join("\n");
}
function localFetchRepoFileForTool(file, cap = 24000) {
  if (!FETCHABLE_FILES.includes(file)) return `Error: "${file}" is not available. Choose one of: ${FETCHABLE_FILES.join(", ")}.`;
  let text = readRepo(file);
  if (!text) return `(${file} unavailable)`;
  if (file === "profile.md") text = stripSections(text, PROFILE_STRIP_SECTIONS);
  return truncateForContext(redact(text), cap);
}

const NOW = "Monday 2026-01-05 10:00"; // current care phase; cases may set their own clock
async function retry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (!/\b(429|529|overloaded|rate.?limit)\b/i.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}
export async function runCase(c, env = process.env) {
  const context = buildLocalContext();
  const userContent =
    `Current date & time in the local timezone: ${c.now || NOW} (configured local timezone).\n\n` +
    `New message from ${c.from || "Test Owner"} (direct message):\n\n${redact(c.message)}`;
  const idKind = detectIdLookup(c.message);
  if (idKind) return { route: "id-lookup", decision: null, reply: lookupId(readRepo("profile.md"), idKind) };
  const d = await retry(() => askAI({
    ...resolveAIRoute(env, "triage"),
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: `Scout's records:\n\n${context}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userContent }],
    schema: DECISION_SCHEMA,
  }));
  let reply = d.should_reply ? (d.reply || "") : "";
  let route = d.should_reply ? "pass1" : "no-reply";
  const escalate = d.intent === "question" || d.needs_expertise || d.needs_web;
  if (d.should_reply && escalate) {
    const tools = d.needs_web ? [FETCH_TOOL, WEB_SEARCH_TOOL] : [FETCH_TOOL];
    const expert = await retry(() => askAIWithTools({
      ...resolveAIRoute(env, d.needs_expertise ? "expert" : "reply"),
      system: [
        { type: "text", text: REPLY_SYSTEM },
        { type: "text", text: `Scout's records:\n\n${context}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userContent }],
      tools,
      executeTool: (name, input) => (name === "fetch_repo_file" ? localFetchRepoFileForTool(input.file) : `Error: unknown tool ${name}`),
    }));
    if (expert && expert.trim()) { reply = expert.trim(); route = "pass2"; }
  }
  return { route, decision: d, reply };
}
const JUDGE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { pass: { type: "boolean" }, reason: { type: "string" } },
  required: ["pass", "reason"],
};
export async function judge(reply, rubric, env = process.env) {
  return retry(() => askAI({
    ...resolveAIRoute(env, "reply"),
    system: [{ type: "text", text: "You strictly evaluate a dog-care assistant's reply against a rubric. Return pass=true ONLY if the reply clearly satisfies the rubric; otherwise pass=false with a one-line reason. Be strict but fair." }],
    messages: [{ role: "user", content: `RUBRIC: ${rubric}\n\nREPLY:\n${reply || "(no reply)"}` }],
    schema: JUDGE_SCHEMA, maxTokens: 4500,
  }));
}
export async function evalChecks(c, result, env) {
  const fails = [];
  const reply = (result.reply || "").toLowerCase();
  for (const chk of c.checks) {
    if (chk.route && result.route !== chk.route) fails.push(`route ${result.route} ≠ ${chk.route}`);
    else if (chk.routeNot && result.route === chk.routeNot) fails.push(`route must not be ${chk.routeNot}`);
    else if (chk.decision) {
      const v = result.decision?.[chk.decision.field];
      if (v !== chk.decision.equals) fails.push(`decision.${chk.decision.field}=${v} ≠ ${chk.decision.equals}`);
    } else if (chk.includesAny) {
      if (!chk.includesAny.some((s) => reply.includes(s.toLowerCase()))) fails.push(`reply missing any of [${chk.includesAny.join(", ")}]`);
    } else if (chk.excludesAll) {
      const hit = chk.excludesAll.find((s) => reply.includes(s.toLowerCase()));
      if (hit) fails.push(`reply contains forbidden "${hit}"`);
    } else if (chk.judge) {
      const j = await judge(result.reply, chk.judge, env);
      if (!j.pass) fails.push(`judge: ${j.reason}`);
    }
  }
  return fails;
}
