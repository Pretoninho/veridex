import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordSnapshot,
  getMetricHistory,
  getMetricPoints,
  calcPercentile,
  calcThresholdAtPct,
  calcMovingAvg,
  livePercentile,
  dynamicThreshold,
  metricDiag,
} from './metric_history.js'

// Le setup.js fait un localStorage.clear() après chaque test.

describe('calcPercentile', () => {
  it('retourne null pour tableau vide', () => {
    expect(calcPercentile([], 50)).toBeNull()
  })

  it('retourne null si current non fini', () => {
    expect(calcPercentile([1, 2, 3], NaN)).toBeNull()
  })

  it('calcule le percentile correct', () => {
    const values = [10, 20, 30, 40, 50]
    // 2 valeurs < 30 → 2/5 * 100 = 40
    expect(calcPercentile(values, 30)).toBe(40)
  })

  it('retourne 0 si current est le plus bas', () => {
    expect(calcPercentile([10, 20, 30], 5)).toBe(0)
  })

  it('retourne 100 si current est le plus haut', () => {
    expect(calcPercentile([10, 20, 30], 100)).toBe(100)
  })
})

describe('calcThresholdAtPct', () => {
  it('retourne null pour tableau vide', () => {
    expect(calcThresholdAtPct([], 70)).toBeNull()
  })

  it('retourne la valeur minimale au percentile 0', () => {
    expect(calcThresholdAtPct([10, 20, 30, 40, 50], 0)).toBe(10)
  })

  it('retourne la valeur maximale au percentile 100', () => {
    expect(calcThresholdAtPct([10, 20, 30, 40, 50], 100)).toBe(50)
  })

  it('retourne la médiane au percentile 50', () => {
    expect(calcThresholdAtPct([10, 20, 30, 40, 50], 50)).toBe(30)
  })

  it('trie les valeurs avant calcul', () => {
    expect(calcThresholdAtPct([50, 10, 30, 20, 40], 0)).toBe(10)
  })
})

describe('calcMovingAvg', () => {
  it('retourne null pour tableau vide', () => {
    expect(calcMovingAvg([])).toBeNull()
  })

  it('calcule la moyenne correctement', () => {
    expect(calcMovingAvg([10, 20, 30])).toBeCloseTo(20)
  })

  it('retourne la valeur unique pour un seul élément', () => {
    expect(calcMovingAvg([42])).toBe(42)
  })
})

describe('recordSnapshot + getMetricHistory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('enregistre et récupère une valeur', () => {
    recordSnapshot('BTC', { dvol: 65 })
    const history = getMetricHistory('BTC', 'dvol')
    expect(history).toHaveLength(1)
    expect(history[0]).toBe(65)
  })

  it('ignore les valeurs null/undefined', () => {
    recordSnapshot('BTC', { dvol: null, rv: undefined, fundingAnn: 12 })
    expect(getMetricHistory('BTC', 'dvol')).toHaveLength(0)
    expect(getMetricHistory('BTC', 'fundingAnn')).toHaveLength(1)
  })

  it('ignore les valeurs non-finies', () => {
    recordSnapshot('BTC', { dvol: NaN, rv: Infinity })
    expect(getMetricHistory('BTC', 'dvol')).toHaveLength(0)
  })

  it('filtre par fenetre de temps (maxAgeDays=30 inclut les points recents)', () => {
    recordSnapshot('BTC', { dvol: 65 })
    const history = getMetricHistory('BTC', 'dvol', 30)
    expect(history).toHaveLength(1)
    expect(history[0]).toBe(65)
  })

  it('getMetricHistory retourne un tableau vide pour métrique inconnue', () => {
    expect(getMetricHistory('BTC', 'unknown_metric')).toEqual([])
  })

  it('throttle : deux appels rapprochés ne doublent pas le point', () => {
    recordSnapshot('BTC', { dvol: 60 })
    recordSnapshot('BTC', { dvol: 65 }) // dans la même fenêtre de throttle
    expect(getMetricHistory('BTC', 'dvol')).toHaveLength(1)
  })

  it('différencie les assets', () => {
    recordSnapshot('BTC', { dvol: 60 })
    recordSnapshot('ETH', { dvol: 80 })
    expect(getMetricHistory('BTC', 'dvol')).toEqual([60])
    expect(getMetricHistory('ETH', 'dvol')).toEqual([80])
  })
})

describe('getMetricPoints', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retourne des points avec ts et v', () => {
    recordSnapshot('BTC', { ivRank: 75 })
    const points = getMetricPoints('BTC', 'ivRank')
    expect(points).toHaveLength(1)
    expect(points[0]).toHaveProperty('ts')
    expect(points[0]).toHaveProperty('v', 75)
  })
})

describe('livePercentile + dynamicThreshold', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('livePercentile retourne null sans historique', () => {
    expect(livePercentile('BTC', 'dvol', 65)).toBeNull()
  })

  it('dynamicThreshold retourne null sans historique', () => {
    expect(dynamicThreshold('BTC', 'dvol')).toBeNull()
  })
})

describe('metricDiag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retourne count=0 pour métrique inconnue', () => {
    const diag = metricDiag('BTC', 'unknown')
    expect(diag.count).toBe(0)
    expect(diag.min).toBeNull()
  })

  it('retourne les métriques correctes après un snapshot', () => {
    recordSnapshot('BTC', { dvol: 55 })
    const diag = metricDiag('BTC', 'dvol')
    expect(diag.count).toBe(1)
    expect(diag.min).toBe(55)
    expect(diag.max).toBe(55)
    expect(diag.avg).toBe(55)
    expect(diag.firstTs).toBeGreaterThan(0)
    expect(diag.lastTs).toBeGreaterThan(0)
  })
})
