import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { Config } from './config.js';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
    const text = content.find(c => c.type === 'text')?.text;
    return text ?? JSON.stringify(res);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try { await this.client.close(); } catch { /* noop */ }
  }
}
