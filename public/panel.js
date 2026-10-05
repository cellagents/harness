// Harness panel UI. Two independent connections:
// 1. WebSocket to the harness backend for commands + agent events.
// 2. Spectator Socket.IO to the game server for the embedded player view
//    (opened by the thin-client player module, which is served from the
//    same origin at /player.js).

import { mountPlayerView } from '/player.js';

const entry = document.getElementById('entry');
const game = document.getElementById('game');
const entryStatus = document.getElementById('entryStatus');
const log = document.getElementById('log');

const modelSel = document.getElementById('model');
const modelLive = document.getElementById('modelLive');
const tickRate = document.getElementById('tickRate');
const tickRateLive = document.getElementById('tickRateLive');
const tickRateValue = document.getElementById('tickRateValue');
const tickRateLiveValue = document.getElementById('tickRateLiveValue');
const strategy = document.getElementById('strategy');
const strategyLive = document.getElementById('strategyLive');
const nickname = document.getElementById('nickname');
const headerName = document.getElementById('headerName');

let panelConfig = null;
let ws = null;
let viewHandle = null;

init();

async function init() {
  const res = await fetch('/panel-config');
  panelConfig = await res.json();
  for (const sel of [modelSel, modelLive]) {
    for (const m of panelConfig.models) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      if (m === panelConfig.defaultModel) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  tickRate.addEventListener('input', () => { tickRateValue.textContent = `${tickRate.value} s`; });
  tickRateLive.addEventListener('input', () => { tickRateLiveValue.textContent = `${tickRateLive.value} s`; });
  tickRate.dispatchEvent(new Event('input'));

  document.getElementById('start').addEventListener('click', onStart);
  document.getElementById('stop').addEventListener('click', onStop);
  strategyLive.addEventListener('change', pushUpdate);
  modelLive.addEventListener('change', pushUpdate);
  tickRateLive.addEventListener('change', pushUpdate);
}

function onStart() {
  if (!nickname.value.trim()) { setEntryStatus('Zadej jméno.'); return; }
  setEntryStatus('Připojuji...');
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'start',
      nickname: nickname.value.trim(),
      strategy: strategy.value,
      model: modelSel.value,
      tickRateSec: Number(tickRate.value)
    }));
  });
  ws.addEventListener('message', (ev) => handleEvent(JSON.parse(ev.data)));
  ws.addEventListener('close', () => {
    appendLog({ type: 'status', ts: Date.now(), payload: { phase: 'ws-closed' } });
  });
  ws.addEventListener('error', () => setEntryStatus('WS chyba.'));
}

function onStop() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  if (viewHandle) { viewHandle.stop(); viewHandle = null; }
  entry.style.display = ''; game.style.display = 'none';
}

function pushUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'update',
    strategy: strategyLive.value,
    model: modelLive.value,
    tickRateSec: Number(tickRateLive.value)
  }));
}

function handleEvent(ev) {
  if (ev.type === 'status' && ev.payload?.phase === 'joined') {
    const info = ev.payload;
    entry.style.display = 'none';
    game.style.display = '';
    headerName.textContent = info.nickname || 'player';
    strategyLive.value = strategy.value;
    modelLive.value = modelSel.value;
    tickRateLive.value = tickRate.value;
    tickRateLiveValue.textContent = `${tickRate.value} s`;
    viewHandle = mountPlayerView({
      container: document.getElementById('playerView'),
      playerId: info.playerId,
      gameServerUrl: panelConfig.gameServerUrl,
      zoom: 2
    });
  }
  appendLog(ev);
}

function appendLog(ev) {
  const row = document.createElement('div');
  row.className = `entry ${ev.type}`;
  row.innerHTML = `<span class="ts">${new Date(ev.ts).toLocaleTimeString()}</span><span class="label">${ev.type}</span> <span>${escapeHtml(JSON.stringify(ev.payload))}</span>`;
  log.prepend(row);
  while (log.children.length > 200) log.lastChild.remove();
}

function setEntryStatus(text) { entryStatus.textContent = text; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
