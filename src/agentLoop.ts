import type { ChatMessage, ToolSpec } from './llmClient.js';
import type { Config } from './config.js';
import type { McpSession, McpToolInfo } from './mcpSession.js';
import type { LlmClient } from './llmClient.js';

const MODEL_TOOLS = new Set(['observe', 'move_to', 'set_heading', 'stop', 'split', 'eject']);

export interface AgentConfig {
  model: string;
  strategy: string;
  tickRateSec: number;
}

export interface AgentEvent {
  type:
    | 'tick-start'
    | 'tick-end'
    | 'tool-call'
    | 'tool-result'
    | 'model-response'
    | 'error'
    | 'status';
  ts: number;
  tick: number;
  payload: Record<string, unknown>;
}

export type AgentEventSink = (ev: AgentEvent) => void;

const SYSTEM_HEADER = `You control a cell in a multiplayer agar-like game through a tool interface. Each tick you receive the current scene and must decide what to do. Available tools: observe (read scene), move_to (head to a world coordinate), set_heading (go a direction forever), stop (halt movement), split, eject (fire mass). Movement is persistent: once you call move_to or set_heading the MCP keeps steering until arrival or until you issue another movement tool. You cannot see history across ticks: every call is fresh. Call tools; do not describe actions in text. Keep tool calls purposeful.`;

export class AgentLoop {
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;
  private playerId: string | null = null;
  private joinInfo: { playerId: string; nickname: string; world: { width: number; height: number } } | null = null;

  constructor(
    private readonly config: Config,
    private readonly mcp: McpSession,
    private readonly llm: LlmClient,
    private readonly agent: AgentConfig,
    private readonly nickname: string,
    private readonly emit: AgentEventSink
  ) {}

  async start(): Promise<void> {
    const joinRaw = await this.mcp.call('join_game', { nickname: this.nickname });
    this.joinInfo = JSON.parse(joinRaw);
    this.playerId = this.joinInfo!.playerId;
    this.emit({
      type: 'status',
      ts: Date.now(),
      tick: 0,
      payload: { phase: 'joined', ...this.joinInfo }
    });
    this.running = true;
    this.scheduleNext(0);
  }

  updateAgent(partial: Partial<AgentConfig>): void {
    Object.assign(this.agent, partial);
    this.emit({
      type: 'status',
      ts: Date.now(),
      tick: this.tick,
      payload: { phase: 'agent-updated', agent: this.agent }
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.mcp.close();
  }

  getJoinInfo() { return this.joinInfo; }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => { void this.runTick(); }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (!this.running) return;
    const tickStart = Date.now();
    const myTick = ++this.tick;
    this.emit({ type: 'tick-start', ts: tickStart, tick: myTick, payload: { agent: this.agent } });

    try {
      // Fresh observation every tick. No carried-over history by design.
      const observation = await this.mcp.call('observe', {});
      this.emit({
        type: 'tool-result',
        ts: Date.now(),
        tick: myTick,
        payload: { tool: 'observe', result: safeJson(observation) }
      });

      const tools = toOpenAiToolSpecs(this.mcp.tools);
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_HEADER + '\n\nStrategy from the player:\n' + (this.agent.strategy || '(empty strategy)') },
        { role: 'user', content: `Current observation (tick ${myTick}):\n${observation}` }
      ];

      const resp = await this.llm.chat({
        model: this.agent.model,
        messages,
        tools
      });

      const msg = resp.choices[0]?.message;
      this.emit({
        type: 'model-response',
        ts: Date.now(),
        tick: myTick,
        payload: {
          model: resp.model,
          content: msg?.content ?? null,
          tool_calls: msg?.tool_calls || [],
          usage: resp.usage || null
        }
      });

      for (const call of msg?.tool_calls || []) {
        if (!MODEL_TOOLS.has(call.function.name)) {
          this.emit({
            type: 'error',
            ts: Date.now(),
            tick: myTick,
            payload: { message: `model called disallowed tool: ${call.function.name}` }
          });
          continue;
        }
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (err) {
          this.emit({
            type: 'error',
            ts: Date.now(),
            tick: myTick,
            payload: { message: `invalid tool_call arguments for ${call.function.name}: ${(err as Error).message}` }
          });
          continue;
        }
        this.emit({ type: 'tool-call', ts: Date.now(), tick: myTick, payload: { tool: call.function.name, args } });
        try {
          const result = await this.mcp.call(call.function.name, args);
          this.emit({ type: 'tool-result', ts: Date.now(), tick: myTick, payload: { tool: call.function.name, result: safeJson(result) } });
        } catch (err) {
          this.emit({ type: 'error', ts: Date.now(), tick: myTick, payload: { message: `tool ${call.function.name} failed: ${(err as Error).message}` } });
        }
      }
    } catch (err) {
      this.emit({ type: 'error', ts: Date.now(), tick: myTick, payload: { message: (err as Error).message } });
    } finally {
      const elapsed = Date.now() - tickStart;
      this.emit({ type: 'tick-end', ts: Date.now(), tick: myTick, payload: { durationMs: elapsed } });

      const nextDelay = Math.max(0, this.agent.tickRateSec * 1000 - elapsed);
      if (!this.closed) this.scheduleNext(nextDelay);
    }
  }
}

function toOpenAiToolSpecs(mcpTools: McpToolInfo[]): ToolSpec[] {
  return mcpTools
    .filter(t => MODEL_TOOLS.has(t.name))
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>
      }
    }));
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
