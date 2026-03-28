# 3Tick Timing Collector V2 – Step Index 100 Assistant

A specialized micro-timing data collector for [dtrader.deriv.com](https://dtrader.deriv.com) for **Step Index 100**. This version is designed to create a robust dataset for 3-tick execution modeling by capturing market state at $T_0$ and simulating multiple entry delays (offsets) to find outcomes.

---

## Features

| Feature | Details |
|---|---|
| **Micro-Momentum State** | Captures $T_0$ features: direction, delta steps (0.1 units), speed, streaks, last digit, and delta change (momentum). |
| **Execution Delay Simulation** | For each $T_0$ tick, the collector simulates 3 separate entry scenarios: 1-tick (ideal), 2-tick (realistic), and 3-tick (worst-case) delay. |
| **Auto-Labeling** | Tracks the 6 ticks following every $T_0$ to calculate outcomes for each entry offset scenario ($T_{offset+3}$ vs $T_{offset}$). |
| **Finalized Logging** | Buffers up to 100,000 finalized rows in-memory (3 rows per captured tick). |
| **CSV Export** | One-click export of the full timing dataset as a `.csv` file for ML training or statistical analysis. |

---

## Data Fields (CSV Columns)

The dataset models the STATE at $T_0$ and the OUTCOME after $T_{offset} + 3$ ticks.

### Decision State ($T_0$)
- **t0_epoch / t0_price:** The timestamp and price at the moment of decision.
- **t0_direction:** The direction (UP/DOWN/FLAT) relative to the previous tick.
- **t0_delta_steps:** Change in price divided by 0.1 (Step Index tick size).
- **t0_delta_time:** Time in milliseconds since the previous tick.
- **t0_speed:** Momentum calculated as `delta_steps / delta_time`.
- **t0_up_streak / t0_down_streak:** Number of consecutive ticks moving in the same direction.
- **t0_last_digit:** The first decimal digit of the price (statistical edge).
- **t0_delta_change:** Momentum change (`current_delta_steps - previous_delta_steps`).

### Entry Offset Simulation
- **entry_offset:** Simulated delay from decision ($1, 2,$ or $3$ ticks).
- **entry_price:** The price at the simulated entry tick ($T_{offset}$).
- **t1, t2, t3:** The prices at the three ticks following the entry ($T_{offset+1}$ to $T_{offset+3}$).
- **buy_win:** `1` if $t_3 \ge entry\_price$, else `0`.
- **sell_win:** `1` if $t_3 \le entry\_price$, else `0`.

---

## Installation (unpacked extension)

1. **Download / clone this repository.**
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder.
5. Navigate to [https://dtrader.deriv.com](https://dtrader.deriv.com).
   The **3Tick Timing V2** panel appears on the page.

---

## Usage

1. **Connection:** The extension automatically connects to the Deriv WebSocket and resolves the Step Index 100 symbol.
2. **Start Collection:** Click **▶ Start Collection** to begin capturing and auto-labeling tick sequences.
3. **Monitoring:** "Finalized Rows" shows the count of captured timing scenarios.
4. **Stop Collection:** Click **⏹ Stop Collection** to pause the collector.
5. **Export:** Click **⬇ Export CSV** to download the dataset.
6. **Clear:** Use **Clear Log** to purge the session buffer.

---

## License

MIT
