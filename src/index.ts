import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

import { loadConfig } from './config.js';
import { McpSession } from './mcpSession.js';
import { LlmClient } from './llmClient.js';
import { AgentLoop, AgentEvent } from './agentLoop.js';

// Browser → backend command envelope.
const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    nickname: z.string().min(1).max(25),
    strategy: z.string().default(''),
    model: z.string(),
    tickRateSec: z.number().min(1).max(10)
  }),
  z.object({ type: z.literal('update'), strategy: z.string().optional(), model: z.string().optional(), tickRateSec: z.number().min(1).max(10).optional() }),
  z.object({ type: z.literal('stop') })
]);

async function main() {
  const config = loadConfig();
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Config surface the browser needs on page load (model dropdown and
  // public game-server URL so the panel can iframe cells-game's /follow).
  // The LLM API key is intentionally not here; auth strategy can change
  // without reshaping this response.
  app.get('/panel-config', (_req, res) => {
    res.json({
      models: config.llm.models,
      defaultModel: config.llm.defaultModel,
      gameServerUrl: config.gameServer.publicUrl
    });
  });

  // Harness owns only /panel. The embedded game view is iframed from
  // cells-game's /follow endpoint; spectator and admin surfaces live on
  // the game server itself.
  const panelDir = config.harness.frontendPublic;
  if (!fs.existsSync(panelDir)) console.warn(`[harness] frontend public dir missing: ${panelDir}`);

  app.get('/', (_req, res) => res.redirect('/panel'));
  app.use('/panel', express.static(panelDir));

  const server = http.createServer(app);

  // One AgentLoop per WebSocket connection.
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => attachSession(ws, config));

  server.listen(config.harness.port, () => {
    console.log(`[harness] listening on http://127.0.0.1:${config.harness.port}`);
    console.log(`[harness] mcp: ${config.mcp.url}  llm: ${config.llm.baseUrl}`);
  });

  const shutdown = () => {
    console.log('[harness] shutting down');
    wss.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function attachSession(ws: WebSocket, config: ReturnType<typeof loadConfig> extends Promise<infer R> ? R : ReturnType<typeof loadConfig>): void {
  const llm = new LlmClient(config);
  let mcp: McpSession | null = null;
  let agent: AgentLoop | null = null;

  const emit = (ev: AgentEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  };

  const sendError = (message: string) => {
    emit({ type: 'error', ts: Date.now(), tick: 0, payload: { message } });
  };

  ws.on('message', async (buf) => {
    let cmd;
    try { cmd = CommandSchema.parse(JSON.parse(buf.toString())); }
    catch (err) { sendError(`bad command: ${(err as Error).message}`); return; }

    if (cmd.type === 'start') {
      if (agent) { sendError('agent already started'); return; }
      try {
        mcp = new McpSession(config);
        await mcp.connect();
        agent = new AgentLoop(
          config,
          mcp,
          llm,
          { model: cmd.model, strategy: cmd.strategy, tickRateSec: cmd.tickRateSec },
          cmd.nickname,
          emit
        );
        await agent.start();
      } catch (err) {
        sendError(`start failed: ${(err as Error).message}`);
        if (mcp) await mcp.close();
        agent = null; mcp = null;
      }
    } else if (cmd.type === 'update') {
      if (!agent) { sendError('not started'); return; }
      agent.updateAgent({
        ...(cmd.strategy !== undefined ? { strategy: cmd.strategy } : {}),
        ...(cmd.model ? { model: cmd.model } : {}),
        ...(cmd.tickRateSec ? { tickRateSec: cmd.tickRateSec } : {})
      });
    } else if (cmd.type === 'stop') {
      if (agent) await agent.stop();
      agent = null;
      mcp = null;
    }
  });

  ws.on('close', async () => {
    if (agent) await agent.stop();
    agent = null;
    mcp = null;
  });
}

main().catch(err => {
  console.error('[harness] fatal:', err);
  process.exit(1);
});
