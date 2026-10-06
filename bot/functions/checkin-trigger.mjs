
import { localNow } from "./lib/shared.mjs";

export const config = { schedule: "30 21 * * *" };

export default async () => {
  const now = localNow();
  if (now.hour !== 21) return new Response(`skip (local hour ${now.hour})`, { status: 200 });

  const base = process.env.URL || "https://example-pet-bot.netlify.app";
  const res = await fetch(`${base}/checkin`, {
    method: "POST",
    headers: { "x-petbot-secret": process.env.TELEGRAM_WEBHOOK_SECRET || "" },
    signal: AbortSignal.timeout(10000),
  });
  console.log(`check-in fired: ${res.status}`);
  return new Response(`fired: ${res.status}`, { status: 200 });
};
