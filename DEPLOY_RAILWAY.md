# Deploying Veridex on Railway

Step-by-step guide to run Veridex (backend + continuous data collector) on [Railway](https://railway.app) with a PostgreSQL database.

---

## Prerequisites

- A [Railway](https://railway.app) account
- The `Pretoninho/veridex` repository connected to your Railway project (GitHub deploy)

---

## 1 — Create the Railway project

1. Go to [Railway](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select `Pretoninho/veridex`

Railway will detect the `railway.toml` file at the root of the repo and use the
build/start commands defined there:

```toml
[build]
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "node backend/server.js"
healthcheckPath = "/health"
```

---

## 2 — Add a PostgreSQL database

1. Inside your Railway project, click **New** → **Database** → **PostgreSQL**
2. Railway will provision a Postgres instance and automatically inject a
   `DATABASE_URL` variable into every service that is linked to it.
3. Go to your **backend service** → **Variables** tab and confirm that
   `DATABASE_URL` is listed (it should be auto-populated by Railway).

> **Important:** `DATABASE_URL` is **required** when `NODE_ENV=production`.
> The backend will refuse to start and exit with code 1 if it is missing or if
> the connection test fails.

---

## 3 — Configure environment variables

These variables are already set in `railway.toml` under
`[environments.production]` and do **not** need to be added manually unless you
want to override them:

| Variable          | Value          | Purpose                                   |
|-------------------|----------------|-------------------------------------------|
| `NODE_ENV`        | `production`   | Enables strict-mode DB check on startup   |
| `ENABLE_COLLECTOR`| `true`         | Starts the Deribit WebSocket data collector |
| `PORT`            | `3000`         | HTTP port (Railway overrides via `$PORT`) |

Optional variables you may add:

| Variable              | Default  | Purpose                                                                                       |
|-----------------------|----------|-----------------------------------------------------------------------------------------------|
| `PGSSLMODE`           | _(SSL)_  | Set to `disable` only for plain local Postgres (no SSL)                                       |
| `LOG_LEVEL`           | `info`   | Set to `debug` for verbose WebSocket logging                                                  |
| `MAINTENANCE_MODE`    | `false`  | Serve 503 on all API routes during deploys                                                    |
| `SETTLEMENT_K`        | `0.75`   | Volatility threshold multiplier — `threshold = k × σ_ann × √(T/365)`. Increase to be stricter (fewer WIN/LOSS, more FLAT); decrease to label more moves as WIN/LOSS. |
| `SETTLEMENT_INTERVAL_MS` | `300000` | How often the settlement job runs (ms). Default is 5 minutes.                           |

---

## 4 — Deploy

Push a commit to the branch connected to your Railway service (typically
`main`). Railway will:

1. Run `npm ci && npm run build` (installs deps, builds the React frontend)
2. Start `node backend/server.js`
3. On startup the backend will:
   - Validate `DATABASE_URL` is present
   - Connect to Postgres and run idempotent table migrations
   - Execute `SELECT 1` — exits with code 1 if the connection fails
   - Start the Deribit WebSocket collector (because `ENABLE_COLLECTOR=true`)

---

## 5 — Verify via `/health`

Once the deploy is green, hit the public URL Railway gives you:

```bash
curl https://<your-app>.up.railway.app/health
```

Expected response when everything is healthy:

```json
{
  "status": "ok",
  "maintenance": false,
  "timestamp": 1710000000000,
  "db": { "ok": true, "latencyMs": 4 }
}
```

If the DB connection is unavailable, `status` will be `"degraded"` and
`db.ok` will be `false`.

For full diagnostics (collector + WebSocket status):

```bash
curl "https://<your-app>.up.railway.app/health?include_collector=true&include_ws=true"
```

---

## 6 — Verify data is being written

### Check logs

In Railway → **Logs**, look for entries like:

```
[server] PostgreSQL connection OK (4ms)
[dataCollector] Starting — tick every 60s
[dataCollector] Tick #1 (WS: connected)
[dataStore] PostgreSQL initialized
```

### Sample SQL queries (via Railway's Postgres shell or any Postgres client)

```sql
-- Check most recent tickers
SELECT asset, to_timestamp(timestamp/1000), spot, iv_rank, funding
FROM tickers
ORDER BY timestamp DESC
LIMIT 10;

-- Check most recent signals
SELECT asset, to_timestamp(timestamp/1000), signal_type, signal_score
FROM signals
ORDER BY timestamp DESC
LIMIT 10;

-- Check outcomes
SELECT o.id, s.asset, s.signal_type, o.move_1h_pct, o.move_4h_pct, o.move_24h_pct
FROM outcomes o
JOIN signals s ON s.id = o.signal_id
ORDER BY o.settled_at DESC
LIMIT 10;
```

### Analytics endpoint

```bash
curl "https://<your-app>.up.railway.app/analytics/stats?asset=BTC&days=7"
```

---

## 7 — Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Exit code 1 at startup | `DATABASE_URL` missing | Link Postgres service to backend in Railway |
| Exit code 1 at startup | `DATABASE_URL` invalid / DB unreachable | Check credentials and network in Railway Variables |
| `status: "degraded"` in `/health` | DB became unavailable after start | Check Postgres service status in Railway |
| No ticks in DB after 2 minutes | Collector not started | Ensure `ENABLE_COLLECTOR=true` in Variables |
| WS always `disconnected` | Deribit connectivity issue | Check outbound network access on Railway plan |
