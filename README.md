# 3Tick Timing Collector – Step Index 100 Assistant

A Chrome extension that overlays a micro-timing data collector on [dtrader.deriv.com](https://dtrader.deriv.com) for **Step Index 100**. This tool captures price action and lightweight indicators at a decision tick ($T_0$) and automatically labels the outcome based on the next three ticks ($T_1, T_2, T_3$).

---

## Features

| Feature | Details |
|---|---|
| **Live Tick Feed** | Streams Step Index 100 ticks via the public Deriv WebSocket (`wss://ws.deriv.com/websockets/v3?app_id=1089`). |
| **Micro-Timing Dataset** | Captures $T_0$ features: direction, delta, speed, streaks, last digit, EMA(4) distance, RSI(14), and 5nd-tick volatility. |
| **Auto-Labeling** | Tracks the three ticks following every $T_0$ and calculates WIN/LOSS labels for both BUY and SELL entries. |
| **Finalized Logging** | Buffers up to 50,000 finalized $T_0$–$T_3$ sequences in-memory during a session. |
| **CSV Export** | One-click export of all collected timing data as a `.csv` file for ML training or pattern analysis. |

---

## Data Fields (CSV Columns)

The collector exports a detailed dataset designed to answer: *"At this exact tick, should I enter or not?"*

### At Decision Tick ($T_0$)
- **t0_epoch / t0_price:** The timestamp and price at the moment of decision.
- **t0_direction / t0_delta:** The direction (UP/DOWN/FLAT) and price change from the previous tick.
- **t0_delta_time:** Time in milliseconds since the previous tick (Speed).
- **t0_up_streak / t0_down_streak:** Number of consecutive ticks moving in the same direction.
- **t0_last_digit:** The first decimal digit of the price (Step Index behavior).
- **t0_ema4_dist:** Distance between the current price and a fast 4-period EMA.
- **t0_rsi:** Standard 14-period RSI calculated on a per-tick basis.
- **volatility_5:** Standard deviation of the last 5 tick prices.

### Outcomes ($T_1$ to $T_3$)
- **entry_price_t1:** The price at the next tick (the likely entry price for a $T_0$ click).
- **t1_price, t2_price, t3_price:** The prices at the three ticks following $T_0$.
- **buy_win:** `1` if $T_3 \ge T_1$, else `0`.
- **sell_win:** `1` if $T_3 \le T_1$, else `0`.

---

## Installation (unpacked extension)

1. **Download / clone this repository.**
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Navigate to [https://dtrader.deriv.com](https://dtrader.deriv.com).
   The **3Tick Timing Collector** panel appears on the page.

---

## Usage

1. **Connection:** The extension automatically connects to the Deriv WebSocket and resolves the Step Index 100 symbol.
2. **Start Collection:** Click **▶ Start Collection** to begin capturing and auto-labeling tick sequences.
3. **Monitoring:** "Collected Logs" shows the count of finalized $T_0$–$T_3$ sequences ready for export.
4. **Stop Collection:** Click **⏹ Stop Collection** to pause the collector.
5. **Export:** Click **⬇ Export CSV** to download the dataset.
6. **Clear:** Use **Clear Log** to purge the session buffer.

---

## License

MIT
