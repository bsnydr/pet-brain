# The Telegram bot

A private Telegram interface over your own dog-care Markdown records. Netlify background functions,
zero npm dependencies. The public showcase uses fictional names and synthetic test fixtures;
create your real records in a private clone.

## Model roles
OpenAI Responses API is the default provider. Every message uses Luna (`gpt-6-luna`, reasoning `none`)
for save/routing decisions. Every real question uses Sol (`gpt-6.1-sol`, `low`) or, for substantive
health/behaviour/training questions, Astra (`gpt-6-astra`, `low`). The stronger model can read an
allowlisted redacted record and use hosted search for current external facts, toxicity and product
verification. Citations become visible URLs. Responses use `store: false`; tool loops preserve all
response items, including reasoning.

One `resolveAIRoute` function supplies production, maintenance and evals. Set `AI_PROVIDER` or
`AI_PROVIDER_TRIAGE/REPLY/EXPERT`; model overrides are `BOT_MODEL_*`, then `OPENAI_MODEL_*` or
`ANTHROPIC_MODEL_*`. `OPENAI_REASONING_*` overrides effort. An explicitly selected Anthropic route
can fall back to a funded OpenAI key. OpenAI has no automatic Anthropic fallback; optional
`AI_FALLBACK_PROVIDER` selects one. Refusals never trigger fallback. Legacy Anthropic pins require
current explicit overrides and evals before reuse. Check current official
[API documentation](https://developers.openai.com/api/docs/guides/function-calling) before changing
models, then evaluate; there is no automatic latest/best model selection.

## Messages and privacy
Observations and corrections become captures in `telegram-inbox.md`, with a filing hint and a 👍.
Questions receive record-grounded replies. Reminder/record change requests are saved for a filing
run/session; the bot cannot itself change records, schedules, code, appointments or send elsewhere.
Forwarded messages stay raw and quarantined for owner review. Voice notes use OpenAI transcription
(max 10 minutes), with a media placeholder on failure. A failed AI call preserves the raw capture;
questions and urgent observations receive a fixed saved/offline/call-vet reply. Unverified health or
product answers do not fall back to a cheap guess.

Only the configured group and allowlisted owner DMs are accepted. Replies support threads. Rolling
`bot-chatlog.md` memory is best-effort, capped to 80 lines and never used as the filing source.
Chip/passport/policy/tax/bank lookup reads `profile.md` deterministically and returns a value only to
the authorised chat, without sending it to a model or recording it in chatlog. Identifier redaction
and excluded profile sections apply to all model reads; adapt these to your records and country.
Never put real IDs or secrets in this public repository.

## Setup and deployment
In a private clone, create `profile.md`, `bot-reference.md`, `telegram-inbox.md`, `bot-chatlog.md`,
`vet-log.md`, `journal.md`, `weight-log.md` and `todos.md`; use `examples/` as a starting point.
Optional allowlisted files include behaviour/training/grooming notes, `research.md` and `insurance.md`.
Derive care facts from your own evidence. Missing dates must stay unknown.

Create a Telegram bot with BotFather, disable privacy for its group, add it as group admin, and set
these Netlify function environment variables:

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret matching webhook registration |
| `GITHUB_TOKEN` | Fine-grained Contents read/write token for the private records repo |
| `GITHUB_REPO`, `GITHUB_BRANCH` | Private owner/repo and branch (default `main`) |
| `ALLOWED_CHAT_ID`, `ALLOWED_USER_IDS` | Group and comma-separated authorised DM user ids |
| `OPENAI_API_KEY` | Funded OpenAI project key |
| `BOT_TIMEZONE` | IANA timezone, default `UTC` |

From `bot/`, link a Netlify site, set its secrets, then run:

```sh
npm test
netlify deploy --no-build
netlify deploy --prod --no-build
```

Register `https://YOUR-SITE.netlify.app/hook` through Telegram `setWebhook`, with the same secret and
`allowed_updates=["message"]`. Use a secret-aware client so tokens do not enter shell history/logs.
Background functions acknowledge immediately; throws trigger Netlify retries, with capture ids for
idempotency. Git-linked rebuilds ignore changes outside `bot/`.

## Optional reminders and maintenance
The reminder trigger defaults to 21:30 UTC. If changing `BOT_TIMEZONE`, adapt the UTC cron slots for
local time/DST. `/checkin` requires `x-petbot-secret`. A fenced `<!-- due-dates:begin -->` table in
`vet-log.md` has columns `item | due (YYYY-MM-DD) | note`, optionally `quiet-until` before `note`.
Templates remind three days before, on the day, then every three days overdue; snoozes resume on the
requested date. Duplicate rows merge with the latest snooze. Invalid dates are ignored. No AI calls,
day summaries or missing-log nudges. Successful chatlog markers suppress repeat invocations;
a crash between delivery and logging can still duplicate a reminder.

Public maintenance workflow templates are **manual only**. Enable schedules only in a private clone
with real records and a GitHub `OPENAI_API_KEY` secret. Daily filing uses Luna and skips an empty
inbox before any API call; weekly tidy uses Sol; monthly review uses Astra and remains manual.
The restricted runner exposes allowlisted reads/exact edits, with no shell, environment, arbitrary
paths, outside symlinks or messaging. Edits stay staged until completion. Removed captures require
`<!-- filed:tg:N -->` traceability; forwarded/unmarked captures remain for review. Monthly review
also has hosted search for current model documentation.

`npm test` is offline with synthetic fixtures. `npm run eval` calls the configured live API against
local private records. The manual eval Action compares up to three explicit model configurations and
uploads case reports without changing production. Usage depends on models, tokens and search calls;
inspect actual usage instead of assuming a fixed cost.
