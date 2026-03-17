# Deribit RL Bot — Cloudflare Worker

24/7 autonomous RL bot that monitors Deribit options and sends Telegram alerts when:
- Protocol changes (e.g., `wait-better-strike` → `trapped-trend-near-dca`)
- Confidence exceeds threshold (> 80%)
- Delta crosses target (< 0.15)
- Spot price enters DCA zone (±5%)

## Architecture

```
┌────────────────────────────────┐
│  Cloudflare Worker (5min cron) │
│  • Deribit WS → live prices    │
│  • RL engine evaluation        │
│  • Telegram alerts             │
│  • KV state (Q-table)          │
└────────────────────────────────┘
```

**Files:**
- `bot.js` — Main orchestration: WS → RL → Telegram
- `rlDual.js` — RL engine (ported from PWA, no localStorage)
- `telegram.js` — Telegram Bot API client
- `wrangler.toml` — Cloudflare config (KV binding, cron, env)
- `package.json` — Dependencies (wrangler)

## Setup

### 1. Create Telegram Bot

Use [@BotFather](https://t.me/botfather) on Telegram:
```
/start
/newbot
Name: Deribit RL Bot
Username: deribit_rl_bot
```

Copy the **token** → `TELEGRAM_TOKEN`

Get your **chat ID**:
```
curl https://api.telegram.org/bot<TOKEN>/getUpdates
```

### 2. Create Cloudflare KV Namespace

```bash
wrangler kv:namespace create "RL_STATE"
wrangler kv:namespace create "RL_STATE" --preview
```

Copy the namespace ID → `wrangler.toml` `kv_namespaces` block

### 3. Set Secrets

```bash
cd workers
wrangler secret put TELEGRAM_TOKEN
# Paste token, then enter

wrangler secret put TELEGRAM_CHAT_ID
# Paste chat ID, then enter
```

### 4. Configure Environment

Edit `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "RL_STATE"
id = "your-kv-id"     # From step 2
preview_id = "your-kv-preview-id"

[env.production]
routes = [
  { pattern = "rl-bot.example.com/*", zone_name = "example.com" }
]
```

### 5. Deploy

```bash
cd workers
npm install
wrangler deploy
```

Verify in Cloudflare dashboard: Workers → deribit-rl-bot → Triggers → Cron

## How It Works

### Trigger Flow

1. **Cron every 5 minutes** (configurable in `wrangler.toml`)
2. Connect to **Deribit WebSocket**
3. Fetch **spot price** for BTC/ETH
4. Evaluate all **active options** via RL engine
5. **Check triggers** (protocol change, confidence, delta)
6. **Send Telegram alert** if any trigger hit
7. **Save Q-table** to KV for learning persistence

### State Management

**KV Storage:**
- `rl_state_v1` — JSON: `{ qTable, config, lastAlerts, timestamp }`
- TTL: 30 days (auto-cleanup)
- Updated after each evaluation cycle

**In-Memory State:**
- Protocol history per asset
- Last alert timestamp (prevents spam)
- Q-learning state accumulation

## Configuration

### Environment Variables (wrangler.toml)

```toml
vars = {
  ASSETS = "BTC,ETH",           # Assets to monitor
  DCA_THRESHOLD = "0.05",       # ±5% entry zone
  CONFIDENCE_MIN = "0.80",      # Min alert confidence
}
```

### Reward Config (KV)

RL engine uses defaults from `rlDual.js`:
```js
plusValueWeight: 2.4      // Plus-value lock bonus
trappedWeight: 1.5        // Trapped trend bonus
dcaWeight: 1.1            // DCA zone proximity
deltaTarget: 0.2          // Target delta
```

Can be updated live via KV or future admin endpoint.

## Testing Locally

```bash
wrangler dev

# In another terminal:
curl -X POST http://localhost:8787
# Should output "OK" and check your Telegram for test alert
```

## Monitoring

### Cloudflare Dashboard

- Workers → deribit-rl-bot → Analytics (errors, latency)
- KV → RL_STATE (view state, size)

### Telegram Alerts

Each alert shows:
```
🤖 RL Alert
Asset: BTC
Protocol: trapped-trend-near-dca
Confidence: 85%
Spot: $45,230
DCA: $45,000
Delta: 0.182
Timestamp: 2026-03-17T14:30:00Z
```

## Future Enhancements

- [ ] Integrate PWA DCA storage → read from KV instead of env
- [ ] Admin dashboard for RL config updates
- [ ] Multi-asset portfolio view in Telegram
- [ ] Backtest mode (replay historical data)
- [ ] Discord/Slack alternative channels
- [ ] Custom alert cooldown per trigger type

## Debugging

### View Recent Logs

```bash
wrangler tail --format json | jq .logs
```

### Check KV State

```bash
wrangler kv:key list --namespace-id=<ID>
wrangler kv:key get rl_state_v1 --namespace-id=<ID> | jq .
```

### Common Issues

| Issue | Fix |
|-------|-----|
| Bot not sending messages | Check `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` in secrets |
| WS connection timeout | Deribit may be under load; check network |
| "Namespace not found" | Verify KV binding ID in `wrangler.toml` |
| "Method not allowed" | Only POST/scheduled triggers work (no GET) |

## Cost

- **Cloudflare Workers**: Free tier (10ms CPU/req, 100k req/day)
- **KV Storage**: Free tier (50k read/day, 1k write/day)
- **Telegram Bot API**: Free
- **Deribit API**: Free (public endpoints)

This setup easily fits free tier with 5-min cron checks.
