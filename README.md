# harness

A minimalistic web-based AI agent harness that lets a language model
play the cells game. The harness manages web-based user sessions,
maintains connection to the game MCP server and LiteLLM router that
provides the LLM models.

## Relationship with `cellagents` organization

Cell agents is an educational project where **LLM agents play a
multiplayer cell-eating game against each other and against human
players.** This repo is one of five components in that stack: a
minimal, auditable harness used for demonstration so every user can
quickly access the same tooling and watch the agent think in real time.

Full picture, repository map and architecture diagrams:
→ [**cellagents.dev/developers**](https://cellagents.dev/developers/)

The pedagogical shape of related demo lesson is on
[**cellagents.dev/classroom**](https://cellagents.dev/classroom/).

## How it works

Each browser session gets its own backend `AgentLoop`. One tick is
one LLM call: the loop builds a fresh system prompt and a fresh
`observe` snapshot from the MCP server, waits for the full response,
dispatches every returned tool call over MCP, and logs the whole
exchange to the browser WebSocket. There is no cross-tick memory by
design, students see the entire thought.

Four services are involved at runtime:

- An MCP server (`cells-mcp`), reached over HTTP.
- An OpenAI-compatible model gateway, usually LiteLLM.
- A game server (`cells-game` or any `agar.io-clone`), surfaced only
  via the public URL for the embedded player view.
- The thin-client bundle, served as static files by this process.

## Endpoints

| Path                                     | Role                                                     |
|------------------------------------------|----------------------------------------------------------|
| `/`, `/panel`                            | Student panel: name, model dropdown, strategy, tick-rate, event log. |
| `/panel-config`                          | JSON config the panel reads at load (model list, URLs). |
| `/spectate`, `/follow`, `/admin`         | Thin-client static modes.                                |
| `/ws`                                    | Panel ↔ backend WebSocket. One agent loop per connection. |
| `/health`                                | Liveness probe.                                          |

## Running locally

Node 22+. You need an MCP server and an LLM gateway reachable; by
default the harness looks at `127.0.0.1:4000/mcp` and `127.0.0.1:8000/v1`.

```bash
npm install
npm run build
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
  -e HARNESS_THIN_CLIENT_DIST=/path/to/thin-client/dist \
  harness
```

The thin-client bundle is not built here. Build it in its own repo
and point `harness.thinClientDist` (or `HARNESS_THIN_CLIENT_DIST`)
at the resulting `dist/` directory.

## Configuration

File + env overrides. All leaves are optional in `config.json`; env
vars take precedence.

| Config key                | Env var                      | Default                      |
|---------------------------|------------------------------|------------------------------|
| `harness.port`            | `HARNESS_PORT`               | `5000`                       |
| `harness.thinClientDist`  | `HARNESS_THIN_CLIENT_DIST`   | `../thin-client/dist`        |
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
