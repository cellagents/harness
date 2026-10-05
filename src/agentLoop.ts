import type { ChatMessage, ToolSpec } from './llmClient.js';
import type { Config } from './config.js';
import type { McpSession, McpToolInfo } from './mcpSession.js';
import type { LlmClient } from './llmClient.js';
import { computeCost } from './cost.js';

// Tools the LLM is allowed to call directly. heartbeat is called by the
// harness itself after each tick, not by the model, which is one of the
// lesson's enforcement points: a well-behaved harness reports cost honestly
// without relying on the model to do so.
const MODEL_TOOLS = new Set(['observe', 'set_heading', 'split', 'eject', 'status']);

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
    | 'heartbeat'
    | 'error'
    | 'status';
  ts: number;
  tick: number;
  payload: Record<string, unknown>;
}

export type AgentEventSink = (ev: AgentEvent) => void;

const SYSTEM_HEADER = `You control a cell in agar.io through a tool interface. Each tick you receive the current scene and must decide what to do. Available tools: observe (read scene), set_heading (choose direction), split, eject (fire mass), status (round phase and leaderboard). You cannot see history across ticks: every call is fresh. Call tools; do not describe actions in text. Keep tool calls purposeful.`;

export class AgentLoop {
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;
  private playerId: string | null = null;
  private joinInfo: { playerId: string; nickname: string; world: { width: number; height: number }; joinToken: string } | null = null;
  private lastCost = 0;

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

    let promptTokens = 0;
    let responseTokens = 0;

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

      promptTokens = resp.usage?.prompt_tokens ?? 0;
      responseTokens = resp.usage?.completion_tokens ?? 0;

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
      // Honest heartbeat regardless of success/failure, so a tick that
      // called a model still pays its drain. Zero tokens → zero cost.
      const cost = computeCost(this.config, {
        model: this.agent.model,
        promptTokens,
        responseTokens
      });
      this.lastCost = cost;
      try {
        const hbRaw = await this.mcp.call('heartbeat', {
          cost,
          model: this.agent.model,
          prompt_tokens: promptTokens
        });
        this.emit({ type: 'heartbeat', ts: Date.now(), tick: myTick, payload: { declared: cost, model: this.agent.model, prompt_tokens: promptTokens, response: safeJson(hbRaw) } });
      } catch (err) {
        this.emit({ type: 'error', ts: Date.now(), tick: myTick, payload: { message: `heartbeat failed: ${(err as Error).message}` } });
      }

      const elapsed = Date.now() - tickStart;
      this.emit({ type: 'tick-end', ts: Date.now(), tick: myTick, payload: { durationMs: elapsed, cost: this.lastCost } });

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
