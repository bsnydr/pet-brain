# The Telegram bot

A Netlify **background function** that turns a private Telegram group into the messaging interface for
your dog's markdown "brain". Text the group; each message runs through a **two-pass model ladder**:

- **Pass 1 — triage (every message, a cheap model like `claude-haiku-4-5`).** Decides whether it's worth
  saving (distils one line), whether it's a question to answer, and two routing flags — `needs_expertise`
  (a real health/behaviour/training question) and `needs_web` (needs a current external fact). It also
  tags the saved line with a filing hint. Most messages stop here — cheaper than sending every message
  to a big model.
- **Pass 2 — expert reply (only when it's a real health/behaviour question or one needing a live web
  fact).** A stronger model (`claude-opus-4-8` for expertise, `claude-sonnet-5` for web-only) running a
  **tool loop**: `fetch_repo_file` pulls a deeper record on demand (behaviour notes, the full journal),
  and `web_search` checks a current external fact with citations. Everything else uses Pass 1's reply.

Per-message outcome:

- **Observation** → distilled to one line + a filing hint (`[→ todo]` / `[→ vet-log due YYYY-MM-DD]`) and
  appended to `../telegram-inbox.md` (a Claude session, or the weekly tidy, files it into the records),
  and the bot reacts 👍. The tag is a hint — the bot never writes directly to the records (the inbox is
  the quarantine).
- **Question** → answered in-chat, grounded in the dog's records (and, for the hard ones, a cited source).
- **Chatter / test / side-talk** → ignored.

Media without text is captured as a placeholder; forwarded messages are tagged `[forwarded]` and
captured raw (never treated as an owner-asserted fact); if the AI is unavailable the raw message is
captured so nothing is lost. A guaranteed floor reply means a real question never meets silence.

- **Function:** [`functions/telegram-background.mjs`](functions/telegram-background.mjs) — zero
  dependencies (built-in `fetch`/`Buffer`).
- **Why a background function:** Telegram gets an instant `202` and the AI work runs async (15-min
  budget), so an LLM call can't blow the webhook timeout. The `-background` filename suffix is what
  makes it one — keep it.

## How it works

```
Telegram group ──POST /hook──▶ background fn ──(redacted records + message)──▶ Pass 1 · cheap triage
                   │ 202 now                     │                              save? reply? route?
                   │                             ├─ save  → telegram-inbox.md (GitHub API) + 👍
                   │                             │           (+ filing hint [→ todo] / [→ vet-log …])
                   │                             └─ reply ─┬─ trivial → Pass 1's answer
                   ▼                                       └─ expertise/web → Pass 2 · stronger model
              (the owners)  ◀──── reply / 👍 ──────────────────  tool loop: fetch_repo_file · web_search
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
| `ANTHROPIC_API_KEY` | Anthropic key for the AI brain (give it its **own** key with a monthly spend cap so a loop can't run up a bill) |
| `ANTHROPIC_MODEL_TRIAGE` / `_REPLY` / `_EXPERT` | *(optional)* override the ladder's models; default to `claude-haiku-4-5` / `claude-sonnet-5` / `claude-opus-4-8` |

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
- **Privacy:** `redact()` strips identifier numbers (and `+`-prefixed phone numbers) and
  `stripSections()` drops the profile's owner/contact/financial sections before anything is sent to the
  model — including files Pass 2 pulls on demand. `web_search` queries are prompt-guarded to never carry
  a name/contact. Redaction is best-effort — adapt the patterns to your country's ID formats, and never
  text raw secrets into the group.
- **`web_search` needs a capable model.** `web_search_20260209` (used in Pass 2) is a server-side tool
  on recent models; on older models use the basic `web_search_20250305` variant, or drop the tool.
