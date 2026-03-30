# 3Tick Terminal Collector V3.1 – Step Index 100 Assistant

A specialized high-resolution micro-timing data collector for [dtrader.deriv.com](https://dtrader.deriv.com) focused on **Step Index 100**. This version implements "Terminal Logging" to capture complete market sequences as single rows.

---

## Features (V3.1)

| Feature | Details |
|---|---|
| **Terminal Streak Logging** | Only logs a `STREAK` event once the move breaks (reversal or flat). If the final length is $\ge 4$, it records the entire move with its original pre-conditions. |
| **Two-Block Pattern Logic** | Detects patterns composed of two "Base Blocks" (e.g., `UUUD` + `UUD`). Only logs once the second block is completed. |
| **Streak Priority** | If a streak reaches 4+ ticks *during* a pattern attempt, the sequence is converted to a `STREAK` event and the pattern is reset. |
| **Zero-Redundancy Logs** | Removes "tick-by-tick" logging. Every row in the CSV represents a finalized, significant market event. |
| **Pre-Event Context** | Captures the exact market state (speed, parity, digit) *before* the first block of a pattern or the first tick of a streak. |

---

## Data Fields (CSV Columns)

### Event Identity
- **event_type:** `STREAK` or `PATTERN`.
- **pattern_name:** Final block sequence (e.g., `UUUD UUD`) for patterns.
- **final_streak:** Total length for streak events.

### Terminal State ($T_0$)
Captured at the moment the streak breaks or the 2nd pattern block completes.
- **t0_price / t0_direction:** Exit price and direction.
- **t0_speed / t0_delta_change:** Momentum at completion.
- **t0_last_digit / t0_parity:** Terminal digit state.

### Pre-Event Context (`pre_`)
Captured at the "Quiet" phase before the event launched.
- **pre_speed / pre_last_digit / pre_parity:** The momentum and pivot digit that launched the entire sequence.

### Start-Event Context (`start_`)
Captured at the "Trigger" (first tick of the first block).
- **start_speed / start_last_digit / start_parity:** The initial trigger state.

---

## License

MIT
