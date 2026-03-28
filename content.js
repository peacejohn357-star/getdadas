/* ====================================================
 * 3Tick Scalper – Step Index 100 Micro-Timing Data Collector
 * Content script for dtrader.deriv.com
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
  const TICK_LOG_MAX    = 50000;

  // ── State ─────────────────────────────────────────────────────────────────
  let ticks       = [];  // { price, epoch, delta, direction, deltaTime, lastDigit, ema4, rsi, vol5 }
  let pendingLogs = [];  // logs waiting for T1, T2, T3 (max 4 per log: T0-T3)
  let tickLog     = [];  // finalized micro-timing logs
  let tickLogging = false;

  let upStreak = 0;
  let downStreak = 0;

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
        <span class="tt-title">3Tick Timing Collector</span>
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
          <span class="tt-label">Collected Logs</span>
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
    document.getElementById('tt-log-export').addEventListener('click', exportTickLog);
    document.getElementById('tt-log-clear').addEventListener('click', function() {
        if (confirm('Clear all logged data?')) {
            tickLog = [];
            pendingLogs = [];
            updateLogCount();
        }
    });
  }

  function updateLogCount() {
    const el = document.getElementById('tt-log-count');
    if (el) el.textContent = tickLog.length;
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

  // ── Indicators (Pure Tick-Based) ──────────────────────────────────────────
  function calcEMA (period, data) {
    const k = 2 / (period + 1);
    let ema = NaN;
    for (let i = 0; i < data.length; i++) {
        if (isNaN(ema)) {
            if (i === period - 1) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += data[j];
                ema = sum / period;
            }
        } else {
            ema = data[i] * k + ema * (1 - k);
        }
    }
    return ema;
  }

  function calcRSI (data, period = 14) {
    if (data.length < period + 1) return NaN;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const g = diff > 0 ? diff : 0, l = diff < 0 ? Math.abs(diff) : 0;
        avgG = (avgG * (period - 1) + g) / period;
        avgL = (avgL * (period - 1) + l) / period;
    }
    return avgL === 0 ? 100 : 100 - (100 / (1 + (avgG / avgL)));
  }

  function calcVol5 (data) {
    if (data.length < 5) return NaN;
    const last5 = data.slice(-5);
    const mean = last5.reduce((a, b) => a + b, 0) / 5;
    const variance = last5.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 5;
    return Math.sqrt(variance);
  }

  // ── Tick handling ─────────────────────────────────────────────────────────
  function handleTick (tick) {
    if (!tick || tick.symbol !== resolvedSymbol) return;
    const price = parseFloat(tick.quote);
    const epoch = tick.epoch;
    const now   = Date.now();

    const prevTick = ticks.length ? ticks[ticks.length - 1] : null;
    const delta = prevTick ? price - prevTick.price : 0;
    const direction = delta > 0 ? 'UP' : (delta < 0 ? 'DOWN' : 'FLAT');
    const deltaTime = prevTick ? (now - prevTick.receivedAt) : 0;
    const lastDigit = Math.floor(Math.round(price * 100) / 10) % 10; // Accurate for Step Index 100 (2 decimals)

    if (delta > 0) { upStreak++; downStreak = 0; }
    else if (delta < 0) { downStreak++; upStreak = 0; }
    else { upStreak = 0; downStreak = 0; }

    const prices = ticks.map(t => t.price).concat(price);
    const ema4 = calcEMA(4, prices);
    const rsi = calcRSI(prices, 14);
    const vol5 = calcVol5(prices);

    const currentTick = {
        price, epoch, delta, direction, deltaTime, lastDigit,
        upStreak, downStreak, ema4, rsi, vol5,
        receivedAt: now
    };
    ticks.push(currentTick);
    if (ticks.length > TICK_BUF) ticks.shift();

    const priceEl = document.getElementById('tt-price');
    if (priceEl) priceEl.textContent = price.toFixed(2);

    // ── Future Ticks & Auto-Labeling ──
    pendingLogs.forEach(log => {
        if (log.t1 === null) log.t1 = price;
        else if (log.t2 === null) log.t2 = price;
        else if (log.t3 === null) {
            log.t3 = price;
            // Finalize log
            finalizeLog(log);
        }
    });
    pendingLogs = pendingLogs.filter(log => log.t3 === null);

    if (tickLogging) {
        pendingLogs.push({
            t0: currentTick,
            t1: null,
            t2: null,
            t3: null
        });
    }
  }

  function finalizeLog(log) {
    const t0 = log.t0;
    const entryPriceT1 = log.t1;
    const t3Price = log.t3;

    tickLog.push({
        t0_epoch:      t0.epoch,
        t0_price:      t0.price,
        t0_direction:  t0.direction,
        t0_delta:      t0.delta.toFixed(2),
        t0_delta_time: t0.deltaTime,
        t0_up_streak:  t0.upStreak,
        t0_down_streak: t0.downStreak,
        t0_last_digit: t0.lastDigit,
        t0_ema4_dist:  (t0.price - t0.ema4).toFixed(4),
        t0_rsi:        isNaN(t0.rsi) ? '' : t0.rsi.toFixed(2),
        volatility_5:  isNaN(t0.vol5) ? '' : t0.vol5.toFixed(4),
        entry_price_t1: entryPriceT1,
        t1_price:      log.t1,
        t2_price:      log.t2,
        t3_price:      log.t3,
        buy_win:       t3Price >= entryPriceT1 ? 1 : 0,
        sell_win:      t3Price <= entryPriceT1 ? 1 : 0
    });

    if (tickLog.length > TICK_LOG_MAX) tickLog.shift();
    updateLogCount();
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportTickLog () {
    if (!tickLog.length) return;
    const headers = ['t0_epoch', 't0_price', 't0_direction', 't0_delta', 't0_delta_time', 't0_up_streak', 't0_down_streak', 't0_last_digit', 't0_ema4_dist', 't0_rsi', 'volatility_5', 'entry_price_t1', 't1_price', 't2_price', 't3_price', 'buy_win', 'sell_win'];
    const rows = [headers].concat(tickLog.map(r => headers.map(h => r[h])));
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = '3tick-timing-' + Date.now() + '.csv';
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
