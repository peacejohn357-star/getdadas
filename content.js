/* ====================================================
 * 3Tick Scalper – Step Index 100 Data Collector
 * Content script for dtrader.deriv.com
 * ==================================================== */
(function () {
  'use strict';

  // ── Constants & config ────────────────────────────────────────────────────
  const WS_URL          = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  const WS_URL_FALLBACK = 'wss://ws.deriv.com/websockets/v3?app_id=1089';
  const FALLBACK_AFTER  = 3;     // consecutive failures before trying fallback endpoint
  const TICK_BUF        = 1000;
  const CANDLE_BUF      = 1000;
  const RECONNECT_BASE  = 4000;  // ms – initial reconnect delay
  const RECONNECT_MAX   = 64000; // ms – reconnect delay cap
  const TICK_LOG_MAX    = 50000; // maximum in-memory tick log rows

  // ── State ─────────────────────────────────────────────────────────────────
  let ticks       = [];  // { price: number, time: number }
  let candles     = [];  // { open, high, low, close, time }
  let tickLog     = [];  // in-memory tick log rows for data collection
  let tickLogging = false;

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
        <span class="tt-title">3Tick Data Collector</span>
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
          <span class="tt-label">Log Count</span>
          <span class="tt-val" id="tt-log-count">0</span>
        </div>

        <button id="tt-log-toggle">▶ Start Data Collection</button>
        <button id="tt-log-export">⬇ Export CSV</button>
        <button id="tt-log-clear" style="background:#3d1a1a;color:#e04040;margin-top:2px;">Clear Log</button>
      </div>
    `;

    document.body.appendChild(el);

    // Restore saved position
    const saved = safeStorage('get', 'tt-pos');
    if (saved) {
      el.style.right = 'auto';
      el.style.left  = saved.left + 'px';
      el.style.top   = saved.top  + 'px';
    }

    makeDraggable(el);
    bindButtons(el);
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
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

  // ── Button bindings ───────────────────────────────────────────────────────
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
      this.textContent = tickLogging ? '⏹ Stop Data Collection' : '▶ Start Data Collection';
      this.style.color = tickLogging ? '#e04040' : '#a0c8a0';
    });

    document.getElementById('tt-log-export').addEventListener('click', exportTickLog);

    document.getElementById('tt-log-clear').addEventListener('click', function() {
        if (confirm('Clear all logged data?')) {
            tickLog = [];
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
    if (byName) return byName.symbol;
    var step = symbols.find(function (s) {
      return /step/i.test(s.display_name);
    });
    return step ? step.symbol : null;
  }

  function connect () {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    var url = usingFallback ? WS_URL_FALLBACK : WS_URL;
    setWsState('connecting');
    ws = new WebSocket(url);

    ws.addEventListener('open', function () {
      setWsState('connected');
      reconnectDelay = RECONNECT_BASE;
      failCount     = 0;
      usingFallback = false;
      ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
    });

    ws.addEventListener('message', function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }

      if (msg.error) return;

      if (msg.msg_type === 'active_symbols') {
        var sym = resolveSymbol(msg.active_symbols || []);
        if (sym) {
          resolvedSymbol = sym;
          const symEl = document.getElementById('tt-symbol');
          if (symEl) symEl.textContent = resolvedSymbol;
          ws.send(JSON.stringify({ ticks: resolvedSymbol, subscribe: 1 }));
          ws.send(JSON.stringify({
            ticks_history: resolvedSymbol, subscribe: 1,
            granularity: 60, style: 'candles', count: CANDLE_BUF, end: 'latest',
          }));
        }
        return;
      }

      if (msg.msg_type === 'tick')         { handleTick(msg.tick); }
      else if (msg.msg_type === 'ohlc')    { handleOHLC(msg.ohlc); }
      else if (msg.msg_type === 'candles') { handleHistoryCandles(msg.candles); }
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
    if (!usingFallback && failCount >= FALLBACK_AFTER) {
      usingFallback = true;
      failCount = 0;
    } else if (usingFallback && failCount >= FALLBACK_AFTER) {
      usingFallback = false;
      failCount = 0;
    }
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

  // ── Indicators ────────────────────────────────────────────────────────────

  function calcEMA (period, data) {
    const k = 2 / (period + 1);
    const result = [];
    let ema = NaN;
    let count = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      if (isNaN(data[i])) {
        result.push(NaN);
        continue;
      }
      if (isNaN(ema)) {
        count++;
        sum += data[i];
        if (count === period) {
          ema = sum / period;
        }
      } else {
        ema = data[i] * k + ema * (1 - k);
      }
      result.push(isNaN(ema) ? NaN : ema);
    }
    return result;
  }

  function calcSMA (period, data) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i + 1 < period) {
        result.push(NaN);
      } else {
        let sum = 0;
        let count = 0;
        for (let j = i - period + 1; j <= i; j++) {
            if (!isNaN(data[j])) {
                sum += data[j];
                count++;
            }
        }
        result.push(count === period ? sum / period : NaN);
      }
    }
    return result;
  }

  function calcMACD (data, fast = 12, slow = 26, signal = 9) {
    const emaFast = calcEMA(fast, data);
    const emaSlow = calcEMA(slow, data);
    const macdLine = emaFast.map((f, i) => (isNaN(f) || isNaN(emaSlow[i])) ? NaN : f - emaSlow[i]);
    const signalLineArr = calcEMA(signal, macdLine);
    const m = macdLine[macdLine.length - 1];
    const s = signalLineArr[signalLineArr.length - 1];
    return { macd: m, signal: s, hist: (isNaN(m) || isNaN(s)) ? NaN : m - s };
  }

  function calcRSI (data, period = 14) {
    if (data.length < period + 1) return NaN;
    let avgGain = 0, avgLoss = 0;

    // Initial SMA of gains/losses
    let firstGain = 0, firstLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) firstGain += diff;
      else          firstLoss += Math.abs(diff);
    }
    avgGain = firstGain / period;
    avgLoss = firstLoss / period;

    // Wilders smoothing
    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      const g = diff > 0 ? diff : 0;
      const l = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function calcBollinger (data, period = 14, stdDevMult = 2) {
    const emaArr = calcEMA(period, data);
    const mid = emaArr[emaArr.length - 1];
    if (isNaN(mid)) return { top: NaN, mid: NaN, bottom: NaN };

    const lastN = data.slice(-period);
    const mean = lastN.reduce((a, b) => a + b, 0) / period;
    const variance = lastN.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return { top: mid + stdDevMult * stdDev, mid: mid, bottom: mid - stdDevMult * stdDev };
  }

  function calcStchMtm(candles, period = 10, smooth1 = 3, smooth2 = 3, signal = 10) {
    if (candles.length < period) return { smi: NaN, signal: NaN };

    const diffs = [];
    const ranges = [];

    for (let i = 0; i < candles.length; i++) {
        const start = i - period + 1;
        if (start < 0) {
            diffs.push(NaN);
            ranges.push(NaN);
            continue;
        }
        const window = candles.slice(start, i + 1);
        const low = Math.min(...window.map(c => c.low));
        const high = Math.max(...window.map(c => c.high));
        const mid = (high + low) / 2;
        diffs.push(candles[i].close - mid);
        ranges.push(high - low);
    }

    const ema1_diff = calcEMA(smooth1, diffs);
    const ema2_diff = calcEMA(smooth2, ema1_diff);

    const ema1_range = calcEMA(smooth1, ranges);
    const ema2_range = calcEMA(smooth2, ema1_range);

    const smiArr = [];
    for (let i = 0; i < ema2_diff.length; i++) {
        const d = ema2_diff[i];
        const r = ema2_range[i];
        if (isNaN(d) || isNaN(r) || r === 0) {
            smiArr.push(NaN);
        } else {
            smiArr.push(100 * (d / (r / 2)));
        }
    }

    const signalArr = calcEMA(signal, smiArr);

    return {
        smi: smiArr[smiArr.length - 1],
        signal: signalArr[signalArr.length - 1]
    };
  }

  // ── Tick handling ─────────────────────────────────────────────────────────
  function handleTick (tick) {
    if (!tick || tick.symbol !== resolvedSymbol) return;
    const price = parseFloat(tick.quote);
    const time  = tick.epoch;

    ticks.push({ price, time });
    if (ticks.length > TICK_BUF) ticks.shift();

    const priceEl = document.getElementById('tt-price');
    if (priceEl) priceEl.textContent = price.toFixed(2);

    if (tickLogging) {
      const prices = ticks.map(t => t.price);

      // Update/Append current tick to candles to get real-time indicators
      let updatedCandles = [...candles];
      let lastCandle = updatedCandles[updatedCandles.length - 1];

      if (lastCandle && time < lastCandle.time + 60) {
          updatedCandles[updatedCandles.length - 1] = {
              ...lastCandle,
              close: price,
              high: Math.max(lastCandle.high, price),
              low: Math.min(lastCandle.low, price)
          };
      } else {
          updatedCandles.push({
              open: price, high: price, low: price, close: price, time: Math.floor(time / 60) * 60
          });
      }

      const closes = updatedCandles.map(c => c.close);

      const bb = calcBollinger(closes, 14, 2);
      const macd = calcMACD(closes, 12, 26, 9);
      const rsi = calcRSI(closes, 14);
      const stoch = calcStchMtm(updatedCandles, 10, 3, 3, 10);
      const ema4Arr = calcEMA(4, prices);
      const ema4 = ema4Arr[ema4Arr.length - 1];

      tickLog.push({
        epoch: time,
        iso_time: new Date(time * 1000).toISOString(),
        price: price,
        bb_top: bb.top,
        bb_mid: bb.mid,
        bb_bottom: bb.bottom,
        macd_line: macd.macd,
        macd_signal: macd.signal,
        macd_hist: macd.hist,
        rsi: rsi,
        smi: stoch.smi,
        smi_signal: stoch.signal,
        ema4: ema4
      });

      if (tickLog.length > TICK_LOG_MAX) tickLog.shift();
      updateLogCount();
    }
  }

  // ── Candle handling ───────────────────────────────────────────────────────
  function handleHistoryCandles (batch) {
    if (!Array.isArray(batch)) return;
    batch.forEach(function (c) {
      candles.push({ open: +c.open, high: +c.high, low: +c.low, close: +c.close, time: +c.epoch });
    });
    candles.sort(function (a, b) { return a.time - b.time; });
    if (candles.length > CANDLE_BUF) candles.splice(0, candles.length - CANDLE_BUF);
  }

  function handleOHLC (ohlc) {
    if (!ohlc || ohlc.symbol !== resolvedSymbol) return;
    const c = { open: +ohlc.open, high: +ohlc.high, low: +ohlc.low, close: +ohlc.close, time: +ohlc.open_time };
    if (candles.length && candles[candles.length - 1].time === c.time) {
      candles[candles.length - 1] = c;
    } else {
      candles.push(c);
      if (candles.length > CANDLE_BUF) candles.shift();
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportTickLog () {
    if (!tickLog.length) return;
    const headers = ['epoch', 'iso_time', 'price', 'bb_top', 'bb_mid', 'bb_bottom', 'macd_line', 'macd_signal', 'macd_hist', 'rsi', 'stochastic_smi', 'stochastic_signal', 'ema4'];
    const rows = [headers].concat(tickLog.map(function (r) {
      return [
        r.epoch,
        r.iso_time,
        r.price,
        isValid(r.bb_top) ? r.bb_top.toFixed(4) : '',
        isValid(r.bb_mid) ? r.bb_mid.toFixed(4) : '',
        isValid(r.bb_bottom) ? r.bb_bottom.toFixed(4) : '',
        isValid(r.macd_line) ? r.macd_line.toFixed(6) : '',
        isValid(r.macd_signal) ? r.macd_signal.toFixed(6) : '',
        isValid(r.macd_hist) ? r.macd_hist.toFixed(6) : '',
        isValid(r.rsi) ? r.rsi.toFixed(4) : '',
        isValid(r.smi) ? r.smi.toFixed(4) : '',
        isValid(r.smi_signal) ? r.smi_signal.toFixed(4) : '',
        isValid(r.ema4) ? r.ema4.toFixed(4) : ''
      ];
    }));
    const csv  = rows.map(function (r) { return r.join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = '3tick-data-' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function isValid(val) {
      return val !== undefined && val !== null && !isNaN(val) && isFinite(val);
  }

  // ── Local-storage helpers ─────────────────────────────────────────────────
  function safeStorage (op, key, value) {
    try {
      if (op === 'get')  return JSON.parse(localStorage.getItem(key));
      if (op === 'set')  localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
    return null;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init () {
    if (document.getElementById('tt-overlay')) return;
    buildOverlay();
    connect();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
