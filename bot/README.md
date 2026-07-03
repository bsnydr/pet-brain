# The Telegram bot

A Netlify **background function** that turns a private Telegram group into the messaging interface for
your dog's markdown "brain". Text the group; for each message an LLM decides whether it's worth saving
and whether it's a question to answer:

- **Observation** → distilled to one line and appended to `../telegram-inbox.md` (a Claude session, or
  the weekly tidy, files it into the records), and the bot reacts 👍.
- **Question** → answered in-chat, grounded in the dog's records.
- **Chatter / test / side-talk** → ignored.

Media without text is captured as a placeholder; forwarded messages are tagged `[forwarded]` and
captured raw (never treated as an owner-asserted fact); if the AI is unavailable the raw message is
captured so nothing is lost.

- **Function:** [`functions/telegram-background.mjs`](functions/telegram-background.mjs) — zero
  dependencies (built-in `fetch`/`Buffer`).
- **Why a background function:** Telegram gets an instant `202` and the AI work runs async (15-min
  budget), so an LLM call can't blow the webhook timeout. The `-background` filename suffix is what
  makes it one — keep it.

## How it works

```
Telegram group ──POST /hook──▶ background fn ──(redacted records + message)──▶ Claude Messages API
                   │ 202 now                     │
                   │                    decision: save? / reply?
                   ▼                              ├─ save  → telegram-inbox.md (GitHub API) + 👍
              (the owners)  ◀── reply / 👍 ───────┴─ reply → sendMessage
```

## Environment variables (set in Netlify — never commit these)

| Var | What |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token for your bot |
| `TELEGRAM_WEBHOOK_SECRET` | random string; must match the `secret_token` given to `setWebhook` |
| `GITHUB_TOKEN` | fine-grained PAT scoped to your records repo, **Contents: read/write** |
| `GITHUB_REPO` | `you/your-repo` · `GITHUB_BRANCH` | `main` (optional) |
| `ALLOWED_CHAT_ID` | your group's chat id (`-100…` for a supergroup) — every other chat is ignored |
| `ALLOWED_USER_IDS` | *(optional)* comma-separated Telegram user ids allowed to DM the bot 1:1, e.g. `111,222` — so owners can also message it privately, not just in the group. Everyone else is still ignored. |
| `ANTHROPIC_API_KEY` | Anthropic key for the AI brain · `ANTHROPIC_MODEL` | optional, defaults to `claude-sonnet-5` |

Set one: `netlify env:set NAME value` from this `bot/` dir. Leading-dash values (the chat id) need
`netlify env:set ALLOWED_CHAT_ID -- -100…`.

## Setup (once)

1. **Create the bot** in Telegram via `@BotFather` → `/newbot`; note the token. Then `@BotFather` →
   `/setprivacy` → **Disable** (so it reads all group messages).
2. **Create the group**, add the bot, and make it an **admin** (needed for the 👍 reaction and to read
   all messages). Send a message so it registers.
3. **Fine-grained GitHub PAT** scoped to your records repo, **Contents: read/write**.
4. **Anthropic API key** (console.anthropic.com → add a little credit → create key).
5. **Deploy** (below), **set the env vars**, then **register the webhook** (below).

## Deploy / redeploy

From this `bot/` directory:

```bash
netlify sites:create --account-slug <you>   # first time only, then set the env vars above
netlify deploy --prod
```

Confirm it's a **background** function: `curl -X POST https://<your-site>.netlify.app/hook
-H "x-telegram-bot-api-secret-token: <secret>" -d '{}' -w "%{http_code} %{time_total}"` should return
**202** in well under a second (a synchronous 200 that takes seconds means the `-background` suffix was lost).

## Register the Telegram webhook

Served only at `/hook`:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-site>.netlify.app/hook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" -d 'allowed_updates=["message"]'
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"   # url ends in /hook, last_error_message empty
```

## Gotchas

- **Background retries on THROW only.** Netlify re-invokes (1m, 2m) on an unhandled exception, not on a
  returned 5xx — so save-failure paths `throw`; the `<!-- tg:N -->` marker keeps retries idempotent.
- **`/hook` only** (custom `config.path`); the default `/.netlify/functions/…` URL 404s.
- **Group-id changes** (basic→supergroup migration) change `ALLOWED_CHAT_ID` → the bot silently ignores
  everything until you update it.
- **Set the timezone** in `formatStamp` (defaults to UTC).
- **Inbox > 1 MB** would break the append (GitHub Contents API limit). Unlikely if sessions clear it
  regularly; prune the inbox if captures ever pile up.
- **Privacy:** `redact()` strips identifier numbers and `stripSections()` drops the profile's
  owner/contact/financial sections before anything is sent to the model. Redaction is best-effort —
  adapt the patterns to your country's ID formats, and never text raw secrets into the group.
