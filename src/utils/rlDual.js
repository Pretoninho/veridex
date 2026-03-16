const LS_RL_Q_TABLE = 'di_rl_q_table_v1'
const LS_RL_LOG = 'di_rl_log_v1'

const ACTION_SKIP = 'skip'
const ACTION_SUBSCRIBE = 'subscribe'

const ALPHA = 0.22
const MAX_LOG = 500
const HIGH_IV_MIN = {
  BTC: 55,
  ETH: 60,
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function bucketDays(days) {
  if (!Number.isFinite(days)) return 'D?'
  if (days <= 2) return 'D2'
  if (days <= 4) return 'D4'
  if (days <= 14) return 'D14'
  if (days <= 30) return 'D30'
  if (days <= 90) return 'D90'
  return 'D90+'
}

function bucketApr(apr) {
  if (!Number.isFinite(apr)) return 'A?'
  if (apr <= 8) return 'A8'
  if (apr <= 14) return 'A14'
  if (apr <= 22) return 'A22'
  if (apr <= 35) return 'A35'
  return 'A35+'
}

function bucketIv(iv) {
  if (!Number.isFinite(iv)) return 'IV?'
  if (iv <= 35) return 'IV35'
  if (iv <= 50) return 'IV50'
  if (iv <= 70) return 'IV70'
  return 'IV70+'
}

function bucketDist(distPct) {
  if (!Number.isFinite(distPct)) return 'M?'
  const d = Math.abs(distPct)
  if (d <= 1) return 'M1'
  if (d <= 3) return 'M3'
  if (d <= 6) return 'M6'
  if (d <= 10) return 'M10'
  return 'M10+'
}

function safeParse(raw, fallback) {
  try { return JSON.parse(raw) } catch { return fallback }
}

function loadTable() {
  if (typeof localStorage === 'undefined') return {}
  return safeParse(localStorage.getItem(LS_RL_Q_TABLE) || '{}', {})
}

function saveTable(table) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_RL_Q_TABLE, JSON.stringify(table))
}

function loadLog() {
  if (typeof localStorage === 'undefined') return []
  return safeParse(localStorage.getItem(LS_RL_LOG) || '[]', [])
}

function saveLog(logs) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_RL_LOG, JSON.stringify(logs.slice(-MAX_LOG)))
}

function defaultState() {
  return {
    [ACTION_SKIP]: 0,
    [ACTION_SUBSCRIBE]: 0,
    nSkip: 0,
    nSubscribe: 0,
  }
}

function getOrCreateState(table, stateKey) {
  const prev = table[stateKey]
  if (prev) return prev
  const init = defaultState()
  table[stateKey] = init
  return init
}

function confidenceFromDiff(diff) {
  const scaled = Math.tanh(diff / 5)
  return Math.round(50 + scaled * 45)
}

export function encodeDualState(ctx) {
  const asset = (ctx?.asset || 'BTC').toUpperCase()
  const side = ctx?.side === 'sell-high' ? 'SH' : 'BL'
  return [
    asset,
    side,
    bucketDays(Number(ctx?.days)),
    bucketApr(Number(ctx?.apr)),
    bucketDist(Number(ctx?.distPct)),
    bucketIv(Number(ctx?.iv)),
  ].join('|')
}

export function evaluateDualPolicy(ctx) {
  const asset = (ctx?.asset || 'BTC').toUpperCase()
  const iv = Number(ctx?.iv)
  const ivFloor = HIGH_IV_MIN[asset] ?? 55
  const stateKey = encodeDualState(ctx)
  const table = loadTable()
  const state = table[stateKey] || defaultState()
  const qSkip = Number(state[ACTION_SKIP] || 0)
  const qSubscribe = Number(state[ACTION_SUBSCRIBE] || 0)
  const diff = qSubscribe - qSkip
  const highIvCondition = Number.isFinite(iv) && iv >= ivFloor
  const action = highIvCondition && diff >= 0 ? ACTION_SUBSCRIBE : ACTION_SKIP
  return {
    stateKey,
    action,
    confidence: confidenceFromDiff(diff),
    highIvCondition,
    iv,
    ivFloor,
    reason: highIvCondition ? 'iv-high' : 'iv-too-low',
    qSkip,
    qSubscribe,
    samples: Number(state.nSubscribe || 0),
  }
}

export function learnFromSettlement({ stateKey, rewardPct, meta }) {
  if (!stateKey) return null
  const table = loadTable()
  const state = getOrCreateState(table, stateKey)
  const reward = clamp(Number(rewardPct) || 0, -40, 40)

  state[ACTION_SUBSCRIBE] = state[ACTION_SUBSCRIBE] + ALPHA * (reward - state[ACTION_SUBSCRIBE])
  state[ACTION_SKIP] = state[ACTION_SKIP] + ALPHA * (0 - state[ACTION_SKIP])
  state.nSubscribe += 1
  state.nSkip += 1

  table[stateKey] = state
  saveTable(table)

  const logs = loadLog()
  logs.push({
    ts: Date.now(),
    stateKey,
    rewardPct: reward,
    qSubscribe: state[ACTION_SUBSCRIBE],
    qSkip: state[ACTION_SKIP],
    meta: meta || null,
  })
  saveLog(logs)

  return {
    qSubscribe: state[ACTION_SUBSCRIBE],
    qSkip: state[ACTION_SKIP],
    samples: state.nSubscribe,
  }
}

export function getDualRlMetrics() {
  const table = loadTable()
  const logs = loadLog()
  const states = Object.keys(table)
  const rewards = logs.map((x) => Number(x.rewardPct)).filter((x) => Number.isFinite(x))
  const avgReward = rewards.length
    ? rewards.reduce((a, b) => a + b, 0) / rewards.length
    : 0
  return {
    states: states.length,
    experiences: logs.length,
    avgReward,
    lastTs: logs.length ? logs[logs.length - 1].ts : null,
  }
}

export function resetDualRl() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(LS_RL_Q_TABLE)
  localStorage.removeItem(LS_RL_LOG)
}
