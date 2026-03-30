/* ====================================================
 * 3Tick Scalper – Step Index 100 Micro-Timing V3 Collector
 * Content script for dtrader.deriv.com
 * Terminal Event Refinement (V3.1)
 * ==================================================== */
(function () {
  'use strict';

  const WS_URL          = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  const WS_URL_FALLBACK = 'wss://ws.deriv.com/websockets/v3?app_id=1089';
  const FALLBACK_AFTER  = 3;
  const TICK_BUF        = 1000;
  const RECONNECT_BASE  = 4000;
  const RECONNECT_MAX   = 64000;
  const LOG_MAX         = 50000;

  // ── State ─────────────────────────────────────────────────────────────────
  let ticks       = [];
  let eventLog    = [];
  let tickLogging = false;

  let upStreak    = 0;
  let downStreak  = 0;
  let dirHistory  = [];

  // Terminal Streak Trackers
  let currentStreakActive = false;
  let streakPreContext    = null;
  let streakStartContext  = null;
  let streakMaxLen        = 0;

  // Pattern Tracker (Finite State Machine)
  // State: 0=idle, 1=first_block_captured
  let patternState = 0;
  let firstBlock   = '';
  let patternPre   = null;
  let patternStart = null;

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
        <span class="tt-title">3Tick Timing V3.1</span>
        <div class="tt-header-btns">
          <button id="tt-min-btn"   title="Minimise">_</button>
          <button id="tt-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div id="tt-body">
        <div class="tt-row"><span class="tt-label">Status</span><span class="tt-val" id="tt-status"><span class="tt-dot tt-dot-disconnected"></span>Disconnected</span></div>
        <div class="tt-row"><span class="tt-label">Symbol</span><span class="tt-val" id="tt-symbol">–</span></div>
        <div class="tt-row"><span class="tt-label">Last Price</span><span class="tt-val" id="tt-price">–</span></div>
        <div class="tt-row"><span class="tt-label">Terminal Events</span><span class="tt-val" id="tt-log-count">0</span></div>
        <button id="tt-log-toggle">▶ Start Collection</button>
        <button id="tt-log-export">⬇ Export CSV</button>
        <button id="tt-log-clear" style="background:#3d1a1a;color:#e04040;margin-top:2px;">Clear Log</button>
      </div>
    `;
    document.body.appendChild(el);
    const saved = safeStorage('get', 'tt-pos');
    if (saved) { el.style.left = saved.left + 'px'; el.style.top = saved.top + 'px'; el.style.right = 'auto'; }
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
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    function onMove (e) {
      const left = e.clientX - ox; const top = e.clientY - oy;
      el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, left)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, top)) + 'px';
      el.style.right = 'auto';
    }
    function onUp () {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      safeStorage('set', 'tt-pos', { left: parseInt(el.style.left), top: parseInt(el.style.top) });
    }
  }

  function bindButtons (el) {
    document.getElementById('tt-min-btn').addEventListener('click', () => { el.classList.toggle('tt-minimized'); document.getElementById('tt-min-btn').textContent = el.classList.contains('tt-minimized') ? '□' : '_'; });
    document.getElementById('tt-close-btn').addEventListener('click', () => { manualClose = true; if (reconnectTimer) clearTimeout(reconnectTimer); if (ws) ws.close(); el.remove(); });
    const logToggleBtn = document.getElementById('tt-log-toggle');
    logToggleBtn.addEventListener('click', function () {
      tickLogging = !tickLogging;
      this.textContent = tickLogging ? '⏹ Stop Collection' : '▶ Start Collection';
      this.style.color = tickLogging ? '#e04040' : '#a0c8a0';
    });
    document.getElementById('tt-log-export').addEventListener('click', exportEventLog);
    document.getElementById('tt-log-clear').addEventListener('click', () => { if (confirm('Clear all logged data?')) { eventLog = []; updateLogCount(); } });
  }

  function updateLogCount() { const el = document.getElementById('tt-log-count'); if (el) el.textContent = eventLog.length; }

  // ── WebSocket Logic ───────────────────────────────────────────────────────
  function resolveSymbol (symbols) {
    var candidates = ['stpRNG', 'STPRNG'];
    for (var i = 0; i < candidates.length; i++) { if (symbols.find(s => s.symbol === candidates[i])) return candidates[i]; }
    var byName = symbols.find(s => /step\s*index\s*100/i.test(s.display_name));
    return byName ? byName.symbol : (symbols.find(s => /step/i.test(s.display_name))?.symbol || null);
  }

  function connect () {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setWsState('connecting');
    ws = new WebSocket(usingFallback ? WS_URL_FALLBACK : WS_URL);
    ws.addEventListener('open', () => { setWsState('connected'); reconnectDelay = RECONNECT_BASE; failCount = 0; ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' })); });
    ws.addEventListener('message', e => {
      var msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.msg_type === 'active_symbols') { resolvedSymbol = resolveSymbol(msg.active_symbols || []); if (resolvedSymbol) { document.getElementById('tt-symbol').textContent = resolvedSymbol; ws.send(JSON.stringify({ ticks: resolvedSymbol, subscribe: 1 })); } }
      if (msg.msg_type === 'tick') handleTick(msg.tick);
    });
    ws.addEventListener('close', () => { setWsState('disconnected'); resolvedSymbol = null; if (!manualClose) scheduleReconnect(); });
    ws.addEventListener('error', () => ws.close());
  }

  function scheduleReconnect () {
    if (reconnectTimer) return;
    if (++failCount >= FALLBACK_AFTER) { usingFallback = !usingFallback; failCount = 0; }
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
  }

  function setWsState (state) {
    const el = document.getElementById('tt-status'); if (!el) return;
    const dotClass = { connected: 'tt-dot-connected', connecting: 'tt-dot-connecting', disconnected: 'tt-dot-disconnected' };
    const label = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected' };
    el.innerHTML = `<span class="tt-dot ${dotClass[state]}"></span>${label[state]}`;
  }

  // ── Tick Handling & Terminal Logic ────────────────────────────────────────
  function handleTick (tick) {
    if (!tick || tick.symbol !== resolvedSymbol) return;
    const price = parseFloat(tick.quote);
    const now   = Date.now();
    const prev  = ticks.length ? ticks[ticks.length - 1] : null;

    const delta = prev ? price - prev.price : 0;
    const direction = delta > 0 ? 'UP' : (delta < 0 ? 'DOWN' : 'FLAT');
    const lastDigit = Math.floor(Math.round(price * 100) / 10) % 10;

    const state = {
        epoch: tick.epoch, price, direction, lastDigit,
        deltaSteps: delta / 0.1,
        deltaTime: prev ? (now - prev.receivedAt) : 1000,
        speed: prev ? (delta / 0.1) / (now - prev.receivedAt) : 0,
        parity: lastDigit % 2,
        deltaChange: prev ? (delta/0.1) - prev.deltaSteps : 0,
        receivedAt: now
    };

    // 1. Update Streaks
    const oldUp = upStreak, oldDown = downStreak;
    if (direction === 'UP') { upStreak++; downStreak = 0; }
    else if (direction === 'DOWN') { downStreak++; upStreak = 0; }
    else { upStreak = 0; downStreak = 0; }
    state.upStreak = upStreak; state.downStreak = downStreak;

    // 2. Terminal Streak Logic (Record only on break)
    processTerminalStreak(state, oldUp, oldDown);

    // 3. Pattern State Machine (Record only on 2nd block completion)
    processPatternSM(state);

    ticks.push(state);
    if (ticks.length > TICK_BUF) ticks.shift();
    document.getElementById('tt-price').textContent = price.toFixed(2);
  }

  function processTerminalStreak(current, oldUp, oldDown) {
    // 1. Detect Break (Direction change or Flat) BEFORE handling new streak
    const upBroken = (upStreak === 0 && oldUp > 0);
    const downBroken = (downStreak === 0 && oldDown > 0);

    if ((upBroken || downBroken) && currentStreakActive) {
        if (streakMaxLen >= 4 && tickLogging) {
            logEvent('STREAK', current, streakPreContext, streakStartContext, '', streakMaxLen);
        }
        currentStreakActive = false;
        streakMaxLen = 0;
    }

    // 2. Detect Start of a NEW streak
    if ((upStreak === 1 && oldUp === 0) || (downStreak === 1 && oldDown === 0)) {
        streakPreContext = ticks.length ? ticks[ticks.length - 1] : current;
        streakStartContext = current;
        currentStreakActive = true;
        streakMaxLen = 1;
    }

    // 3. Detect Progress of ACTIVE streak
    if (currentStreakActive) {
        streakMaxLen = Math.max(streakMaxLen, upStreak, downStreak);
    }
  }

  function processPatternSM(current) {
    // dirHistory tracking
    dirHistory.push(current.direction === 'UP' ? 'U' : (current.direction === 'DOWN' ? 'D' : 'F'));
    if (dirHistory.length > 20) dirHistory.shift();

    // Reset pattern if a streak >= 4 happens
    if (upStreak >= 4 || downStreak >= 4) {
        patternState = 0; firstBlock = ''; return;
    }

    // Check for a completed "Base Block" (e.g., UUD, UUUD)
    // A block is completed when direction flips AFTER a streak of 2 or 3
    const prev = ticks.length ? ticks[ticks.length - 1] : null;
    if (!prev) return;

    const blockJustFinished = (prev.upStreak >= 2 && prev.upStreak <= 3 && current.direction === 'DOWN') ||
                              (prev.downStreak >= 2 && prev.downStreak <= 3 && current.direction === 'UP');

    if (blockJustFinished) {
        const blockName = (prev.upStreak > 0 ? 'U'.repeat(prev.upStreak) + 'D' : 'D'.repeat(prev.downStreak) + 'U');

        if (patternState === 0) {
            // Start of a potential pattern
            patternState = 1;
            firstBlock = blockName;
            const lookback = prev.upStreak || prev.downStreak;
            patternPre = ticks[ticks.length - lookback] || prev;
            patternStart = ticks[ticks.length - lookback + 1] || current;
        }
        else if (patternState === 1) {
            // Check if 2nd block has the SAME direction as the 1st
            const firstDir = firstBlock[0]; // 'U' or 'D'
            const secondDir = blockName[0];

            if (firstDir === secondDir) {
                // Completion of the 2nd block (Matching Direction)
                if (tickLogging) {
                    logEvent('PATTERN', current, patternPre, patternStart, firstBlock + ' ' + blockName);
                }
                patternState = 0; // Reset
                firstBlock = '';
            } else {
                // Direction flipped: 2nd block becomes the new 1st block
                firstBlock = blockName;
                const lookback = prev.upStreak || prev.downStreak;
                patternPre = ticks[ticks.length - lookback] || prev;
                patternStart = ticks[ticks.length - lookback + 1] || current;
            }
        }
    }

    // Reset if block is too long (streak handled it)
    if (current.upStreak > 3 || current.downStreak > 3) {
        patternState = 0; firstBlock = '';
    }
  }

  function logEvent(type, current, pre, start, patternName = '', streakLen = 0) {
    eventLog.push({
        event_type: type,
        pattern_name: patternName,
        final_streak: streakLen || (type === 'STREAK' ? current.upStreak || current.downStreak : 0),
        t0_epoch:      current.epoch,
        t0_price:      current.price,
        t0_direction:  current.direction,
        t0_speed:      current.speed.toFixed(6),
        t0_delta_steps: current.deltaSteps.toFixed(1),
        t0_last_digit: current.lastDigit,
        t0_parity:     current.parity,
        t0_delta_change: current.deltaChange.toFixed(1),
        pre_speed:     pre ? pre.speed.toFixed(6) : '',
        pre_last_digit: pre ? pre.lastDigit : '',
        pre_parity:    pre ? pre.parity : '',
        start_speed:   start ? start.speed.toFixed(6) : '',
        start_last_digit: start ? start.lastDigit : '',
        start_parity:  start ? start.parity : ''
    });
    if (eventLog.length > LOG_MAX) eventLog.shift();
    updateLogCount();
  }

  function exportEventLog () {
    if (!eventLog.length) return;
    const headers = ['event_type', 'pattern_name', 'final_streak', 't0_epoch', 't0_price', 't0_direction', 't0_speed', 't0_delta_steps', 't0_last_digit', 't0_parity', 't0_delta_change', 'pre_speed', 'pre_last_digit', 'pre_parity', 'start_speed', 'start_last_digit', 'start_parity'];
    const rows = [headers].concat(eventLog.map(r => headers.map(h => r[h])));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '3tick-terminal-v3.1-' + Date.now() + '.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function safeStorage (op, key, value) { try { if (op === 'get') return JSON.parse(localStorage.getItem(key)); if (op === 'set') localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} return null; }
  function init () { if (!document.getElementById('tt-overlay')) { buildOverlay(); connect(); } }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
