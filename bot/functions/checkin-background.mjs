import { oneLine, localNow, fetchRepoFile, appendToChatLog, tgSend, CHATLOG_PATH } from "./lib/shared.mjs";

export const config = { path: "/checkin", background: true };

export default async (req) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, GITHUB_TOKEN, GITHUB_REPO,
    GITHUB_BRANCH = "main", ALLOWED_CHAT_ID } = process.env;
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (!TELEGRAM_WEBHOOK_SECRET || req.headers.get("x-petbot-secret") !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const gh = { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH };
  const today = localNow();
  const marker = `<!-- checkin:${today.iso} -->`;
  const flags = parseDueDates(await fetchRepoFile(gh, "vet-log.md"), today.iso, { cadence: true });
  if (!flags.length) return new Response("no reminders today", { status: 200 });
  const chatlog = await fetchRepoFile(gh, CHATLOG_PATH);
  if (chatlog.includes(marker)) return new Response("already reminded today", { status: 200 });
  const message = templateCheckin(flags);
  await tgSend({ token: TELEGRAM_BOT_TOKEN, chatId: ALLOWED_CHAT_ID, text: message });
  try {
    await appendToChatLog({ ...gh, marker,
      lines: [`- ${today.iso} ${today.time} (petbot): [vet reminder] ${oneLine(message, 1500)} ${marker}`] });
  } catch (err) { console.error("reminder memory write failed:", err); }
  return new Response("ok", { status: 200 });
};
export function parseDueDates(vetLog, todayIso, { cadence = false } = {}) {
  const table = vetLog.match(/<!--\s*due-dates:begin[\s\S]*?-->([\s\S]*?)<!--\s*due-dates:end\s*-->/);
  if (!table) { console.error("no due-dates table found in vet-log.md"); return []; }
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
  if (!validDate(todayIso)) return [];
  const daysUntil = (s) => Math.round((Date.parse(`${s}T12:00:00Z`) - Date.parse(`${todayIso}T12:00:00Z`)) / 86400000);
  const rows = new Map();
  for (const line of table[1].split("\n")) {
    const cells = line.split("|").map((s) => s.trim());
    if (cells[0] === "") cells.shift();
    if (cells.at(-1) === "") cells.pop();
    const [item, due] = cells;
    if (!item || !validDate(due)) continue;
    const snoozed = validDate(cells[2]);
    const quietUntil = snoozed ? cells[2] : "";
    const note = cells.slice(snoozed ? 3 : 2).join(" | ");
    const key = `${item.toLowerCase().replace(/\s+/g, " ")}|${due}`;
    const previous = rows.get(key);
    if (!previous || quietUntil > previous.quietUntil) rows.set(key, { item, due, quietUntil, note });
  }
  const flags = [];
  for (const { item, due, quietUntil, note } of rows.values()) {
    if (quietUntil && daysUntil(quietUntil) > 0) continue;
    const days = daysUntil(due);
    const anchor = quietUntil > due ? quietUntil : due;
    const resuming = quietUntil === todayIso && days <= 7;
    if (cadence && !(days === 3 || days === 0 || resuming || (days < 0 && -daysUntil(anchor) % 3 === 0))) continue;
    const suffix = note ? ` — ${note}` : "";
    if (days < 0) flags.push(`OVERDUE by ${-days} day${days === -1 ? "" : "s"}: ${item} (was due ${due})${suffix}`);
    else if (days === 0) flags.push(`DUE TODAY: ${item}${suffix}`);
    else if (days <= 7) flags.push(`Due in ${days} day${days === 1 ? "" : "s"} (${due}): ${item}${suffix}`);
  }
  return flags;
}

export function templateCheckin(flags) {
  return `🐾 Scout reminder:\n⚠️ ${flags.join("\n⚠️ ")}\n\nTell me if it's done or when you'd prefer a reminder. I'll save that for the next filing run.`;
}
