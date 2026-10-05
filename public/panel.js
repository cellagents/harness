// Harness panel UI. One WebSocket to the harness backend for commands +
// agent events; the embedded game view is a plain iframe pointed at
// cells-game's /follow page. The iframe gets a src only after the
// backend confirms the player joined.

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
const playerView = document.getElementById('playerView');

let panelConfig = null;
let ws = null;

function blankPlayerView() {
  playerView.src = 'about:blank';
}

function showPlayerView(playerId) {
  const base = panelConfig.gameServerUrl.replace(/\/$/, '');
  playerView.src = `${base}/follow?player=${encodeURIComponent(playerId)}`;
}

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

async function onStart() {
  if (!nickname.value.trim()) { setEntryStatus('Enter a name.'); return; }
  const startBtn = document.getElementById('start');
  startBtn.disabled = true;
  setEntryStatus('Checking model source...');
  try {
    const pre = await fetch('/preflight');
    const body = await pre.json().catch(() => ({}));
    if (!pre.ok || !body.ok) {
      const detail = body.detail ? `: ${body.detail}` : '';
      const upstream = body.status ? ` (upstream ${body.status})` : '';
      setEntryStatus(`LLM unreachable${upstream}${detail}`);
      startBtn.disabled = false;
      return;
    }
  } catch (err) {
    setEntryStatus(`Preflight error: ${err.message}`);
    startBtn.disabled = false;
    return;
  }

  setEntryStatus('Connecting...');
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
    blankPlayerView();
    startBtn.disabled = false;
  });
  ws.addEventListener('error', () => {
    setEntryStatus('WebSocket error.');
    startBtn.disabled = false;
  });
}

function onStop() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  blankPlayerView();
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
    if (info.playerId) showPlayerView(info.playerId);
    else blankPlayerView();
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
