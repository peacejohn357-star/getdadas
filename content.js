/* ====================================================
 * 3Tick Scalper – Step Index 100 Micro-Timing V3 Collector
 * Content script for dtrader.deriv.com
 * Refined for Streak & Pattern Analysis
 * ==================================================== */
(function () {
  'use strict';

  // ── Constants & config ────────────────────────────────────────────────────
  const WS_URL          = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  const WS_URL_FALLBACK = 'wss://ws.deriv.com/websockets/v3?app_id=1089';
  const FALLBACK_AFTER  = 3;
  const TICK_BUF        = 1000;
  const RECONNECT_BASE  = 4000;
  const RECONNECT_MAX   = 64000;
  const LOG_MAX         = 50000;

  // ── State ─────────────────────────────────────────────────────────────────
  let ticks       = [];  // { price, epoch, receivedAt, deltaSteps, ... }
  let eventLog    = [];  // finalized micro-timing events (streaks/patterns)
  let tickLogging = false;

  let upStreak    = 0;
  let downStreak  = 0;
  let dirHistory  = []; // Array of 'U', 'D', 'F' (Up, Down, Flat)

  // Trackers for pre-streak/start-streak context
  let lastUpPreContext   = null; // State when upStreak was 0
  let lastUpStartContext = null; // State when upStreak was 1
  let lastDownPreContext   = null; // State when downStreak was 0
  let lastDownStartContext = null; // State when downStreak was 1

  let ws             = null;
  let wsState        = 'disconnected';
  let reconnectTimer = null;
  let resolvedSymbol = null;
  let manualClose    = false;
  let reconnectDelay = RECONNECT_BASE;
  let failCount      = 0;
  let usingFallback  = false;

  // ── Overlay build ─────────────────────────────────────────────────────────
  function buildOverlay () {
    if (document.getElementById('tt-overlay')) return;

    const el = document.createElement('div');
    el.id = 'tt-overlay';
    el.innerHTML = `
      <div id="tt-header">
        <span class="tt-title">3Tick Timing V3</span>
        <div class="tt-header-btns">
          <button id="tt-min-btn"   title="Minimise">_</button>
          <button id="tt-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div id="tt-body">
        <div class="tt-row">
          <span class="tt-label">Status</span>
          <span class="tt-val" id="tt-status">
            <span class="tt-dot tt-dot-disconnected"></span>Disconnected
          </span>
        </div>
        <div class="tt-row">
          <span class="tt-label">Symbol</span>
          <span class="tt-val" id="tt-symbol">–</span>
        </div>
        <div class="tt-row">
          <span class="tt-label">Last Price</span>
          <span class="tt-val" id="tt-price">–</span>
        </div>
        <div class="tt-row">
          <span class="tt-label">Events Logged</span>
          <span class="tt-val" id="tt-log-count">0</span>
        </div>

        <button id="tt-log-toggle">▶ Start Collection</button>
        <button id="tt-log-export">⬇ Export CSV</button>
        <button id="tt-log-clear" style="background:#3d1a1a;color:#e04040;margin-top:2px;">Clear Log</button>
      </div>
    `;

    document.body.appendChild(el);

    const saved = safeStorage('get', 'tt-pos');
    if (saved) {
      el.style.right = 'auto';
      el.style.left  = saved.left + 'px';
      el.style.top   = saved.top  + 'px';
    }

    makeDraggable(el);
    bindButtons(el);
  }

  function makeDraggable (el) {
    const header = document.getElementById('tt-header');
    let ox = 0, oy = 0;
    header.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
    function onMove (e) {
      const left = e.clientX - ox;
      const top  = e.clientY - oy;
      el.style.right = 'auto';
      el.style.left  = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  left)) + 'px';
      el.style.top   = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, top))  + 'px';
    }
    function onUp () {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      safeStorage('set', 'tt-pos', { left: parseInt(el.style.left), top: parseInt(el.style.top) });
    }
  }

  function bindButtons (el) {
    document.getElementById('tt-min-btn').addEventListener('click', function () {
      el.classList.toggle('tt-minimized');
      this.textContent = el.classList.contains('tt-minimized') ? '□' : '_';
    });
    document.getElementById('tt-close-btn').addEventListener('click', function () {
      manualClose = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { ws.close(); ws = null; }
      el.remove();
    });
    const logToggleBtn = document.getElementById('tt-log-toggle');
    logToggleBtn.addEventListener('click', function () {
      tickLogging = !tickLogging;
      this.textContent = tickLogging ? '⏹ Stop Collection' : '▶ Start Collection';
      this.style.color = tickLogging ? '#e04040' : '#a0c8a0';
    });
    document.getElementById('tt-log-export').addEventListener('click', exportEventLog);
    document.getElementById('tt-log-clear').addEventListener('click', function() {
        if (confirm('Clear all logged data?')) {
            eventLog = [];
            updateLogCount();
        }
    });
  }

  function updateLogCount() {
    const el = document.getElementById('tt-log-count');
    if (el) el.textContent = eventLog.length;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function resolveSymbol (symbols) {
    var candidates = ['stpRNG', 'STPRNG'];
    for (var i = 0; i < candidates.length; i++) {
      if (symbols.find(function (s) { return s.symbol === candidates[i]; })) {
        return candidates[i];
      }
    }
    var byName = symbols.find(function (s) {
      return /step\s*index\s*100/i.test(s.display_name) || /step\s*100/i.test(s.display_name);
    });
    return byName ? byName.symbol : (symbols.find(s => /step/i.test(s.display_name))?.symbol || null);
  }

  function connect () {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    var url = usingFallback ? WS_URL_FALLBACK : WS_URL;
    setWsState('connecting');
    ws = new WebSocket(url);
    ws.addEventListener('open', function () {
      setWsState('connected');
      reconnectDelay = RECONNECT_BASE;
      failCount = 0; usingFallback = false;
      ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
    });
    ws.addEventListener('message', function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.error) return;
      if (msg.msg_type === 'active_symbols') {
        var sym = resolveSymbol(msg.active_symbols || []);
        if (sym) {
          resolvedSymbol = sym;
          const symEl = document.getElementById('tt-symbol');
          if (symEl) symEl.textContent = resolvedSymbol;
          ws.send(JSON.stringify({ ticks: resolvedSymbol, subscribe: 1 }));
        }
        return;
      }
      if (msg.msg_type === 'tick') { handleTick(msg.tick); }
    });
    ws.addEventListener('close', function (e) {
      setWsState('disconnected');
      resolvedSymbol = null;
      if (!manualClose) scheduleReconnect();
    });
    ws.addEventListener('error', function (e) {
      setWsState('disconnected');
      ws.close();
    });
  }

  function scheduleReconnect () {
    if (reconnectTimer) return;
    failCount++;
    if (failCount >= FALLBACK_AFTER) { usingFallback = !usingFallback; failCount = 0; }
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
  }

  function setWsState (state) {
    wsState = state;
    const el = document.getElementById('tt-status');
    if (!el) return;
    const dotClass = { connected: 'tt-dot-connected', connecting: 'tt-dot-connecting', disconnected: 'tt-dot-disconnected' };
    const label    = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected' };
    el.innerHTML = `<span class="tt-dot ${dotClass[state]}"></span>${label[state]}`;
  }

  // ── Tick handling ─────────────────────────────────────────────────────────
  function handleTick (tick) {
    if (!tick || tick.symbol !== resolvedSymbol) return;
    const price = parseFloat(tick.quote);
    const epoch = tick.epoch;
    const now   = Date.now();

    const prevTick = ticks.length ? ticks[ticks.length - 1] : null;
    const delta = prevTick ? price - prevTick.price : 0;
    const deltaSteps = delta / 0.1;
    const direction = delta > 0 ? 'UP' : (delta < 0 ? 'DOWN' : 'FLAT');
    const deltaTime = prevTick ? (now - prevTick.receivedAt) : 1000;
    const speed = deltaTime > 0 ? deltaSteps / deltaTime : 0;
    const lastDigit = Math.floor(Math.round(price * 100) / 10) % 10;
    const parity = lastDigit % 2;
    const deltaChange = prevTick ? deltaSteps - prevTick.deltaSteps : 0;

    const t0_state = {
        epoch, price, direction, deltaSteps, deltaTime, speed,
        lastDigit, parity, deltaChange,
        receivedAt: now
    };

    // Update streaks before push
    const prevUp = upStreak;
    const prevDown = downStreak;

    if (delta > 0) { upStreak++; downStreak = 0; }
    else if (delta < 0) { downStreak++; upStreak = 0; }
    else { upStreak = 0; downStreak = 0; }

    t0_state.upStreak = upStreak;
    t0_state.downStreak = downStreak;

    // Track Contexts
    if (upStreak === 0) lastUpPreContext = t0_state;
    if (upStreak === 1) lastUpStartContext = t0_state;
    if (downStreak === 0) lastDownPreContext = t0_state;
    if (downStreak === 1) lastDownStartContext = t0_state;

    // Update History for Patterns
    dirHistory.push(direction === 'UP' ? 'U' : (direction === 'DOWN' ? 'D' : 'F'));
    if (dirHistory.length > 20) dirHistory.shift();

    // ── Pattern Detection ──
    const patternFound = detectPatterns();

    // ── Log Events ──
    if (tickLogging) {
        // Streak Event
        if (upStreak >= 4 || downStreak >= 4) {
            logEvent('STREAK', t0_state, upStreak >= 4 ? lastUpPreContext : lastDownPreContext, upStreak >= 4 ? lastUpStartContext : lastDownStartContext);
        }
        // Pattern Event
        if (patternFound) {
            logEvent('PATTERN', t0_state, ticks[ticks.length - patternFound.length] || null, ticks[ticks.length - patternFound.length + 1] || null, patternFound.name);
        }
    }

    ticks.push(t0_state);
    if (ticks.length > TICK_BUF) ticks.shift();

    const priceEl = document.getElementById('tt-price');
    if (priceEl) priceEl.textContent = price.toFixed(2);
  }

  function detectPatterns() {
    if (dirHistory.length < 4) return null;
    // Look for repeating sequences of length 2, 3 or 4
    // Example: UUD UUD (len 3 repeating)
    for (let len = 2; len <= 4; len++) {
        if (dirHistory.length < len * 2) continue;
        const p1 = dirHistory.slice(-len * 2, -len).join('');
        const p2 = dirHistory.slice(-len).join('');
        // Match only if it's a fresh completion of the second repeat
        // and contains at least one movement (not just flat)
        if (p1 === p2 && (p1.includes('U') || p1.includes('D'))) {
            return { name: p1, length: len * 2 };
        }
    }
    return null;
  }

  function logEvent(type, current, pre, start, patternName = '') {
    // Only log if not a duplicate streak log (optional: log every tick of streak >=4 or just the first time? User said "Filter by streaks >= 4" so usually we log the moment it hits 4 and every tick thereafter is part of that streak)
    // To be safe, we log every tick that satisfies the condition.

    eventLog.push({
        event_type: type,
        pattern_name: patternName,

        t0_epoch:      current.epoch,
        t0_price:      current.price,
        t0_direction:  current.direction,
        t0_speed:      current.speed.toFixed(6),
        t0_delta_steps: current.deltaSteps.toFixed(1),
        t0_delta_time: current.deltaTime,
        t0_last_digit: current.lastDigit,
        t0_parity:     current.parity,
        t0_up_streak:  current.upStreak,
        t0_down_streak: current.downStreak,
        t0_delta_change: current.deltaChange.toFixed(1),

        pre_speed:     pre ? pre.speed.toFixed(6) : '',
        pre_delta_steps: pre ? pre.deltaSteps.toFixed(1) : '',
        pre_last_digit: pre ? pre.lastDigit : '',
        pre_delta_time: pre ? pre.deltaTime : '',
        pre_parity:    pre ? pre.parity : '',

        start_speed:   start ? start.speed.toFixed(6) : '',
        start_delta_steps: start ? start.deltaSteps.toFixed(1) : '',
        start_last_digit: start ? start.lastDigit : '',
        start_delta_time: start ? start.deltaTime : '',
        start_parity:  start ? start.parity : ''
    });

    if (eventLog.length > LOG_MAX) eventLog.shift();
    updateLogCount();
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportEventLog () {
    if (!eventLog.length) return;
    const headers = [
        'event_type', 'pattern_name',
        't0_epoch', 't0_price', 't0_direction', 't0_speed', 't0_delta_steps', 't0_delta_time',
        't0_last_digit', 't0_parity', 't0_up_streak', 't0_down_streak', 't0_delta_change',
        'pre_speed', 'pre_delta_steps', 'pre_last_digit', 'pre_delta_time', 'pre_parity',
        'start_speed', 'start_delta_steps', 'start_last_digit', 'start_delta_time', 'start_parity'
    ];
    const rows = [headers].concat(eventLog.map(r => headers.map(h => r[h])));
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = '3tick-micro-v3-' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function safeStorage (op, key, value) {
    try {
      if (op === 'get') return JSON.parse(localStorage.getItem(key));
      if (op === 'set') localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {} return null;
  }

  function init () {
    if (document.getElementById('tt-overlay')) return;
    buildOverlay();
    connect();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
