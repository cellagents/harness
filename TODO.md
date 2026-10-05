# TODO: harness

Scope and architecture live in `../../SW_PROJECT.md`, section "Komponenta 4". New Node 20 web app, the reference "honest harness" of the lesson. Backend runs the agent loop and holds the MCP client. Browser is a dashboard, no game actions go through it.

Depends on the MCP server (M2). LiteLLM (M5) can be stubbed with a direct OpenAI-compatible endpoint until wired.

## Milestone 4: harness

- [x] **1. Backend skeleton.** HTTP server, WebSocket to browser, MCP client to `apps/mcp-server`, OpenAI-compatible HTTP client to LiteLLM.
- [x] **2. Agent loop.** One tick = one LLM call. Each tick builds a fresh system prompt + fresh `observe` (no history across ticks). Response may contain multiple tool_calls; execute all over MCP. Log everything to the browser WebSocket. No streaming, wait for the complete response before acting.
- [x] **3. Cost module (`src/cost.ts`).** Documented formula from the lesson. Called before every `heartbeat`. This is the file students are explicitly pointed at in the lesson about client-server trust boundaries.
- [x] **4. Frontend.**
  - Entry screen: name field, pre-filled access key, "Spustit".
  - Game screen split:
    - Embedded thin-client `player` mode module.
    - Side panel: two-part system prompt (read-only tools/controls + editable strategy), model dropdown (constant list), tick-rate slider 1-5s, live metabolism indicator.
    - Below: event log with tool calls, model responses, and errors. No silent swallowing of errors; the loop surfaces them in the log by design.
- [x] **5. Serve thin-client static bundle.** This app's build output serves `/spectate`, `/follow`, `/admin`. Thin client is not a separate docker service.
- [x] **6. Browser connections, two independent sockets.**
  - WebSocket to harness backend for UI commands + LLM events.
  - Spectator Socket.IO directly to the game server for rendering (opened by the embedded thin client), decoupling control and observation.

**Exit criteria.** Open `/panel`, enter a name, pick a strategy, see the cell move based on LLM decisions. Event log shows tool calls and model responses. Changing tick-rate and model visibly changes the live metabolism indicator. Errors from the model surface in the log.

**Deliberately out of scope and part of the lesson.** No memory across ticks. No streaming. Honest cost reporting (the harness does not lie, even if a student's custom harness could). No faster-than-slider execution. See "Co harness vědomě nedělá" in SW_PROJECT.md.

## Open questions bubbled up from this component

- Framework for the frontend: vanilla JS vs a small framework. Decide at implementation start.
- Shape of the two-part system prompt text: write with the lesson narrative in mind.
