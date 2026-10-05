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

export class LlmClient {
  constructor(private readonly config: Config) {}

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
