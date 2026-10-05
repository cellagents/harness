// End-to-end smoke: open a browser-like WebSocket to the harness, send
// `start`, consume agent events for ~6 seconds, print a tick summary.
import WebSocket from 'ws';

const WS_URL = process.env.HARNESS_WS || 'ws://127.0.0.1:5000/ws';
const DURATION_MS = Number(process.env.DURATION_MS || 6000);

const ws = new WebSocket(WS_URL);
const events = [];

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'start',
    nickname: 'SmokeHarness',
    strategy: 'move to center of the map',
    model: 'claude-sonnet-4-6',
    tickRateSec: 2
  }));
});

ws.on('message', (buf) => {
  const ev = JSON.parse(buf.toString());
  events.push(ev);
  const summary = ev.type === 'tick-end'
    ? `${ev.type} tick=${ev.tick} dur=${ev.payload.durationMs}ms cost=${ev.payload.cost?.toFixed?.(3)}`
    : ev.type === 'heartbeat'
      ? `${ev.type} declared=${ev.payload.declared?.toFixed?.(3)} applied=${ev.payload.response?.applied_drain?.toFixed?.(3)}`
      : ev.type === 'tool-call'
        ? `${ev.type} ${ev.payload.tool} ${JSON.stringify(ev.payload.args)}`
        : ev.type === 'status'
          ? `${ev.type} ${ev.payload.phase}`
          : ev.type === 'error'
            ? `${ev.type} ${ev.payload.message}`
            : ev.type;
  console.log(summary);
});

setTimeout(() => {
  ws.send(JSON.stringify({ type: 'stop' }));
  setTimeout(() => {
    const bytype = {};
    for (const e of events) bytype[e.type] = (bytype[e.type] || 0) + 1;
    console.log('--- summary ---');
    console.log(JSON.stringify(bytype, null, 2));
    const err = events.find(e => e.type === 'error');
    if (err) {
      console.log('first error:', err.payload.message);
      process.exit(1);
    }
    process.exit(0);
  }, 300);
}, DURATION_MS);
