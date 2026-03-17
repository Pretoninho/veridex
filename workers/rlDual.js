// rlDual.js - RL engine ported for Node.js/Cloudflare Workers (no localStorage)

const ALPHA = 0.22
const ACTION_SKIP = 'skip'
const ACTION_SUBSCRIBE = 'subscribe'

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

function defaultState() {
  return {
    [ACTION_SKIP]: 0,
    [ACTION_SUBSCRIBE]: 0,
    nSkip: 0,
    nSubscribe: 0,
  }
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

export function evaluateDualPolicy(ctx, config = DEFAULT_REWARD_CONFIG, qTable = {}) {
  const asset = (ctx?.asset || 'BTC').toUpperCase()
  const iv = Number(ctx?.iv)
  const ivFloor = HIGH_IV_MIN[asset] ?? 55
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
  const state = qTable[stateKey] || defaultState()
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

export function dualComposeReward(baseRewardPct, meta, config) {
  const shapeReward = clamp(baseRewardPct, -40, 40)
  const exercisedPenalty = meta?.exercised ? config.exercisedPenalty : 0
  const side = meta?.side === 'sell-high' ? 'sell-high' : 'buy-low'
  const strike = Number(meta?.strike)
  const dca = Number(meta?.dca)

  const plusValueLocked = meta?.plusValueLocked ?? plusValueOnExercise(side, strike, dca)
  const dcaGapPct = Number.isFinite(Number(meta?.dcaGapPct))
    ? Number(meta.dcaGapPct)
    : calcDcaGapPct(strike, dca)

  const finalReward = clamp(shapeReward + exercisedPenalty, -40, 40)

  return {
    baseRewardPct: baseRewardPct,
    shapedReward: finalReward,
    exercisedPenalty,
    dcaGapPct,
    plusValueLocked,
  }
}

export function learnFromSettlement({ stateKey, rewardPct, meta }, config = DEFAULT_REWARD_CONFIG, qTable = {}) {
  if (!stateKey) return null

  const state = qTable[stateKey] || defaultState()
  const baseReward = clamp(Number(rewardPct) || 0, -40, 40)
  const composed = dualComposeReward(baseReward, meta, config)
  const reward = composed.shapedReward

  state[ACTION_SUBSCRIBE] = state[ACTION_SUBSCRIBE] + ALPHA * (reward - state[ACTION_SUBSCRIBE])
  state[ACTION_SKIP] = state[ACTION_SKIP] + ALPHA * (0 - state[ACTION_SKIP])
  state.nSubscribe += 1
  state.nSkip += 1

  qTable[stateKey] = state

  return {
    stateKey,
    qSubscribe: state[ACTION_SUBSCRIBE],
    qSkip: state[ACTION_SKIP],
    samples: state.nSubscribe,
    reward,
  }
}

export default {
  encodeDualState,
  evaluateDualPolicy,
  learnFromSettlement,
  dualComposeReward,
  DEFAULT_REWARD_CONFIG,
  bucketDelta,
  bucketDcaGap,
  calcDcaGapPct,
  plusValueOnExercise,
}
