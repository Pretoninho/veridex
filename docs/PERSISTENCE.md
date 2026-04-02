# Signal Persistence & Outcome Tracking

This document describes how Veridex captures market signals and tracks their
outcomes over time.

---

## 1. Signal Capture Flow

```
DataCollector (60 s tick)
        │
        ▼
  computeSignal()  ──► positioning.signal ('bullish' | 'bearish' | 'neutral')
        │
        ▼
  extractDirection()  ──► 'LONG' | 'SHORT' | null (neutral → skip)
        │
        ▼
  selectVolSource()  ──► { volAnn, source: 'DVOL' | 'RV' }
        │
        ▼
  store.insert('signals', { … })  ──► signal_id
```

### Key Rules

- Only **LONG** and **SHORT** signals are persisted. Neutral signals are dropped.
- Volatility source priority: **DVOL** (`dvol.current`) → **RV** (`rv.current` → `rv.avg30`).
- `vol_ann` is stored as a decimal (e.g. `0.65` for 65 %).  Values > 2 are
  assumed to be in percentage form and are divided by 100 before storage.
- All timestamps are in **milliseconds** (epoch ms).

---

## 2. `signals` Table

| Column          | Type           | Description |
|-----------------|----------------|-------------|
| `id`            | SERIAL / INT   | Primary key |
| `asset`         | VARCHAR(10)    | `BTC` / `ETH` |
| `timestamp`     | BIGINT         | Signal fire time (epoch ms) |
| `signal_type`   | VARCHAR(20)    | `STRONG_LONG`, `WEAK_SHORT`, etc. |
| `trigger_price` | DECIMAL(20,8)  | Spot price at signal time |
| `signal_score`  | DECIMAL(5,2)   | Composite score (0–100) |
| `direction`     | VARCHAR(10)    | `LONG` / `SHORT` / NULL |
| `vol_source`    | VARCHAR(10)    | `DVOL` / `RV` / NULL |
| `vol_ann`       | DECIMAL(10,6)  | Annualised vol (decimal) |
| `k`             | DECIMAL(5,3)   | Threshold multiplier used |
| `created_at`    | TIMESTAMP      | DB insert time |

---

## 3. Outcome Tracking

After a signal fires, the settlement job writes its results to the `outcomes`
table at three time horizons (1 h, 4 h, 24 h).

### `outcomes` Table

| Column             | Type           | Description |
|--------------------|----------------|-------------|
| `id`               | SERIAL / INT   | Primary key |
| `signal_id`        | INTEGER        | FK → `signals.id` |
| `asset`            | VARCHAR(10)    | Copied from signal |
| `price_1h_after`   | DECIMAL(20,8)  | Spot at signal_ts + 1 h |
| `price_4h_after`   | DECIMAL(20,8)  | Spot at signal_ts + 4 h |
| `price_24h_after`  | DECIMAL(20,8)  | Spot at signal_ts + 24 h |
| `move_1h_pct`      | DECIMAL(8,4)   | % return at 1 h |
| `move_4h_pct`      | DECIMAL(8,4)   | % return at 4 h |
| `move_24h_pct`     | DECIMAL(8,4)   | % return at 24 h |
| `threshold_1h`     | DECIMAL(10,6)  | Dynamic threshold at 1 h (%) |
| `label_1h`         | VARCHAR(10)    | `WIN` / `LOSS` / `FLAT` / NULL (pending) |
| `threshold_4h`     | DECIMAL(10,6)  | Dynamic threshold at 4 h (%) |
| `label_4h`         | VARCHAR(10)    | `WIN` / `LOSS` / `FLAT` / NULL (pending) |
| `threshold_24h`    | DECIMAL(10,6)  | Dynamic threshold at 24 h (%) |
| `label_24h`        | VARCHAR(10)    | `WIN` / `LOSS` / `FLAT` / NULL (pending) |
| `settled_at`       | TIMESTAMP      | First settlement time |
| `updated_at`       | TIMESTAMP      | Last update time |

### Pending Horizons

A horizon label remains `NULL` ("pending") when:
- The horizon has not elapsed yet; **or**
- No ticker price is available at or after `signal.timestamp + horizon_ms` in the
  local `tickers` table.

Pending horizons are retried on every settlement run until they are resolved.

---

## 4. `signalPersistence` Service

`backend/services/signalPersistence.js` exposes a single function:

```js
const { persistSignal } = require('./services/signalPersistence')

const signalId = await persistSignal(
  asset,        // 'BTC' | 'ETH'
  positioning,  // { signal: 'bullish' | 'bearish' | 'neutral' }
  dvol,         // { current: 65 } or null
  rv,           // { current: 50, avg30: 48 } or null
  k,            // threshold multiplier (default DEFAULT_K = 0.75)
  triggerPrice, // spot price at signal time
  spot,         // current spot (fallback if triggerPrice is null)
  timestamp,    // epoch ms (defaults to Date.now())
)
// Returns: signal_id (number) or null if the signal was neutral/skipped
```

---

## 5. Analytics API

Settled outcomes are exposed through the analytics endpoint:

```
GET /analytics/stats?asset=BTC&days=7
```

Returns win rates, average returns, and breakdowns by direction and volatility
source.  See the API for full response schema.

---

## 6. Database

- **Development**: SQLite file at `backend/data/veridex.db` (auto-created).
- **Production**: PostgreSQL via `DATABASE_URL` environment variable.

Schema is auto-migrated on every startup by `backend/workers/dataStore.js`.
