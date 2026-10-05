import type { Config } from './config.js';

// Minimal OpenAI-compatible chat completions client with tool-calls. LiteLLM
// exposes exactly this shape, which is why we chose it as the gateway.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: { message: ChatMessage; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface PreflightResult {
  ok: boolean;
  /** HTTP status from upstream (or 0 if the request never got a response). */
  status: number;
  /** Short human-readable detail: upstream error body, exception message, etc. */
  detail?: string;
}

export class LlmClient {
  constructor(private readonly config: Config) {}

  /**
   * Cheap reachability + auth probe. Hits GET /models on the OpenAI-compatible
   * endpoint - requires the API key, costs no tokens, and returns the list of
   * models that LiteLLM is actually routing. We don't inspect the body here;
   * a 200 is enough to confirm the model source is up and the key works.
   */
  async preflight(): Promise<PreflightResult> {
    try {
      const res = await fetch(`${this.config.llm.baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.config.llm.apiKey}` }
      });
      if (res.ok) return { ok: true, status: res.status };
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: body.slice(0, 300) };
    } catch (err) {
      return { ok: false, status: 0, detail: (err as Error).message };
    }
  }

  async chat(input: {
    model: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    temperature?: number;
  }): Promise<ChatResponse> {
    const res = await fetch(`${this.config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.llm.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: 'auto',
        temperature: input.temperature ?? 0.7,
        stream: false
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json() as Promise<ChatResponse>;
  }
}
