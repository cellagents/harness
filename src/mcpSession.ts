import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { Config } from './config.js';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type GameTerminationKind = 'kicked' | 'eaten' | 'disconnected' | 'quit' | 'unknown';

export class GameTerminatedError extends Error {
  readonly kind: GameTerminationKind;
  readonly detail: string;
  constructor(kind: GameTerminationKind, detail: string) {
    super(`game session ended (${kind}${detail ? `: ${detail}` : ''})`);
    this.name = 'GameTerminatedError';
    this.kind = kind;
    this.detail = detail;
  }
}

function parseTerminationFromText(text: string): GameTerminatedError | null {
  const m = text.match(/game session ended \(([^)]*)\)/i);
  if (!m) return null;
  const inner = m[1].trim();
  if (/^game kicked player:?\s*(.*)$/i.test(inner)) {
    return new GameTerminatedError('kicked', RegExp.$1.trim());
  }
  if (/^game socket disconnected:?\s*(.*)$/i.test(inner)) {
    const reason = RegExp.$1.trim();
    if (reason === 'quit') return new GameTerminatedError('quit', reason);
    return new GameTerminatedError('disconnected', reason);
  }
  if (/eaten/i.test(inner)) return new GameTerminatedError('eaten', inner);
  return new GameTerminatedError('unknown', inner);
}

/**
 * Wraps an MCP client bound to the apps/mcp-server endpoint. One instance per
 * harness session (= one browser tab = one player). The lifecycle is tied to
 * the WebSocket connection: open on session start, close on disconnect.
 */
export class McpSession {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected = false;
  tools: McpToolInfo[] = [];

  constructor(private readonly config: Config) {
    this.transport = new StreamableHTTPClientTransport(new URL(this.config.mcp.url));
    this.client = new Client({ name: 'cellagents-harness', version: '0.1.0' });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    const list = await this.client.listTools();
    this.tools = list.tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} }
    }));
    this.connected = true;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.connected) throw new Error('mcp session not connected');
    const res = await this.client.callTool({ name, arguments: args });
    const content = (res.content as Array<{ type: string; text?: string }> | undefined) || [];
    const text = content.find(c => c.type === 'text')?.text ?? JSON.stringify(res);
    // cells-mcp surfaces game-side termination (kick/eaten/disconnect)
    // as an isError tool result whose text starts with "game session
    // ended (...)". Promote that to a typed error so the agent loop
    // can stop cleanly instead of looping on dead-session errors.
    if ((res as { isError?: boolean }).isError) {
      const terminated = parseTerminationFromText(text);
      if (terminated) throw terminated;
    }
    return text;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try { await this.client.close(); } catch { /* noop */ }
  }
}
