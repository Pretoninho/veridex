# Settlement Methodology

Veridex evaluates the quality of directional signals by comparing each signal's
trigger price to the market price at three fixed time horizons after the signal
fires.  The outcome is labelled **WIN**, **LOSS**, or **FLAT** based on a
volatility-scaled threshold.

---

## 1. Signal Direction

A signal produces an outcome only when it has a clear directional bias:

| `positioning.signal` | Direction |
|----------------------|-----------|
| `"bullish"`          | **LONG**  |
| `"bearish"`          | **SHORT** |
| `"neutral"` / other  | *(skipped — no outcome)* |

---

## 2. Horizons

| Label | Duration |
|-------|----------|
| `1h`  | 1 hour   |
| `4h`  | 4 hours  |
| `24h` | 24 hours |

Each signal is independently evaluated at all three horizons.  A horizon is
settled as soon as a ticker price exists at or after `signal.timestamp + horizon_ms`.

---

## 3. Volatility Threshold (`k`)

The dynamic move threshold is:

```
threshold = k × volAnn × sqrt(T_days / 365)
```

where:

- **`volAnn`** — annualised implied or realised volatility (decimal, e.g. `0.65` for 65%).
  Source priority: **DVOL** (Deribit IV index) → **RV** (historical realised vol).
- **`T_days`** — horizon expressed in fractional days (`1/24` for 1 h, `4/24` for 4 h, `1` for 24 h).
- **`k`** — configurable multiplier (env var `SETTLEMENT_K`, default **0.75**).

### Example

For BTC with DVOL = 65 % (0.65 decimal) and `k = 0.75`:

| Horizon | T_days  | threshold |
|---------|---------|-----------|
| 1 h     | 1/24    | ≈ 0.83 %  |
| 4 h     | 4/24    | ≈ 1.67 %  |
| 24 h    | 1       | ≈ 4.06 %  |

---

## 4. WIN / LOSS / FLAT Labels

```
return_pct = (price_at_horizon − trigger_price) / trigger_price × 100
```

| Direction | Condition              | Label  |
|-----------|------------------------|--------|
| LONG      | return ≥ +threshold    | **WIN**  |
| LONG      | return ≤ −threshold    | **LOSS** |
| LONG      | −threshold < return < +threshold | **FLAT** |
| SHORT     | return ≤ −threshold    | **WIN**  |
| SHORT     | return ≥ +threshold    | **LOSS** |
| SHORT     | −threshold < return < +threshold | **FLAT** |

---

## 5. Settlement Job

The settlement job (`backend/workers/settlementJob.js`) runs every
`SETTLEMENT_INTERVAL_MS` milliseconds (default: **300 000 ms = 5 min**).

### Algorithm

1. Query the `signals` table for all directional signals whose `timestamp` is at
   least 1 hour old and that are not yet fully settled (any horizon label is still
   `NULL`).
2. For each signal and each unsettled horizon:
   a. Look up the closest ticker price at or after `signal.timestamp + horizon_ms`
      from the local `tickers` table.
   b. If no local tick is found, the horizon remains `NULL` and will be retried on
      the next run.
   c. Compute `return_pct` and `threshold`, assign the label.
3. Upsert the `outcomes` row (insert on first settlement, update on subsequent
   horizons).

### Error Handling

- A failed individual signal settlement is logged and counted in `_errorCount`.
  The job continues processing remaining signals.
- A complete run failure is caught, logged, and the job continues on the next
  interval.

---

## 6. Environment Variables

| Variable                 | Default  | Description |
|--------------------------|----------|-------------|
| `SETTLEMENT_K`           | `0.75`   | Volatility threshold multiplier |
| `SETTLEMENT_INTERVAL_MS` | `300000` | Job interval in milliseconds |
| `DATABASE_URL`           | *(none)* | PostgreSQL connection string (SQLite used when absent) |
