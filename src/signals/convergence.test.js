import { describe, it, expect } from 'vitest'
import { buildCriteria, computeConvergence } from './convergence.js'

// ── buildCriteria ──────────────────────────────────────────────────────────────

describe('buildCriteria', () => {
  it('retourne 6 critères', () => {
    const criteria = buildCriteria({})
    expect(criteria).toHaveLength(6)
  })

  it('chaque critère a les champs requis', () => {
    const criteria = buildCriteria({})
    criteria.forEach(c => {
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('label')
      expect(c).toHaveProperty('threshold')
      expect(c).toHaveProperty('met')
    })
  })

  it('tous les met = 0 sans données', () => {
    const criteria = buildCriteria({})
    criteria.forEach(c => expect(c.met).toBe(0))
  })

  it('détecte ivRank élevé (absolu fallback)', () => {
    const criteria = buildCriteria({ ivRank: 80 })
    const ivRankCrit = criteria.find(c => c.id === 'ivRank')
    expect(ivRankCrit.met).toBe(1)
  })

  it('ne déclenche pas ivRank faible', () => {
    const criteria = buildCriteria({ ivRank: 20 })
    const ivRankCrit = criteria.find(c => c.id === 'ivRank')
    expect(ivRankCrit.met).toBe(0)
  })

  it('détecte funding élevé', () => {
    const criteria = buildCriteria({ funding: { rateAnn: 50 } })
    const fundingCrit = criteria.find(c => c.id === 'fundingAnn')
    expect(fundingCrit.met).toBe(1)
  })

  it("utilise seuils dynamiques quand assez d'historique", () => {
    const hist = { ivRank: Array.from({ length: 20 }, (_, i) => i * 5) } // 0..95
    const criteria = buildCriteria({ ivRank: 80, hist })
    const ivRankCrit = criteria.find(c => c.id === 'ivRank')
    expect(ivRankCrit.isDynamic).toBe(true)
  })
})

// ── computeConvergence ─────────────────────────────────────────────────────────

describe('computeConvergence', () => {
  const makeCriteria = (metCount, total = 6) =>
    Array.from({ length: total }, (_, i) => ({ met: i < metCount ? 1 : 0 }))

  it('retourne score = 0 et alert = false sans critères', () => {
    const result = computeConvergence([])
    expect(result.score).toBe(0)
    expect(result.alert).toBe(false)
  })

  it('signal fort quand ≥ 5 critères', () => {
    const result = computeConvergence(makeCriteria(5))
    expect(result.strength).toBe('strong')
    expect(result.alert).toBe(true)
  })

  it('convergence modérée quand ≥ 3 critères (défaut)', () => {
    const result = computeConvergence(makeCriteria(3))
    expect(result.strength).toBe('moderate')
    expect(result.alert).toBe(true)
  })

  it('insuffisant quand 1–2 critères', () => {
    const result = computeConvergence(makeCriteria(2))
    expect(result.strength).toBe('weak')
    expect(result.alert).toBe(false)
  })

  it('aucun signal quand 0 critère', () => {
    const result = computeConvergence(makeCriteria(0))
    expect(result.strength).toBe('none')
    expect(result.alert).toBe(false)
  })

  it('score = 100 quand tous les critères sont met', () => {
    const result = computeConvergence(makeCriteria(6))
    expect(result.score).toBe(100)
  })

  it('score ≈ 50 quand la moitié des critères sont met', () => {
    const result = computeConvergence(makeCriteria(3))
    expect(result.score).toBe(50)
  })

  it('respecte le minRequired personnalisé', () => {
    const result = computeConvergence(makeCriteria(2), 2)
    expect(result.alert).toBe(true)
  })

  it('retourne le tableau de critères inchangé', () => {
    const criteria = makeCriteria(3)
    const result = computeConvergence(criteria)
    expect(result.criteria).toBe(criteria)
  })
})
