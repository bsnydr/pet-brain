
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redact, stripSections, truncateForContext, localNow,
  targetTag, fetchRepoFileForTool, askClaudeWithTools, FETCHABLE_FILES,
  buildChatLogBody, CHATLOG_HEADER,
} from "./shared.mjs";
import { parseDueDates } from "../checkin-background.mjs";
import { detectIdLookup, lookupId } from "../telegram-background.mjs";

test("redact strips numeric IDs, NIE/NIF, passport, IBAN", () => {
  assert.equal(redact("chip 123456789012345 here"), "chip [id] here");
  assert.equal(redact("NIE Y1234567X done"), "NIE [id] done");
  const p = redact("passport XX SN 99887766 x");
  assert.ok(!/\d/.test(p), `digits should be redacted: ${p}`);
  assert.match(redact("acct ES91 2100 0418 4502 0005 1332 end"), /\[iban\]/);
});

test("redact handles a passport number with no long digit run via the SN rule", () => {
  assert.equal(redact("id AB SN 12A34 done"), "id [id] done");
});

test("redact leaves ISO dates and short numbers alone", () => {
  assert.equal(redact("on 2026-07-03 she weighed 7.5 kg"), "on 2026-07-03 she weighed 7.5 kg");
  assert.equal(redact("pee at 8:15, poo 9:40"), "pee at 8:15, poo 9:40");
});

test("redact strips a +international phone whole (not just its last group), dates survive", () => {
  assert.equal(redact("trainer +44 7478 225641 call"), "trainer [phone] call");
  assert.equal(redact("weighed 7.5 kg on 2026-07-03 at 8:15"), "weighed 7.5 kg on 2026-07-03 at 8:15");
});

test("stripSections drops matching ## sections whole", () => {
  const md = "# T\n\n## People\nsecret owner\n\n## Health\nkeep this\n";
  const out = stripSections(md, ["People"]);
  assert.ok(!out.includes("secret owner"));
  assert.ok(out.includes("keep this"));
});

test("truncateForContext (head) cuts at a newline and marks it", () => {
  const text = "line one\nline two\nline three\n";
  const out = truncateForContext(text, 12, false);
  assert.ok(out.startsWith("line one"));
  assert.ok(out.includes("truncated"));
  assert.ok(!out.includes("line three"));
});

test("truncateForContext (tail) keeps the newest lines", () => {
  const text = "old\nmid\nnewest line here\n";
  const out = truncateForContext(text, 18, true);
  assert.ok(out.includes("newest line here"));
  assert.ok(out.includes("truncated"));
});

test("truncateForContext returns text unchanged when under cap", () => {
  assert.equal(truncateForContext("short", 100, false), "short");
});

test("parseDueDates flags overdue and near-due, ignores header/separator/future", () => {
  const vetLog = [
    "## Upcoming",
    "<!-- due-dates:begin — machine read, keep YYYY-MM-DD -->",
    "",
    "| item | due | note |",
    "|---|---|---|",
    "| Deworming | 2026-06-22 | with food |",
    "| Cerenia trial | 2026-07-05 | before the drive |",
    "| Booster | 2026-09-01 | far off |",
    "",
    "<!-- due-dates:end -->",
  ].join("\n");
  const flags = parseDueDates(vetLog, "2026-07-03");
  assert.equal(flags.length, 2, `expected 2 flags, got ${flags.length}: ${JSON.stringify(flags)}`);
  assert.match(flags[0], /OVERDUE by 11 days: Deworming/);
  assert.match(flags[0], /with food/);
  assert.match(flags[1], /Due in 2 days .*Cerenia trial/);
  assert.ok(!flags.some((f) => /Booster/.test(f)), "future item should not flag");
  assert.ok(!flags.some((f) => /item|---/.test(f)), "header/separator must be skipped");
});

test("parseDueDates: DUE TODAY wording", () => {
  const md = "<!-- due-dates:begin -->\n| x | 2026-07-03 | now |\n<!-- due-dates:end -->";
  const flags = parseDueDates(md, "2026-07-03");
  assert.equal(flags.length, 1);
  assert.match(flags[0], /DUE TODAY: x/);
});

test("parseDueDates cadence: 3 days before, on the day, then every 3 days overdue — silent otherwise", () => {
  const md = "<!-- due-dates:begin -->\n| Deworming | 2026-10-19 | monthly |\n<!-- due-dates:end -->";
  const fires = (d) => parseDueDates(md, d, { cadence: true }).length === 1;
  assert.deepEqual(
    ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23"].map(fires),
    [false, true, false, true, false, true, false],
  );
  assert.equal(parseDueDates(md, "2026-10-17").length, 1); // without cadence: unchanged ≤7-day behaviour
});

test("parseDueDates: no table → empty (never throws)", () => {
  assert.deepEqual(parseDueDates("# vet log with no table", "2026-07-03"), []);
});

test("parseDueDates: a quiet-until snoozes the row until that date, then it flags again", () => {
  const md = [
    "<!-- due-dates:begin -->",
    "| item | due | quiet-until | note |",
    "|---|---|---|---|",
    "| Deworming | 2026-06-22 | 2026-07-30 | scheduled, remind ~30 Jul |",
    "<!-- due-dates:end -->",
  ].join("\n");
  assert.deepEqual(parseDueDates(md, "2026-07-20"), []);
  assert.deepEqual(parseDueDates(md, "2026-07-29"), []);
  const on = parseDueDates(md, "2026-07-30");
  assert.equal(on.length, 1, JSON.stringify(on));
  assert.match(on[0], /OVERDUE by 38 days: Deworming/);
  assert.match(on[0], /scheduled, remind ~30 Jul/);
  assert.match(parseDueDates(md, "2026-08-01")[0], /OVERDUE by 40 days: Deworming/);
});

test("parseDueDates: a note that merely starts with a date is NOT treated as quiet-until", () => {
  const md = "<!-- due-dates:begin -->\n| Booster | 2026-07-03 | 2026-07-03 was the last shot |\n<!-- due-dates:end -->";
  const flags = parseDueDates(md, "2026-07-03");
  assert.equal(flags.length, 1);
  assert.match(flags[0], /DUE TODAY: Booster/);
  assert.match(flags[0], /2026-07-03 was the last shot/); // the whole cell is the note, not a snooze
});

test("targetTag maps routing hints (journal → none, others → tag)", () => {
  assert.equal(targetTag("journal"), "");
  assert.equal(targetTag(undefined), "");
  assert.equal(targetTag("todo"), " [→ todo]");
  assert.equal(targetTag("weight"), " [→ weight-log]");
  assert.equal(targetTag("vet-log", "2026-08-01"), " [→ vet-log due 2026-08-01]");
  assert.equal(targetTag("vet-log"), " [→ vet-log]"); // no/invalid date → bare tag
  assert.equal(targetTag("vet-log", "soon"), " [→ vet-log]");
});

test("fetchRepoFileForTool rejects anything off the allowlist without fetching", async () => {
  const out = await fetchRepoFileForTool({}, "../.env");
  assert.match(out, /not an available file/);
  assert.ok(FETCHABLE_FILES.includes("behaviour-notes.md"));
  assert.ok(!FETCHABLE_FILES.includes("bot-reference.md")); // already in the default slice
});

test("askClaudeWithTools drives a client-tool loop then returns final text", async () => {
  const calls = [];
  const fakeFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.messages.length);
    if (calls.length === 1) {
      return { ok: true, json: async () => ({
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "tu_1", name: "fetch_repo_file", input: { file: "vet-log.md" } },
        ],
      }) };
    }
    return { ok: true, json: async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Deworming was due 22 Jun." }],
    }) };
  };
  let executedWith;
  const text = await askClaudeWithTools({
    apiKey: "k", model: "m", system: [], tools: [],
    messages: [{ role: "user", content: "when was deworming due?" }],
    executeTool: async (name, input) => { executedWith = { name, input }; return "due 2026-06-22"; },
    fetchImpl: fakeFetch,
  });
  assert.equal(text, "Deworming was due 22 Jun.");
  assert.deepEqual(executedWith, { name: "fetch_repo_file", input: { file: "vet-log.md" } });
  assert.equal(calls.length, 2); // one tool round-trip, then the answer
});

test("askClaudeWithTools continues on pause_turn (server-tool cap)", async () => {
  let n = 0;
  const fakeFetch = async () => {
    n++;
    if (n === 1) return { ok: true, json: async () => ({ stop_reason: "pause_turn", content: [{ type: "text", text: "searching…" }] }) };
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Xylitol is highly toxic to dogs." }] }) };
  };
  const text = await askClaudeWithTools({
    apiKey: "k", model: "m", system: [], tools: [],
    messages: [{ role: "user", content: "is xylitol toxic?" }],
    executeTool: async () => "unused", fetchImpl: fakeFetch,
  });
  assert.equal(text, "Xylitol is highly toxic to dogs.");
  assert.equal(n, 2);
});

test("askClaudeWithTools throws on a safety refusal", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  await assert.rejects(
    askClaudeWithTools({ apiKey: "k", model: "m", system: [], tools: [], messages: [], executeTool: async () => "", fetchImpl: fakeFetch }),
    /refusal/,
  );
});

test("buildChatLogBody appends under the canonical header and keeps only capture lines", () => {
  const existing = `${CHATLOG_HEADER}\n- 2026-07-07 10:53 (Owner A): old line <!-- tg:1 -->\n`;
  const out = buildChatLogBody(existing, ["- 2026-07-07 10:58 (petbot): a reply"]);
  assert.ok(out.startsWith(CHATLOG_HEADER));
  assert.ok(out.includes("old line"));
  assert.ok(out.endsWith("- 2026-07-07 10:58 (petbot): a reply\n"));
  assert.equal(out.split("# Bot chat log").length, 2);
});

test("buildChatLogBody trims to the newest maxLines and self-heals a mangled file", () => {
  const existing = ["stray prose that is not a capture line"]
    .concat(Array.from({ length: 10 }, (_, i) => `- line ${i}`)).join("\n");
  const out = buildChatLogBody(existing, ["- line new"], 5);
  assert.ok(!out.includes("stray prose"), "non-list lines are dropped (header is re-added canonically)");
  const list = out.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(list.length, 5);
  assert.equal(list.at(-1), "- line new");
  assert.equal(list[0], "- line 6"); // 10 old + 1 new, keep newest 5 → lines 6–9 + new
});

test("buildChatLogBody starts a fresh file from empty", () => {
  const out = buildChatLogBody("", ["- 2026-07-07 10:53 (Owner A): first <!-- tg:9 -->"]);
  assert.ok(out.startsWith(CHATLOG_HEADER));
  assert.ok(out.trimEnd().endsWith("<!-- tg:9 -->"));
});

test("localNow returns well-formed parts", () => {
  const n = localNow(1751566500); // fixed unix ts → deterministic
  assert.match(n.iso, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(n.time, /^\d{2}:\d{2}$/);
  assert.ok(n.hour >= 0 && n.hour <= 23);
  assert.equal(typeof n.weekday, "string");
});


const FAKE_PROFILE = `# Scout — Key Facts
## Official IDs
- **Microchip:** **111222333444555** (implanted 01/01/2026)
- **EU pet passport:** **XX SN 99887766** — issued 01/01/2026
## People
- **Owner B** — ... NIF **Z1234567X**. 
## Insurance — Example Insurer
| Policy no. | **987654321** |
| Direct debit | Banco Test, IBAN ES**…0000 |
`;

test("detectIdLookup classifies ID requests and ignores passing/topical mentions", () => {
  assert.equal(detectIdLookup("what's her chip number?"), "microchip");
  assert.equal(detectIdLookup("remind me of her microchip"), "microchip");
  assert.equal(detectIdLookup("her passport number?"), "passport");
  assert.equal(detectIdLookup("what is the insurance policy number"), "insurance policy");
  assert.equal(detectIdLookup("can you give me the IBAN?"), "IBAN");
  assert.equal(detectIdLookup("what's Owner B's NIF?"), "NIF");
  assert.equal(detectIdLookup("does the policy cover another country?"), null);
  assert.equal(detectIdLookup("can she eat a chip?"), null);
  assert.equal(detectIdLookup("remind me to bring her passport"), null);
  assert.equal(detectIdLookup("what documents for the NIE appointment?"), null);
  assert.equal(detectIdLookup("we should photograph the passport page"), null);
  assert.equal(detectIdLookup("how was her day today?"), null);
  assert.equal(detectIdLookup("she peed at 9:40"), null);
});

test("lookupId extracts each ID from the synthetic profile", () => {
  assert.equal(lookupId(FAKE_PROFILE, "microchip"), "Her microchip number is 111222333444555.");
  assert.equal(lookupId(FAKE_PROFILE, "passport"), "Her EU pet passport number is XX SN 99887766.");
  assert.equal(lookupId(FAKE_PROFILE, "insurance policy"), "Her Example Insurer insurance policy number is 987654321.");
  assert.match(lookupId(FAKE_PROFILE, "IBAN"), /ES\*\*…0000/);
  assert.equal(lookupId(FAKE_PROFILE, "NIF"), "The NIF on file (Owner B's) is Z1234567X.");
  assert.equal(lookupId("no ids here", "microchip"), "");
});
