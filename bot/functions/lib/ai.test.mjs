import { test } from "node:test";
import assert from "node:assert/strict";
import { askOpenAI, askOpenAIWithTools, askAIWithTools, resolveAIRoute, targetTag, OPENAI_API } from "./shared.mjs";
import telegram, { FETCH_TOOL, WEB_SEARCH_TOOL, wantsOfflineReply } from "../telegram-background.mjs";
import { parseDueDates } from "../checkin-background.mjs";

const response = (output, more = {}) => ({ ok: true, json: async () => ({ status: "completed", output, ...more }) });
const textOutput = (text) => [{ type: "message", content: [{ type: "output_text", text, annotations: [] }] }];

test("OpenAI structured output honours the schema and disables stored responses", async () => {
  const schema = { type: "object", properties: { save: { type: "boolean" } }, required: ["save"], additionalProperties: false };
  const got = await askOpenAI({ provider: "openai", apiKey: "synthetic", model: "gpt-6-luna", reasoningEffort: "none",
    schema, system: [{ type: "text", text: "system" }], messages: [{ role: "user", content: "input" }],
    fetchImpl: async (url, opts) => {
      assert.equal(url, OPENAI_API);
      const body = JSON.parse(opts.body);
      assert.equal(body.store, false);
      assert.equal(body.provider, undefined);
      assert.equal(body.fallback, undefined);
      assert.equal(body.instructions, "system");
      assert.deepEqual(body.text.format.schema, schema);
      assert.deepEqual(body.reasoning, { effort: "none" });
      return response(textOutput('{"save":true}'));
    } });
  assert.deepEqual(got, { save: true });
});

test("Responses tool loop preserves reasoning, maps both tools and includes verified URLs", async () => {
  let calls = 0;
  const reasoning = { type: "reasoning", id: "r", summary: [] };
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.store, false);
    assert.equal(body.tools[0].type, "function");
    assert.equal(body.tools[0].strict, true);
    assert.equal(body.tools[1].type, "web_search");
    if (calls++ === 0) return response([reasoning, { type: "function_call", name: "fetch_repo_file", call_id: "c", arguments: '{"file":"vet-log.md"}' }]);
    assert.ok(body.input.some(x => x.type === "reasoning" && x.id === "r"));
    assert.deepEqual(body.input.at(-1), { type: "function_call_output", call_id: "c", output: "safe synthetic record" });
    return response([{ type: "message", content: [{ type: "output_text", text: "Call the vet.",
      annotations: [{ type: "url_citation", url: "https://example.org/vet" }] }] }]);
  };
  const reply = await askOpenAIWithTools({ apiKey: "synthetic", model: "gpt-6-astra", system: [],
    messages: [{ role: "user", content: "question" }], tools: [FETCH_TOOL, WEB_SEARCH_TOOL], fetchImpl,
    executeTool: async (name, args) => { assert.equal(name, "fetch_repo_file"); assert.equal(args.file, "vet-log.md"); return "safe synthetic record"; } });
  assert.match(reply, /https:\/\/example.org\/vet/);
  assert.equal(calls, 2);
});

test("Incomplete, refused and empty Responses are never treated as answers", async () => {
  for (const [reply, pattern] of [
    [response([], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), /incomplete/],
    [response([{ content: [{ type: "refusal", refusal: "no" }] }]), /refusal/],
    [response([]), /no text/],
  ]) await assert.rejects(askOpenAIWithTools({ apiKey: "synthetic", model: "m", system: [], messages: [], fetchImpl: async () => reply }), pattern);
});

test("Provider fallback recovers an exhausted API without overriding a safety refusal", async () => {
  let calls = 0;
  const args = { provider: "openai", apiKey: "synthetic", model: "m", system: [], messages: [],
    fallback: { provider: "openai", apiKey: "other-synthetic", model: "fallback" },
    fetchImpl: async () => ++calls === 1 ? { ok: false, status: 429, json: async () => ({ error: { code: "insufficient_quota" } }) } : response(textOutput("Recovered")) };
  assert.equal(await askAIWithTools(args), "Recovered");
  assert.equal(calls, 2);
  calls = 0;
  args.fetchImpl = async () => { calls++; return response([{ content: [{ type: "refusal" }] }]); };
  await assert.rejects(askAIWithTools(args), /refusal/);
  assert.equal(calls, 1);
});

test("Production/evals resolve identical role overrides, and OpenAI avoids the exhausted provider", () => {
  const env = { OPENAI_API_KEY: "synthetic", ANTHROPIC_API_KEY: "old", OPENAI_MODEL_EXPERT: "candidate", OPENAI_REASONING_EXPERT: "medium" };
  assert.equal(resolveAIRoute(env, "triage").provider, "openai");
  assert.equal(resolveAIRoute(env, "expert").model, "candidate");
  assert.equal(resolveAIRoute(env, "expert").reasoningEffort, "medium");
  assert.equal(resolveAIRoute(env, "expert").fallback, undefined);
  assert.equal(resolveAIRoute({ ...env, AI_PROVIDER: "anthropic" }, "expert").fallback.model, "candidate");
  assert.equal(targetTag("correction"), " [→ correction]");
});

test("Reminder dedupe respects a duplicate snooze and resumes without a two-day delay", () => {
  const md = '<!-- due-dates:begin -->\n| Deworming | 2026-10-01 | old |\n| deworming | 2026-10-01 | 2026-10-06 | snoozed |\n<!-- due-dates:end -->';
  assert.deepEqual(parseDueDates(md, "2026-10-05", { cadence: true }), []);
  assert.equal(parseDueDates(md, "2026-10-06", { cadence: true }).length, 1);
  assert.equal(parseDueDates(md, "2026-10-07", { cadence: true }).length, 0);
  assert.equal(parseDueDates(md, "2026-10-09", { cadence: true }).length, 1);
  assert.deepEqual(parseDueDates(md.replaceAll("2026-10-01", "2026-02-30"), "2026-10-06"), []);
});

test("Offline questions and urgent observations get an explicit saved/call-vet reply", async () => {
  assert.equal(wantsOfflineReply("she ate a grape"), true);
  assert.equal(wantsOfflineReply("how do we help her"), true);
  assert.equal(wantsOfflineReply("she pooed outside"), false);
  const originalEnv = process.env, originalFetch = globalThis.fetch;
  const operations = [];
  let inbox = "# inbox\n";
  process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: "synthetic", TELEGRAM_WEBHOOK_SECRET: "test",
    ALLOWED_CHAT_ID: "1", GITHUB_REPO: "synthetic/repo", GITHUB_TOKEN: "synthetic", AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic" };
  globalThis.fetch = async (url, opts = {}) => {
    if (url === OPENAI_API) return { ok: false, status: 429, json: async () => ({ error: { code: "insufficient_quota" } }) };
    if (url.includes("/contents/telegram-inbox.md") && opts.method === "PUT") {
      operations.push("save"); inbox = Buffer.from(JSON.parse(opts.body).content, "base64").toString(); return { ok: true };
    }
    if (url.includes("/contents/telegram-inbox.md")) return { ok: true, status: 200, text: async () => inbox,
      json: async () => ({ sha: "s", content: Buffer.from(inbox).toString("base64") }) };
    if (url.startsWith("https://api.github.com/")) return { ok: true, text: async () => "synthetic context" };
    if (url.endsWith("/sendMessage")) {
      operations.push("reply"); const body = JSON.parse(opts.body); assert.match(body.text, /offline/); assert.match(body.text, /saved/); assert.match(body.text, /vet/);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url.endsWith("/setMessageReaction")) return { ok: true, json: async () => ({ ok: true }) };
    throw new Error("Unexpected request");
  };
  try {
    const update = { update_id: 1, message: { text: "she ate a grape", date: 1791270000, chat: { id: 1 }, from: { first_name: "Test" }, message_id: 1 } };
    const request = () => new Request("https://example.org/hook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "test" }, body: JSON.stringify(update) });
    await telegram(request()); await telegram(request());
    assert.deepEqual(operations, ["save", "reply"]);
    assert.match(inbox, /\[AI unavailable\]/);
  } finally { process.env = originalEnv; globalThis.fetch = originalFetch; }
});
