import { beforeEach, describe, expect, it } from 'vitest'

import {
  evaluateDualPolicy,
  getDualRewardConfig,
  getDualRlSnapshot,
  learnFromSettlement,
  resetDualRewardConfig,
  resetDualRl,
  updateDualRewardConfig,
} from './rlDual.js'

function createLocalStorageMock() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

function baseCtx(overrides = {}) {
  return {
    asset: 'BTC',
    side: 'sell-high',
    strike: 78000,
    dca: 73000,
    dcaGapPct: ((78000 - 73000) / 73000) * 100,
    delta: 0.22,
    days: 14,
    expiryTs: Date.UTC(2026, 2, 27, 8, 0, 0),
    apr: 18,
    distPct: 5,
    iv: 72,
    plusValueLocked: true,
    trappedTrend: false,
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.localStorage = createLocalStorageMock()
  resetDualRl()
  resetDualRewardConfig()
})

describe('evaluateDualPolicy', () => {
  it('favorise un contrat en plus-value avec delta au-dessus du seuil', () => {
    const result = evaluateDualPolicy(baseCtx())

    expect(result.action).toBe('subscribe')
    expect(result.plusValueLocked).toBe(true)
    expect(result.deltaFloorOk).toBe(true)
    expect(result.protocol).toBe('plus-value-lock')
    expect(result.effectiveEdge).toBeGreaterThan(0)
  })

  it('active le protocole piege et prefere le strike le plus proche du DCA', () => {
    const nearDca = evaluateDualPolicy(baseCtx({
      strike: 71000,
      dca: 73000,
      dcaGapPct: ((71000 - 73000) / 73000) * 100,
      plusValueLocked: false,
      trappedTrend: true,
      delta: 0.21,
    }))
    const farDca = evaluateDualPolicy(baseCtx({
      strike: 65000,
      dca: 73000,
      dcaGapPct: ((65000 - 73000) / 73000) * 100,
      plusValueLocked: false,
      trappedTrend: true,
      delta: 0.21,
    }))

    expect(nearDca.protocol).toBe('trapped-trend-near-dca')
    expect(farDca.protocol).toBe('trapped-trend-near-dca')
    expect(nearDca.effectiveEdge).toBeGreaterThan(farDca.effectiveEdge)
  })

  it('bascule sur wait quand le strike est mauvais vs DCA et que le delta est trop faible', () => {
    const result = evaluateDualPolicy(baseCtx({
      strike: 69000,
      dca: 73000,
      dcaGapPct: ((69000 - 73000) / 73000) * 100,
      plusValueLocked: false,
      trappedTrend: false,
      delta: 0.12,
    }))

    expect(result.action).toBe('skip')
    expect(result.deltaFloorOk).toBe(false)
    expect(result.protocol).toBe('wait-better-strike')
    expect(result.effectiveEdge).toBeLessThan(0)
  })
})

describe('learnFromSettlement', () => {
  it('augmente la reward finale quand calendrier, DCA et delta sont alignes', () => {
    const evalResult = evaluateDualPolicy(baseCtx())
    learnFromSettlement({
      stateKey: evalResult.stateKey,
      rewardPct: 4,
      meta: {
        side: 'sell-high',
        strike: 78000,
        dca: 73000,
        dcaGapPct: ((78000 - 73000) / 73000) * 100,
        plusValueLocked: true,
        trappedTrend: false,
        delta: 0.22,
        exercised: false,
        days: 14,
        expiryTs: Date.UTC(2026, 2, 27, 8, 0, 0),
      },
    })

    const snapshot = getDualRlSnapshot()
    const last = snapshot.recentExperiences[0]

    expect(last.rewardBasePct).toBe(4)
    expect(last.rewardPct).toBeGreaterThan(last.rewardBasePct)
    expect(last.rewardDiagnostics.dca.plusValueLocked).toBe(true)
    expect(last.rewardDiagnostics.delta.deltaFloorOk).toBe(true)
    expect(last.rewardDiagnostics.calendar.isFriday).toBe(true)
  })

  it('alimente les stats protocolaires du dataset RL', () => {
    const goodState = evaluateDualPolicy(baseCtx())
    learnFromSettlement({
      stateKey: goodState.stateKey,
      rewardPct: 3,
      meta: {
        side: 'sell-high',
        strike: 78000,
        dca: 73000,
        dcaGapPct: ((78000 - 73000) / 73000) * 100,
        plusValueLocked: true,
        trappedTrend: false,
        delta: 0.25,
        exercised: false,
        days: 14,
        expiryTs: Date.UTC(2026, 2, 27, 8, 0, 0),
      },
    })

    const trappedState = evaluateDualPolicy(baseCtx({
      strike: 71000,
      plusValueLocked: false,
      trappedTrend: true,
      dcaGapPct: ((71000 - 73000) / 73000) * 100,
      delta: 0.18,
    }))
    learnFromSettlement({
      stateKey: trappedState.stateKey,
      rewardPct: 1,
      meta: {
        side: 'sell-high',
        strike: 71000,
        dca: 73000,
        dcaGapPct: ((71000 - 73000) / 73000) * 100,
        plusValueLocked: false,
        trappedTrend: true,
        delta: 0.18,
        exercised: false,
        days: 10,
        expiryTs: Date.UTC(2026, 2, 24, 8, 0, 0),
      },
    })

    const snapshot = getDualRlSnapshot()

    expect(snapshot.protocolStats.plusValueRate).toBeGreaterThan(0)
    expect(snapshot.protocolStats.trappedRate).toBeGreaterThan(0)
    expect(snapshot.protocolStats.deltaFloorRate).toBeLessThan(1)
    expect(snapshot.protocolStats.avgDeltaAbs).toBeGreaterThan(0.18)
  })
})

describe('reward config', () => {
  it('permet de modifier puis reinitialiser les coefficients DCA et delta', () => {
    const updated = updateDualRewardConfig({
      dcaWeight: 1.9,
      plusValueWeight: 3.2,
      deltaTarget: 0.25,
    })

    expect(updated.dcaWeight).toBe(1.9)
    expect(updated.plusValueWeight).toBe(3.2)
    expect(updated.deltaTarget).toBe(0.25)
    expect(getDualRewardConfig().deltaTarget).toBe(0.25)

    const reset = resetDualRewardConfig()

    expect(reset.dcaWeight).toBe(1.1)
    expect(reset.plusValueWeight).toBe(2.4)
    expect(reset.deltaTarget).toBe(0.2)
  })
})