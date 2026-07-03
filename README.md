# pet-brain

A shared "brain" for a dog. **Text a group chat to log your dog's life and ask an AI that actually
knows your dog** — backed by plain markdown files in git that you own and can read end to end.

My partner and I got a puppy and wanted two things: one place we could both update from our phones
(weight, vet visits, behaviour, to-dos), and a way to ask an AI for advice grounded in our dog's real
history rather than generic. It started as a Notion database + a Claude session; it's now a **Telegram
bot** over a **markdown repo**. This is that setup, generalized and stripped of anything personal.

## How it works

Three pieces, kept deliberately separate:

1. **The interface — a Telegram group + a bot.** Text anything from your phone; for each message an LLM
   decides whether it's worth saving and whether it's a question to answer. Observations get distilled
   and saved; questions get answered *grounded in your dog's records*; chatter is ignored. One-word logs
   ("pee", "ate", "vomited") work, a 👍 means it saved, and both owners share one thread. No app, no
   forms, no commands. (Code + setup: [`bot/`](bot).)
2. **The store — a git repo of markdown.** A profile, a vet log, a behaviour journal, a to-do list, and a
   curated **`bot-reference.md`** the bot reads in full. Plain text, version-controlled, yours — no
   lock-in, and you can read your whole "database" in a text editor. (Optionally mirrored to a Notion
   database as a shareable phone surface — see [`notion-setup.md`](notion-setup.md).)
3. **The brain — a `CLAUDE.md` + skills.** The bot captures each observation into an inbox; a Claude
   session (or a scheduled weekly tidy) files those into the right records, keeps the reference current,
   and handles deeper questions. The bot runs the moment-to-moment; Claude sessions do the heavier
   lifting.

**Why capture and filing are separate:** logging should be a five-second text, but filing and curation
are a *reviewing* step — it's what stops a bad line from silently becoming "truth" the bot later answers
from. The inbox is the quarantine between the two.

## Layout

```
bot/                 the Telegram bot: a Netlify background function + setup guide
CLAUDE.md            the brain: rules, index, protocols (auto-loads each session)
skills/
  log/SKILL.md             record an update into the right place, dated
  vet-visit-prep/SKILL.md  summarize recent history into a pre-appointment brief
examples/            synthetic data for a fictional dog "Scout": records, a bot-reference, an inbox
notion-setup.md      optional: mirror the records to a shareable Notion database
```

## Setup

1. **The records repo.** Your dog's markdown files are the store — `profile.md`, `vet-log.md`,
   `journal.md`, `todos.md`, and `bot-reference.md`. Start from [`examples/`](examples) and fill in your
   own; keep identifiers out (see Privacy).
2. **The bot.** Follow [`bot/README.md`](bot/README.md) — create the bot via BotFather, make a group,
   scope a GitHub token to your records repo, add an Anthropic key, deploy to Netlify, register the
   webhook. ~20 minutes.
3. **The brain.** Run Claude from inside the repo so `CLAUDE.md` auto-loads. Periodically process the
   inbox and tidy the records (the `log` and `vet-visit-prep` skills help) — or schedule that weekly so
   it runs itself.
4. **(Optional) Notion.** Mirror the records to a shared Notion database for a phone-friendly surface —
   [`notion-setup.md`](notion-setup.md).

## Privacy

Identifiers (microchip, passport, insurance, tax, bank) stay out of anything shared and are never
committed. The bot **redacts identifier numbers and strips the profile's owner/contact/financial
sections before any text is sent to the model**, and secrets live only in environment variables, never
in the repo. `CLAUDE.md` enforces the rule; this repo ships only synthetic example data.

## What it is (and isn't)

- It's a bespoke, zero-dependency function plus a folder of markdown you can read end to end — no
  database, no lock-in, portable anywhere Node runs.
- It's deliberately **not** a general autonomous agent: the bot only *captures and answers* and has no
  shell/file/build powers. The heavier work stays in supervised Claude sessions. That boundary is the
  point — it keeps the whole thing auditable and safe to run always-on.

## License

MIT — see [`LICENSE`](LICENSE).
