# Notion setup

The store is one Notion database plus a profile page. This is the whole schema.

## 1. Create the database

Make a database called something like **Dog log** with these properties:

| Property | Type | Used for |
|---|---|---|
| `Title` | Title | a one-line summary of the entry |
| `Type` | Select | `Weight` · `Vet` · `Behaviour` · `Fact` · `Task` |
| `Date` | Date | when it happened (entries read newest-first) |
| `Notes` | Text | the detail |
| `Weight (kg)` | Number | weigh-ins (leave empty otherwise) |
| `Due` | Date | for vaccinations, meds, follow-ups, tasks |
| `Status` | Select | `Open` · `Done` (tasks and due items) |

Add a **Profile** page (a normal Notion page, or a pinned `Fact` entry) for the static facts: name, breed, date of birth, owners, food, allergies, spay/neuter status, vet, insurer. Keep raw identifiers out of it (see Privacy).

## 2. Share it

Invite the second owner to the database. Both of you now log from the Notion mobile app: open the database, add a row, pick a `Type`, done. That five-second action from a phone is the whole point.

## 3. Connect Claude

Give Claude Code access to the database through the Notion MCP server, then install the skills.

1. **Add the Notion MCP server.** The simplest path is Notion's hosted server, which authorizes in the browser:
   ```
   claude mcp add --transport http notion https://mcp.notion.com/mcp
   ```
   Then run `/mcp` inside Claude Code and complete the browser sign-in. (Alternative: self-host — create an internal integration at notion.so/my-integrations, copy its token, and configure the Notion MCP server with it.)
2. **Grant access to the database — easy to miss.** A fresh integration sees nothing until you connect the page to it. Open the database in Notion → **•••** menu → **Connections** → add your integration. Without this, Claude gets an empty result and can't read or write.
3. **Install the skills** where Claude Code looks for them: `mkdir -p .claude/skills && cp -r skills/* .claude/skills/` (or `~/.claude/skills/` to make them available in every project).
4. **Run Claude from this folder** so `CLAUDE.md` loads. The `log` skill writes new rows; `vet-visit-prep` reads recent rows. For advice, just chat: Claude reads the database for context.

## 4. Privacy

Microchip, passport, insurance, tax, and bank numbers do not go in the shared database or this repo. Keep them in a private note (a local file, or a Notion page not shared and not exported). The `CLAUDE.md` rule enforces this for anything Claude writes.

## No-Notion fallback

The same structure works as local markdown: one file per `Type` (`weight.md`, `vet.md`, `behaviour.md`, `tasks.md`) plus `profile.md`, each dated newest-on-top. See `examples/`. Sync between owners with a private git repo if you want it shared.
