# 3Tick Data Collector – Step Index 100 Assistant

A Chrome extension that overlays a real-time market data collector on [dtrader.deriv.com](https://dtrader.deriv.com) for **Step Index 100**. This tool calculates and logs technical indicators at every tick to a CSV file for analysis and pattern detection.

---

## Features

| Feature | Details |
|---|---|
| **Live Tick Feed** | Streams Step Index 100 ticks via the public Deriv WebSocket (`wss://ws.deriv.com/websockets/v3?app_id=1089`). |
| **Indicator Calculation** | Computes a suite of technical indicators at every single tick: Bollinger Bands, MACD, RSI, Stochastic SMI, and EMA(4). |
| **Real-time Data Logging** | Buffers up to 50,000 tick-level records (epoch, price, and all indicator values) in-memory during a session. |
| **CSV Export** | One-click export of all logged data as a `.csv` file for external analysis. |
| **Draggable Overlay** | Simplified floating panel showing connection status, current price, and current log count. Position is saved to `localStorage`. |

---

## Technical Indicators (Per Tick)

The following indicators are calculated at every tick using a combination of the current price and historical candle data (1-minute granularity):

- **Bollinger Bands (14, 2, EMA):** Calculates the Top, Middle, and Bottom bands using a 14-period EMA basis.
- **MACD (12, 26, 9):** Standard MACD line, Signal line, and Histogram calculated using 12/26/9 EMA settings.
- **RSI (14):** Relative Strength Index with a 14-period Wilders smoothing.
- **Stochastic SMI (10, 3, 3, 10):** Stochastic Momentum Index with standard periods (10) and smoothing (3, 3, 10).
- **EMA (4):** A fast Exponential Moving Average (4-period) based on tick prices.

---

## Installation (unpacked extension)

1. **Download / clone this repository.**
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Navigate to [https://dtrader.deriv.com](https://dtrader.deriv.com).  
   The **3Tick Data Collector** panel appears on the page.

> **Note:** The extension runs only on `https://dtrader.deriv.com/*` and does not require any Deriv login or private API key.

---

## File Structure

```
3tick/
├── manifest.json   Chrome extension manifest (Manifest V3)
├── content.js      Content script – WebSocket communication, indicator calculations, data logging, and overlay UI
├── styles.css      Simplified overlay CSS
└── README.md       This file
```

---

## Usage

1. **Connection:** The extension automatically connects to the Deriv WebSocket upon page load and resolves the Step Index 100 symbol.
2. **Start Logging:** Click the **▶ Start Data Collection** button to begin buffering tick data and indicator values.
3. **Monitoring:** The "Log Count" in the overlay shows the total number of records captured in the current session.
4. **Stop Logging:** Click the **⏹ Stop Data Collection** button to pause logging.
5. **Export:** Click **⬇ Export CSV** to download the buffered data as a CSV file.
6. **Clear:** Use **Clear Log** to purge the current in-memory buffer.

---

## License

MIT
