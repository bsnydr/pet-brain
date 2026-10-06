import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, hasCaptures, runAutomation } from "./run.mjs";

const fixture = (fn) => {
  const root = mkdtempSync(join(tmpdir(), "pet-maintenance-test-"));
  try { return fn(root); } finally { rmSync(root, { recursive: true }); }
};
test("Daily maintenance skips an empty inbox before touching the API", async () => {
  const root = mkdtempSync(join(tmpdir(), "pet-maintenance-test-"));
  try {
    writeFileSync(join(root, "telegram-inbox.md"), "# inbox\n\n> header\n");
    assert.equal(hasCaptures("# inbox\n- 2026-10-06 12:00 (Test): walk <!-- tg:1 -->"), true);
    assert.deepEqual(await runAutomation("daily", { root, ask: async () => { throw new Error("API must not run"); } }), []);
  } finally { rmSync(root, { recursive: true }); }
});
test("Maintenance rejects arbitrary paths, code writes, identifiers and symlink escapes", () => fixture(root => {
  writeFileSync(join(root, "journal.md"), "# journal\nentry");
  const ws = createWorkspace(root, "daily");
  assert.throws(() => ws.read("../.env"), /not available/);
  assert.throws(() => ws.edit("bot/functions/lib/shared.mjs", "old", "new"), /cannot edit/);
  assert.throws(() => ws.edit("journal.md", "entry", "chip 111222333444555"), /Identifiers/);
  const outside = mkdtempSync(join(tmpdir(), "pet-outside-"));
  try { writeFileSync(join(outside, "secret"), "secret"); symlinkSync(join(outside, "secret"), join(root, "vet-log.md"));
    assert.throws(() => ws.read("vet-log.md"), /outside/); }
  finally { rmSync(outside, { recursive: true }); }
}));
test("Edits remain staged until completion and a removed capture requires a filed marker", () => fixture(root => {
  const capture = "- 2026-10-06 12:00 (Test): walk <!-- tg:1 -->";
  for (const f of ["journal.md", "weight-log.md", "vet-log.md", "todos.md"]) writeFileSync(join(root, f), "# record\n");
  writeFileSync(join(root, "telegram-inbox.md"), `# inbox\n${capture}\n`);
  const ws = createWorkspace(root, "daily");
  ws.edit("telegram-inbox.md", capture + "\n", "");
  assert.ok(readFileSync(join(root, "telegram-inbox.md"), "utf8").includes(capture));
  assert.throws(() => ws.commit(), /lacks a filed marker/);
  ws.edit("journal.md", "# record", "# record\n- 2026-10-06 walk <!-- filed:tg:1 -->");
  assert.equal(ws.commit().length, 2);
  assert.ok(!readFileSync(join(root, "telegram-inbox.md"), "utf8").includes(capture));
}));
