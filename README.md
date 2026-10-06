# harness

Minimal web harness that runs the LLM agent loop server-side and
hosts the player panel. The harness manages user sessions and talks
to an MCP server and a LiteLLM router.

## `cellagents` project

Cell agents is an educational project where **LLM agents play this
game against each other and against human players.** This repo is one
of several key components in that stack; its job is to provide the
agent-management interface so a player can configure an LLM model to
play on their behalf.

Visit [**cellagents.dev**](https://cellagents.dev/) for overview of the full project.

## How it works

Each browser session gets its own backend `AgentLoop`. One tick is
one LLM call: the loop builds a fresh system prompt and a fresh
`observe` snapshot from the MCP server, waits for the full response,
dispatches every returned tool call over MCP, and logs the whole
exchange to the browser WebSocket. There is no cross-tick memory by
design, students see the entire thought.

Three services are involved at runtime:

- An MCP server (`cells-mcp`), reached over HTTP.
- An OpenAI-compatible model gateway, usually LiteLLM.
- A game server (`cells-game`), surfaced via its public URL. The panel
  iframes `${publicUrl}/follow?player=<id>` once the agent has joined,
  so the embedded game view is served by cells-game itself; harness
  does not bundle any game-rendering code.

## Endpoints

| Path                                     | Role                                                     |
|------------------------------------------|----------------------------------------------------------|
| `/`, `/panel`                            | Student panel: name, model dropdown, strategy, tick-rate, event log. The embedded game view is iframed from cells-game's `/follow`. |
| `/panel-config`                          | JSON config the panel reads at load (model list, game server URL). |
| `/ws`                                    | Panel ↔ backend WebSocket. One agent loop per connection. |
| `/health`                                | Liveness probe.                                          |

Spectator and admin UIs live on cells-game at `${gameServerUrl}/spectator`
and `${gameServerUrl}/admin`; harness does not proxy them.

## Running locally

Node 22+. You need an MCP server and an LLM gateway reachable; by
default the harness looks at `127.0.0.1:4000/mcp` and `127.0.0.1:8000/v1`.

```bash
npm install
cp config.example.json config.json       # edit URLs and models
npm start
# http://127.0.0.1:5000/panel
```

Watch mode during development:

```bash
npm run dev
```

Or with Docker:

```bash
docker build -t harness .
docker run --rm -p 5000:5000 \
  -e MCP_URL=http://host.docker.internal:4000/mcp \
  -e LLM_BASE_URL=http://host.docker.internal:8000/v1 \
  -e GAME_SERVER_PUBLIC_URL=http://127.0.0.1:3000 \
  harness
```

## Configuration

File + env overrides. All leaves are optional in `config.json`; env
vars take precedence.

| Config key                | Env var                      | Default                      |
|---------------------------|------------------------------|------------------------------|
| `harness.port`            | `HARNESS_PORT`               | `5000`                       |
| `harness.frontendPublic`  | `HARNESS_FRONTEND_PUBLIC`    | `./public`                   |
| `mcp.url`                 | `MCP_URL`                    | `http://127.0.0.1:4000/mcp`  |
| `gameServer.publicUrl`    | `GAME_SERVER_PUBLIC_URL`     | `http://127.0.0.1:3000`      |
| `llm.baseUrl`             | `LLM_BASE_URL`               | `http://127.0.0.1:8000/v1`   |
| `llm.apiKey`              | `LLM_API_KEY`                | `sk-classroom`               |
| `llm.defaultModel`        | `LLM_DEFAULT_MODEL`          | `claude-sonnet-4-6`          |
| `llm.models`              | `LLM_MODELS` (comma-list)    | 5-entry default              |

See `config.example.json` for the full shape.

## What's in the repo

- `src/index.ts` - HTTP server, routes, WebSocket upgrade.
- `src/agentLoop.ts` - the per-session tick loop.
- `src/mcpSession.ts` - MCP client that each session uses.
- `src/llmClient.ts` - OpenAI-compatible chat/completions wrapper.
- `src/config.ts` - config loader (file + env).
- `public/` - panel UI (static HTML/CSS/JS).

## License

MIT.
