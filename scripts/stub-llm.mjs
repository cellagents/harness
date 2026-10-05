// Dumb OpenAI-compatible chat-completions stub. Always returns a single
// tool_call set_heading toward a hardcoded point so smoke tests can verify
// that the harness → MCP → game-server pipeline actually moves the cell.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8000);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404); res.end(); return;
  }
  let buf = '';
  req.on('data', (c) => buf += c);
  req.on('end', () => {
    try {
      const body = JSON.parse(buf);
      const promptTokens = JSON.stringify(body.messages).length / 4; // rough
      const target = { x: 2500, y: 2500 };
      const toolCall = {
        id: 'call_1',
        type: 'function',
        function: { name: 'set_heading', arguments: JSON.stringify(target) }
      };
      const resp = {
        id: 'stub-1',
        model: body.model,
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: Math.round(promptTokens), completion_tokens: 30, total_tokens: Math.round(promptTokens) + 30 }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
    } catch (err) {
      res.writeHead(500); res.end(err.message);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[stub-llm] listening on 127.0.0.1:${PORT}`));
