const LS_RL_Q_TABLE = 'di_rl_q_table_v1'
const LS_RL_LOG = 'di_rl_log_v1'
const LS_RL_REWARD_CFG = 'di_rl_reward_cfg_v1'

const ACTION_SKIP = 'skip'
const ACTION_SUBSCRIBE = 'subscribe'

const ALPHA = 0.22
const MAX_LOG = 500
const DEFAULT_REWARD_CONFIG = {
  pnlWeight: 1,
  calendarWeight: 1,
  fridayWeight: 2.5,
  cycleWeight: 2,
  cycleTargetDays: 14,
  cycleToleranceDays: 7,
  exercisedPenalty: -0.75,
  dcaWeight: 1.1,
  plusValueWeight: 2.4,
  trappedWeight: 1.5,
  deltaWeight: 0.9,
  deltaTarget: 0.2,
  deltaTolerance: 0.12,
}
const HIGH_IV_MIN = {
  BTC: 55,
  ETH: 60,
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function isFiniteNum(v) {
  return Number.isFinite(Number(v))
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

function bucketDelta(delta) {
  const d = Math.abs(Number(delta))
  if (!Number.isFinite(d)) return 'DL?'
  if (d < 0.1) return 'DL10'
  if (d < 0.2) return 'DL20'
  if (d < 0.3) return 'DL30'
  if (d < 0.45) return 'DL45'
  return 'DL45+'
}

function bucketDcaGap(gapPct) {
  const g = Math.abs(Number(gapPct))
  if (!Number.isFinite(g)) return 'DCA?'
  if (g <= 1) return 'DCA1'
  if (g <= 3) return 'DCA3'
  if (g <= 6) return 'DCA6'
  if (g <= 10) return 'DCA10'
  return 'DCA10+'
}

function plusValueOnExercise(side, strike, dca) {
  if (!Number.isFinite(Number(strike)) || !Number.isFinite(Number(dca)) || Number(dca) <= 0) return null
  if (side === 'sell-high') return Number(strike) >= Number(dca)
  return Number(strike) <= Number(dca)
}

function calcDcaGapPct(strike, dca) {
  if (!Number.isFinite(Number(strike)) || !Number.isFinite(Number(dca)) || Number(dca) <= 0) return null
  return ((Number(strike) - Number(dca)) / Number(dca)) * 100
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

function normalizeRewardConfig(input) {
  const cfg = {
    ...DEFAULT_REWARD_CONFIG,
    ...(input || {}),
  }
  cfg.pnlWeight = clamp(Number(cfg.pnlWeight) || 0, 0, 3)
  cfg.calendarWeight = clamp(Number(cfg.calendarWeight) || 0, 0, 3)
  cfg.fridayWeight = clamp(Number(cfg.fridayWeight) || 0, -10, 10)
  cfg.cycleWeight = clamp(Number(cfg.cycleWeight) || 0, -10, 10)
  cfg.cycleTargetDays = clamp(Number(cfg.cycleTargetDays) || 14, 1, 60)
  cfg.cycleToleranceDays = clamp(Number(cfg.cycleToleranceDays) || 7, 1, 30)
  cfg.exercisedPenalty = clamp(Number(cfg.exercisedPenalty) || 0, -10, 10)
  cfg.dcaWeight = clamp(Number(cfg.dcaWeight) || 0, 0, 4)
  cfg.plusValueWeight = clamp(Number(cfg.plusValueWeight) || 0, -10, 10)
  cfg.trappedWeight = clamp(Number(cfg.trappedWeight) || 0, -10, 10)
  cfg.deltaWeight = clamp(Number(cfg.deltaWeight) || 0, 0, 4)
  cfg.deltaTarget = clamp(Number(cfg.deltaTarget) || 0.2, 0.05, 0.8)
  cfg.deltaTolerance = clamp(Number(cfg.deltaTolerance) || 0.12, 0.02, 0.5)
  return cfg
}

function loadRewardConfig() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_REWARD_CONFIG }
  const parsed = safeParse(localStorage.getItem(LS_RL_REWARD_CFG) || '{}', {})
  return normalizeRewardConfig(parsed)
}

function saveRewardConfig(config) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_RL_REWARD_CFG, JSON.stringify(normalizeRewardConfig(config)))
}

function deriveDays(meta) {
  if (isFiniteNum(meta?.days)) return Number(meta.days)
  if (isFiniteNum(meta?.entryTs) && isFiniteNum(meta?.expiryTs)) {
    return Math.max(0.01, (Number(meta.expiryTs) - Number(meta.entryTs)) / 86400000)
  }
  return null
}

function calendarRewardDiagnostics(meta, config) {
  const days = deriveDays(meta)
  const expiryTs = isFiniteNum(meta?.expiryTs) ? Number(meta.expiryTs) : null
  const isFriday = expiryTs != null ? new Date(expiryTs).getUTCDay() === 5 : null

  const fridayScore = isFriday == null ? 0 : (isFriday ? 1 : -1)
  const dayDistance = days == null ? null : Math.abs(days - config.cycleTargetDays)
  const cycleScore = dayDistance == null
    ? 0
    : clamp(1 - (dayDistance / Math.max(1, config.cycleToleranceDays)), -1, 1)

  const rawCalendar = (config.fridayWeight * fridayScore) + (config.cycleWeight * cycleScore)
  const calendarBonus = config.calendarWeight * rawCalendar

  return {
    days,
    isFriday,
    fridayScore,
    cycleScore,
    dayDistance,
    rawCalendar,
    calendarBonus,
  }
}

function composeReward({ baseRewardPct, meta, config }) {
  const calendar = calendarRewardDiagnostics(meta, config)
  const exercisedPenalty = meta?.exercised ? config.exercisedPenalty : 0
  const side = meta?.side === 'sell-high' ? 'sell-high' : 'buy-low'
  const strike = Number(meta?.strike)
  const dca = Number(meta?.dca)
  const plusValueLocked = meta?.plusValueLocked ?? plusValueOnExercise(side, strike, dca)
  const trappedTrend = Boolean(meta?.trappedTrend)
  const dcaGapPct = Number.isFinite(Number(meta?.dcaGapPct))
    ? Number(meta.dcaGapPct)
    : calcDcaGapPct(strike, dca)
  const absDcaGapPct = Number.isFinite(dcaGapPct) ? Math.abs(dcaGapPct) : null
  const dcaCloseness = absDcaGapPct == null ? 0 : clamp(1 - (absDcaGapPct / 12), -1, 1)
  const dcaScore = plusValueLocked === true
    ? config.plusValueWeight
    : trappedTrend
      ? config.trappedWeight * dcaCloseness
      : config.plusValueWeight * -0.7

  const deltaAbs = Math.abs(Number(meta?.delta))
  const deltaScore = Number.isFinite(deltaAbs)
    ? clamp(1 - (Math.abs(deltaAbs - config.deltaTarget) / Math.max(0.001, config.deltaTolerance)), -1, 1)
    : 0
  const deltaFloorBonus = Number.isFinite(deltaAbs) && deltaAbs >= config.deltaTarget ? 1 : -0.5
  const deltaBonus = config.deltaWeight * ((0.55 * deltaScore) + (0.45 * deltaFloorBonus))

  const shapedReward = (baseRewardPct * config.pnlWeight)
    + calendar.calendarBonus
    + exercisedPenalty
    + (config.dcaWeight * dcaScore)
    + deltaBonus

  return {
    baseRewardPct,
    shapedReward,
    exercisedPenalty,
    calendar,
    dca: {
      dca,
      plusValueLocked,
      trappedTrend,
      dcaGapPct,
      dcaCloseness,
      dcaScore: config.dcaWeight * dcaScore,
    },
    delta: {
      deltaAbs: Number.isFinite(deltaAbs) ? deltaAbs : null,
      deltaScore,
      deltaBonus,
      deltaTarget: config.deltaTarget,
      deltaFloorOk: Number.isFinite(deltaAbs) ? deltaAbs >= config.deltaTarget : null,
    },
  }
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
  const strike = Number(ctx?.strike)
  const dca = Number(ctx?.dca)
  const dcaGapPct = Number.isFinite(Number(ctx?.dcaGapPct)) ? Number(ctx.dcaGapPct) : calcDcaGapPct(strike, dca)
  const plusValueLocked = ctx?.plusValueLocked ?? plusValueOnExercise(ctx?.side, strike, dca)
  return [
    asset,
    side,
    bucketDays(Number(ctx?.days)),
    bucketApr(Number(ctx?.apr)),
    bucketDist(Number(ctx?.distPct)),
    bucketIv(Number(ctx?.iv)),
    bucketDelta(ctx?.delta),
    bucketDcaGap(dcaGapPct),
    plusValueLocked == null ? 'PV?' : plusValueLocked ? 'PV1' : 'PV0',
    ctx?.trappedTrend ? 'TRAP1' : 'TRAP0',
  ].join('|')
}

export function evaluateDualPolicy(ctx) {
  const asset = (ctx?.asset || 'BTC').toUpperCase()
  const iv = Number(ctx?.iv)
  const ivFloor = HIGH_IV_MIN[asset] ?? 55
  const config = loadRewardConfig()
  const strike = Number(ctx?.strike)
  const dca = Number(ctx?.dca)
  const deltaAbs = Math.abs(Number(ctx?.delta))
  const deltaFloorOk = Number.isFinite(deltaAbs) ? deltaAbs >= config.deltaTarget : null
  const dcaGapPct = Number.isFinite(Number(ctx?.dcaGapPct)) ? Number(ctx.dcaGapPct) : calcDcaGapPct(strike, dca)
  const plusValueLocked = ctx?.plusValueLocked ?? plusValueOnExercise(ctx?.side, strike, dca)
  const trappedTrend = Boolean(ctx?.trappedTrend)
  const trappedProtocolActive = trappedTrend && plusValueLocked === false
  const nearDcaScore = Number.isFinite(dcaGapPct) ? clamp(1 - (Math.abs(dcaGapPct) / 12), -1, 1) : 0
  const stateKey = encodeDualState(ctx)
  const table = loadTable()
  const state = table[stateKey] || defaultState()
  const qSkip = Number(state[ACTION_SKIP] || 0)
  const qSubscribe = Number(state[ACTION_SUBSCRIBE] || 0)
  const diff = qSubscribe - qSkip
  const highIvCondition = Number.isFinite(iv) && iv >= ivFloor
  const plusValueBias = plusValueLocked === true ? 2.2 : trappedProtocolActive ? 1.2 * nearDcaScore : -1.1
  const deltaBias = Number.isFinite(deltaAbs)
    ? (deltaFloorOk ? Math.max(0.3, 1 - Math.abs(deltaAbs - config.deltaTarget)) : -0.8)
    : 0
  const effectiveEdge = diff + plusValueBias + deltaBias + (highIvCondition ? 0.6 : -1.4)
  const action = effectiveEdge >= 0 ? ACTION_SUBSCRIBE : ACTION_SKIP
  const protocol = plusValueLocked === true
    ? 'plus-value-lock'
    : trappedProtocolActive
      ? 'trapped-trend-near-dca'
      : 'wait-better-strike'
  return {
    stateKey,
    action,
    confidence: confidenceFromDiff(effectiveEdge),
    highIvCondition,
    iv,
    ivFloor,
    reason: highIvCondition ? protocol : 'iv-too-low',
    qSkip,
    qSubscribe,
    samples: Number(state.nSubscribe || 0),
    days: Number(ctx?.days),
    expiryTs: isFiniteNum(ctx?.expiryTs) ? Number(ctx.expiryTs) : null,
    delta: Number.isFinite(deltaAbs) ? deltaAbs : null,
    deltaTarget: config.deltaTarget,
    deltaFloorOk,
    dca: Number.isFinite(dca) ? dca : null,
    dcaGapPct,
    plusValueLocked,
    trappedTrend,
    trappedProtocolActive,
    protocol,
    effectiveEdge,
  }
}

export function learnFromSettlement({ stateKey, rewardPct, meta }) {
  if (!stateKey) return null
  const table = loadTable()
  const state = getOrCreateState(table, stateKey)
  const config = loadRewardConfig()
  const baseReward = clamp(Number(rewardPct) || 0, -40, 40)
  const composed = composeReward({
    baseRewardPct: baseReward,
    meta: meta || null,
    config,
  })
  const reward = clamp(composed.shapedReward, -40, 40)

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
    rewardBasePct: baseReward,
    rewardPct: reward,
    qSubscribe: state[ACTION_SUBSCRIBE],
    qSkip: state[ACTION_SKIP],
    rewardDiagnostics: {
      exercisedPenalty: composed.exercisedPenalty,
      calendar: composed.calendar,
      dca: composed.dca,
      delta: composed.delta,
    },
    rewardConfig: config,
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
  const baseRewards = logs.map((x) => Number(x.rewardBasePct)).filter((x) => Number.isFinite(x))
  const avgReward = rewards.length
    ? rewards.reduce((a, b) => a + b, 0) / rewards.length
    : 0
  const avgBaseReward = baseRewards.length
    ? baseRewards.reduce((a, b) => a + b, 0) / baseRewards.length
    : 0
  return {
    states: states.length,
    experiences: logs.length,
    avgBaseReward,
    avgReward,
    lastTs: logs.length ? logs[logs.length - 1].ts : null,
  }
}

export function getDualRlSnapshot() {
  const table = loadTable()
  const logs = loadLog()
  const rewardConfig = loadRewardConfig()
  const rewardsByState = logs.reduce((acc, entry) => {
    if (!entry.stateKey) return acc
    if (!acc[entry.stateKey]) {
      acc[entry.stateKey] = { totalReward: 0, count: 0, lastReward: null, lastTs: null }
    }
    const rewardPct = Number(entry.rewardPct)
    if (Number.isFinite(rewardPct)) {
      acc[entry.stateKey].totalReward += rewardPct
      acc[entry.stateKey].count += 1
      acc[entry.stateKey].lastReward = rewardPct
    }
    acc[entry.stateKey].lastTs = entry.ts ?? acc[entry.stateKey].lastTs
    return acc
  }, {})

  const topStates = Object.entries(table)
    .map(([stateKey, state]) => {
      const stats = rewardsByState[stateKey] || { totalReward: 0, count: 0, lastReward: null, lastTs: null }
      const qSubscribe = Number(state[ACTION_SUBSCRIBE] || 0)
      const qSkip = Number(state[ACTION_SKIP] || 0)
      return {
        stateKey,
        qSubscribe,
        qSkip,
        samples: Number(state.nSubscribe || 0),
        avgReward: stats.count ? stats.totalReward / stats.count : 0,
        lastReward: stats.lastReward,
        lastTs: stats.lastTs,
        edge: qSubscribe - qSkip,
      }
    })
    .sort((a, b) => {
      if (b.samples !== a.samples) return b.samples - a.samples
      return b.edge - a.edge
    })
    .slice(0, 8)

  const recentExperiences = logs
    .slice(-10)
    .reverse()
    .map((entry) => ({
      ts: entry.ts ?? null,
      stateKey: entry.stateKey,
      rewardBasePct: Number.isFinite(Number(entry.rewardBasePct)) ? Number(entry.rewardBasePct) : null,
      rewardPct: Number(entry.rewardPct),
      qSubscribe: Number(entry.qSubscribe || 0),
      qSkip: Number(entry.qSkip || 0),
      rewardDiagnostics: entry.rewardDiagnostics || null,
      meta: entry.meta || null,
    }))

  const withCalendar = logs.filter((entry) => entry?.rewardDiagnostics?.calendar)
  const withDca = logs.filter((entry) => entry?.rewardDiagnostics?.dca)
  const withDelta = logs.filter((entry) => entry?.rewardDiagnostics?.delta)
  const fridayHits = withCalendar.filter((entry) => entry.rewardDiagnostics.calendar.isFriday === true).length
  const calendarBonusValues = withCalendar
    .map((entry) => Number(entry.rewardDiagnostics.calendar.calendarBonus))
    .filter((x) => Number.isFinite(x))
  const cycleDistanceValues = withCalendar
    .map((entry) => Number(entry.rewardDiagnostics.calendar.dayDistance))
    .filter((x) => Number.isFinite(x))
  const plusValueHits = withDca.filter((entry) => entry.rewardDiagnostics.dca.plusValueLocked === true).length
  const trappedHits = withDca.filter((entry) => entry.rewardDiagnostics.dca.trappedTrend === true).length
  const dcaGapValues = withDca
    .map((entry) => Number(entry.rewardDiagnostics.dca.dcaGapPct))
    .filter((x) => Number.isFinite(x))
  const deltaFloorHits = withDelta.filter((entry) => entry.rewardDiagnostics.delta.deltaFloorOk === true).length
  const deltaValues = withDelta
    .map((entry) => Number(entry.rewardDiagnostics.delta.deltaAbs))
    .filter((x) => Number.isFinite(x))

  return {
    metrics: getDualRlMetrics(),
    rewardConfig,
    calendarStats: {
      samples: withCalendar.length,
      fridayRate: withCalendar.length ? fridayHits / withCalendar.length : 0,
      avgCalendarBonus: calendarBonusValues.length
        ? calendarBonusValues.reduce((a, b) => a + b, 0) / calendarBonusValues.length
        : 0,
      avgCycleDistance: cycleDistanceValues.length
        ? cycleDistanceValues.reduce((a, b) => a + b, 0) / cycleDistanceValues.length
        : null,
    },
    protocolStats: {
      plusValueRate: withDca.length ? plusValueHits / withDca.length : 0,
      trappedRate: withDca.length ? trappedHits / withDca.length : 0,
      avgDcaGapPct: dcaGapValues.length
        ? dcaGapValues.reduce((a, b) => a + b, 0) / dcaGapValues.length
        : null,
      deltaFloorRate: withDelta.length ? deltaFloorHits / withDelta.length : 0,
      avgDeltaAbs: deltaValues.length
        ? deltaValues.reduce((a, b) => a + b, 0) / deltaValues.length
        : null,
    },
    topStates,
    recentExperiences,
  }
}

export function getDualRewardConfig() {
  return loadRewardConfig()
}

export function updateDualRewardConfig(partialConfig) {
  const next = normalizeRewardConfig({
    ...loadRewardConfig(),
    ...(partialConfig || {}),
  })
  saveRewardConfig(next)
  return next
}

export function resetDualRewardConfig() {
  saveRewardConfig(DEFAULT_REWARD_CONFIG)
  return { ...DEFAULT_REWARD_CONFIG }
}

export function resetDualRl() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(LS_RL_Q_TABLE)
  localStorage.removeItem(LS_RL_LOG)
}
