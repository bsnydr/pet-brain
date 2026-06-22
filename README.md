# pet-brain

A shared "brain" for a dog. Log and read your dog's life in a Notion database from your phone, and chat with Claude separately for advice that actually knows your dog.

My partner and I got a puppy and wanted two things: one place we could both update from our phones (weight, vet visits, behaviour, to-dos), and a way to ask an AI for advice that was grounded in our dog's real history rather than generic. This is that setup, generalized and stripped of anything personal.

## How it works

Two pieces, kept deliberately separate:

1. **The store: a Notion database.** It holds every update as a dated entry (weights, vet events, behaviour notes, facts, tasks), plus a profile page. Notion is the store because it is shared and editable from the mobile app, so both owners log from their phones with no extra tooling.
2. **The brain: Claude Code.** A `CLAUDE.md` and two skills point a Claude session at the Notion data. The `log` skill files an update into the right place, dated and newest-on-top. The `vet-visit-prep` skill summarizes recent history into a one-page brief before an appointment. You chat with Claude separately for advice; it reads the Notion entries for context.

The advice chat and the logging are separate on purpose: logging should be a five-second action from your phone, and advice should pull from everything logged without you re-explaining it.

## Setup

1. **Create the Notion database** (properties and a profile template in [`notion-setup.md`](notion-setup.md)). Share it with your partner.
2. **Connect the Notion MCP** so a Claude session can read and write the database — full steps, including the easy-to-miss "share the database with the integration", are in [`notion-setup.md`](notion-setup.md#3-connect-claude).
3. **Install the skills.** Claude Code only auto-discovers skills under a `.claude/skills/` directory, so copy them there once: `mkdir -p .claude/skills && cp -r skills/* .claude/skills/` (use `~/.claude/skills/` instead to make them available in every project). `.claude/` is gitignored, so this stays local.
4. **Run Claude from inside this folder** so `CLAUDE.md` auto-loads. Add updates with the `log` skill; prep an appointment with `vet-visit-prep`.

No Notion? The same structure works as local markdown files (one per category). See the example in [`examples/`](examples).

## Privacy

Identifiers (microchip, passport, insurance, tax, bank) stay out of anything shared and are never committed. The `CLAUDE.md` enforces this as a rule, and this repo ships only synthetic example data.

## Layout

```
CLAUDE.md            the brain: rules, index, the logging protocol (auto-loads each session)
skills/
  log/SKILL.md             record an update into the right place, dated
  vet-visit-prep/SKILL.md  summarize recent history into a pre-appointment brief
notion-setup.md      the Notion database schema + how to connect it
examples/            synthetic example entries (no real dog or owner)
```

## License

MIT.
