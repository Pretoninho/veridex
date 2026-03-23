import { describe, it, expect } from 'vitest'
import { calcIVRank, calcIVPercentile, detectIVSpike, interpretIVRank, analyzeIV } from './iv_rank.js'

// ── calcIVRank ────────────────────────────────────────────────────────────────

describe('calcIVRank', () => {
  it('retourne null si valeur non-finie', () => {
    expect(calcIVRank(NaN, 30, 80)).toBeNull()
    expect(calcIVRank(50, NaN, 80)).toBeNull()
    expect(calcIVRank(50, 30, NaN)).toBeNull()
  })

  it('retourne null si max <= min', () => {
    expect(calcIVRank(50, 80, 30)).toBeNull()
    expect(calcIVRank(50, 50, 50)).toBeNull()
  })

  it('retourne 0 quand current = min', () => {
    expect(calcIVRank(30, 30, 80)).toBe(0)
  })

  it('retourne 100 quand current = max', () => {
    expect(calcIVRank(80, 30, 80)).toBe(100)
  })

  it('retourne 50 quand current est au milieu', () => {
    expect(calcIVRank(55, 30, 80)).toBe(50)
  })

  it('retourne valeur ∈ [0, 100] pour entrées normales', () => {
    const ivr = calcIVRank(60, 30, 100)
    expect(ivr).toBeGreaterThanOrEqual(0)
    expect(ivr).toBeLessThanOrEqual(100)
  })
})

// ── calcIVPercentile ──────────────────────────────────────────────────────────

describe('calcIVPercentile', () => {
  it('retourne null si current non-fini', () => {
    expect(calcIVPercentile(NaN, [30, 40, 50])).toBeNull()
  })

  it('retourne null si historique vide', () => {
    expect(calcIVPercentile(50, [])).toBeNull()
    expect(calcIVPercentile(50, null)).toBeNull()
  })

  it('retourne 0 si current est le minimum de l\'historique', () => {
    expect(calcIVPercentile(20, [30, 40, 50, 60])).toBe(0)
  })

  it('retourne 100 si current dépasse tout l\'historique', () => {
    expect(calcIVPercentile(100, [30, 40, 50, 60])).toBe(100)
  })

  it('ignore les valeurs non-finies dans l\'historique', () => {
    const pct = calcIVPercentile(50, [30, NaN, 40, Infinity, 60])
    expect(pct).toBeGreaterThanOrEqual(0)
    expect(pct).toBeLessThanOrEqual(100)
  })

  it('retourne ≈ 50 si current est au médian de l\'historique', () => {
    const pct = calcIVPercentile(50, [30, 40, 50, 60, 70])
    // 2 valeurs sur 5 sont < 50 → 40%
    expect(pct).toBe(40)
  })
})

// ── detectIVSpike ─────────────────────────────────────────────────────────────

describe('detectIVSpike', () => {
  it('retourne null si current non-fini', () => {
    expect(detectIVSpike(NaN, [30, 40, 50])).toBeNull()
  })

  it('retourne null si historique vide', () => {
    expect(detectIVSpike(50, [])).toBeNull()
    expect(detectIVSpike(50, null)).toBeNull()
  })

  it('détecte un spike quand current >> avg + threshold', () => {
    const result = detectIVSpike(80, [30, 32, 31, 33, 30], 10)
    expect(result.isSpike).toBe(true)
    expect(result.avg).toBeCloseTo(31.2, 1)
    expect(result.deviation).toBeGreaterThan(10)
  })

  it('ne détecte pas de spike pour une valeur normale', () => {
    const result = detectIVSpike(35, [30, 32, 31, 33, 30], 10)
    expect(result.isSpike).toBe(false)
  })

  it('respecte un seuil personnalisé', () => {
    // Avec threshold=30, un écart de 15 ne déclenche pas
    const result = detectIVSpike(50, [30, 32, 31, 33, 30], 30)
    expect(result.isSpike).toBe(false)
  })

  it('retourne avg, deviation et deviationPct', () => {
    const result = detectIVSpike(60, [40, 40, 40], 10)
    expect(result).toHaveProperty('avg', 40)
    expect(result).toHaveProperty('deviation', 20)
    expect(result).toHaveProperty('deviationPct', 50)
    expect(result).toHaveProperty('isSpike', true)
  })
})

// ── interpretIVRank ───────────────────────────────────────────────────────────

describe('interpretIVRank', () => {
  it('retourne N/A si null', () => {
    expect(interpretIVRank(null).label).toBe('N/A')
  })

  it('≥80 → Très élevée', () => {
    expect(interpretIVRank(80).label).toBe('Très élevée')
    expect(interpretIVRank(100).label).toBe('Très élevée')
  })

  it('60-79 → Élevée', () => {
    expect(interpretIVRank(60).label).toBe('Élevée')
    expect(interpretIVRank(79).label).toBe('Élevée')
  })

  it('40-59 → Normale', () => {
    expect(interpretIVRank(40).label).toBe('Normale')
  })

  it('20-39 → Basse', () => {
    expect(interpretIVRank(20).label).toBe('Basse')
  })

  it('<20 → Très basse', () => {
    expect(interpretIVRank(0).label).toBe('Très basse')
    expect(interpretIVRank(19).label).toBe('Très basse')
  })
})

// ── analyzeIV ─────────────────────────────────────────────────────────────────

describe('analyzeIV', () => {
  it('retourne null si dvol est null', () => {
    expect(analyzeIV(null)).toBeNull()
  })

  it('retourne ivRank, ivPercentile, spike, interpretation', () => {
    const dvol = {
      current: 65,
      monthMin: 30,
      monthMax: 80,
      history: [[0, 30], [0, 40], [0, 50], [0, 60], [0, 70]],
    }
    const result = analyzeIV(dvol)
    expect(result).toHaveProperty('ivRank')
    expect(result).toHaveProperty('ivPercentile')
    expect(result).toHaveProperty('spike')
    expect(result).toHaveProperty('interpretation')
  })

  it('accepte un historique de nombres plats (non-tableaux)', () => {
    const dvol = {
      current: 65,
      monthMin: 30,
      monthMax: 80,
      history: [30, 40, 50, 60, 70],
    }
    const result = analyzeIV(dvol)
    expect(result.ivRank).not.toBeNull()
  })
})
