# Connecting AI clients to your memory server

Once your instance is deployed and `/mcp` is live, any MCP-capable client
can use it. Auth is a bearer token — no OAuth flow.

## 1. Create a token

In the web UI, open **Tokens** (needs an `admin` session — log in once with
`DAMS_ADMIN_TOKEN`, then create real tokens) and create one:

- **`read_write`** — for a client that should read and append memory and
  propose plans (`propose_actions`).
- **`read_only`** — reads only: `list_projects`, `read_memory`,
  `search_memory`, `ask_memory`, `list_tasks`, `get_task`.
- Optionally **restrict it to specific projects**. A restricted token can
  only see those slugs, and anything else answers exactly like a project that
  doesn't exist. Use this for agents you trust less (or that process
  untrusted input).
- Keep **`admin`** for yourself: it's the only scope that can approve plans.

The raw token (`dams_…`) is shown once — copy it.

## 2. Register the server

Claude Code (`--scope user` makes it available in every session):

```bash
claude mcp add --transport http dams https://memory.example.com/mcp \
  --header "Authorization: Bearer dams_your_token" --scope user
```

Other clients: point them at `https://memory.example.com/mcp` (streamable
HTTP) and send `Authorization: Bearer <token>`.

Confirm with `claude mcp list` — `dams` should show as connected.

## 3. The tools

| Tool | Scope | What it does |
|---|---|---|
| `list_projects` | read_only | Projects you can access (slug, title, summary, tags, counts, flags) |
| `read_memory` | read_only | The full log for a project |
| `search_memory` | read_only | Hybrid semantic + keyword search with citations; searches projects that opted in to global search, unless you name projects |
| `ask_memory` | read_only | Ask a question about one project; returns the answer and the entries it used |
| `list_tasks` / `get_task` | read_only | What the global assistant is doing (unrestricted tokens only) |
| `append_memory` | read_write | Append an entry (id, `entity`/`relation`/`observation`, content) |
| `update_entity` | read_write | Append a new revision of an entity (last-write-wins) |
| `append_doc` / `update_doc` / `delete_doc` | read_write | Project markdown docs (update/delete tell the agent to confirm with you first) |
| `propose_actions` | read_write | File a plan (create/update/archive project, tag/move entries, write a synthesis). **Runs nothing** — you approve it on the Plans page; creating a project needs your separate typed confirmation |

There is intentionally no direct `create_project` tool — projects are
created from the web UI/REST, or proposed as a plan and approved.

A `read_only` token's `tools/list` doesn't even show the write tools.

## 4. Using it

Reference a project naturally ("check ghoraf's memory for what we decided
about the auth flow") and the client calls `search_memory`, `read_memory` or
`ask_memory` when relevant. Writing is always something you ask for — MCP
doesn't make a client write unprompted, and any plan it proposes still needs
your approval.

## If something goes wrong

- **401 / a login redirect** — wrong or revoked token, or Cloudflare Access
  isn't bypassing `/mcp` (see [DEPLOY.md](DEPLOY.md#cloudflare-access-if-you-use-it)).
- **`Unknown project: x`** — it doesn't exist, or your token's allow-list
  excludes it (deliberately indistinguishable).
- **`search_memory` returns nothing** — the project hasn't opted in to global
  search (Edit project → "Include in global search"), or name it explicitly
  in `projectSlugs`.
- **Empty tool list** — the route errored; check `wrangler tail` while you
  reconnect.
