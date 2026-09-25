# Connecting Claude Code to your own memory server

Do this after the task above is deployed and `/mcp` is live.

## 1. Register the server

From any project directory (or pass `--scope user` to make it available
everywhere rather than just the current project):

```
claude mcp add --transport http dams https://memory.mahmoudbebars.dev/mcp --scope user
```

`--scope user` matters here — this server isn't specific to one project,
you want it available in every Claude Code session, not just the repo
you happened to run this from.

## 2. Authenticate

Start any Claude Code session and run:

```
/mcp
```

It will detect that `dams` needs auth (a 401 from your server triggers
this), open your browser to GitHub's OAuth consent screen, and — because
of the allow-list check built into Part B of the task above — only your
GitHub account will actually complete the login. Tokens are stored in
your system keychain and refreshed automatically.

## 3. Confirm it worked

```
claude mcp list
```

should show `dams` as connected with a tool count matching the four
tools from Part A (`list_projects`, `read_memory`, `append_memory`,
`ask_memory`).

## 4. Using it

Once connected, you don't need to invoke tools explicitly — just
reference a project naturally in conversation ("check ghoraf's memory
for what we decided about the auth flow") and Claude Code will call
`read_memory` or `ask_memory` on its own when it's relevant.

If you want it to *write* to memory as you work — logging a decision at
the end of a session, for instance — that still has to be something you
ask for explicitly. Nothing about MCP makes Claude Code write to your
memory unprompted; it calls `append_memory` the same way it calls any
other tool, when the conversation calls for it.

## If something goes wrong

- `claude mcp get dams` shows the server's status and, if auth failed,
  the URL to redo the OAuth flow manually.
- A repeating OAuth redirect loop usually means a stale token — clear
  authentication from the `/mcp` panel and try again.
- An empty tool list after connecting (server shows connected, 0 tools)
  usually means the MCP route itself errored on startup — check
  `wrangler tail` against the deployed Worker while you retry.
