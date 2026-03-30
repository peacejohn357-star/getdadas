# 3Tick Micro-Timing Collector V3 – Step Index 100 Assistant

A specialized high-resolution micro-timing data collector for [dtrader.deriv.com](https://dtrader.deriv.com) focused on **Step Index 100**. This version is refined for **Streak** and **Pattern** analysis, capturing the "DNA" of market moves before they accelerate.

---

## Features (V3)

| Feature | Details |
|---|---|
| **Streak Filtering** | Automatically filters and logs only meaningful moves where the continuous UP or DOWN streak is $\ge 4$. |
| **Pre-Streak Context** | Captures the exact market state (speed, parity, digit) *before* a streak begins (`streak=0`) and at the *start* (`streak=1`). |
| **Pattern Detection** | Detects and records repeating micro-sequences (e.g., `UUD`, `DDU`) of length 2–4 with their preceding context. |
| **Micro-Timing Fields** | Includes `t0_parity` (Last Digit % 2) and `t0_delta_change` (Acceleration) for tick-modulo sensitivity analysis. |
| **Unified Event Log** | Buffers up to 50,000 finalized event rows in-memory for deep statistical research. |

---

## Data Fields (CSV Columns)

The dataset captures the **Market State ($T_0$)** and its **Context (Pre/Start)**.

### Event Identity
- **event_type:** `STREAK` or `PATTERN`.
- **pattern_name:** The detected sequence (e.g., `UUD`, `DDU`) for pattern events.

### Current State ($T_0$)
- **t0_epoch / t0_price:** The timestamp and price at the event tick.
- **t0_direction:** UP/DOWN/FLAT.
- **t0_speed:** Momentum as `delta_steps / delta_time`.
- **t0_last_digit / t0_parity:** The first decimal digit and its parity (Even/Odd).
- **t0_up_streak / t0_down_streak:** Current consecutive tick counts.
- **t0_delta_change:** Momentum change (Acceleration).

### Pre-Event Context (`pre_`)
Captured at `streak = 0` (the "Quiet" before the move).
- **pre_speed / pre_delta_steps:** Momentum state before the streak started.
- **pre_last_digit / pre_parity:** The "Pivot" digit and parity that launched the move.

### Start-Event Context (`start_`)
Captured at `streak = 1` (the "Trigger" of the move).
- **start_speed / start_delta_steps:** The initial momentum at the first tick of the move.
- **start_last_digit / start_parity:** The "Trigger" digit and parity.

---

## Installation (unpacked extension)

1. **Download / clone this repository.**
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder.
5. Navigate to [https://dtrader.deriv.com](https://dtrader.deriv.com).

---

## Usage

1. **Start Collection:** Click **▶ Start Collection**. The collector will only log ticks when a streak $\ge 4$ is hit or a pattern is detected.
2. **Monitoring:** "Events Logged" shows the count of captured scenarios.
3. **Export:** Click **⬇ Export CSV** to download the high-resolution dataset.

---

## License

MIT
