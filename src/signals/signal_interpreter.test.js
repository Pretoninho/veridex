import { describe, it, expect } from 'vitest'
import { interpretSignal } from './signal_interpreter.js'

// Helper : construit un dvol tel que ivRank = valeur voulue (0-100)
const dvolForRank = (rank) => ({
  current:  rank,
  monthMin: 0,
  monthMax: 100,
})

// Helper : appelle interpretSignal avec le minimum requis
const optionsSignal = (score, dvol) =>
  interpretSignal({ global: score }, { dvol }).expert.recommendations.options.signal

// ── _getVolRegime (testé via _optionsReco via interpretSignal) ───────────────

describe('_getVolRegime — régime de volatilité', () => {
  it('ivRank >= 70 → HIGH_VOL → prioritise "Vendre la vol"', () => {
    expect(optionsSignal(50, dvolForRank(70))).toBe('Vendre la vol')
    expect(optionsSignal(50, dvolForRank(75))).toBe('Vendre la vol')
    expect(optionsSignal(50, dvolForRank(100))).toBe('Vendre la vol')
  })

  it('ivRank <= 30 → LOW_VOL → prioritise "Acheter la vol"', () => {
    expect(optionsSignal(90, dvolForRank(30))).toBe('Acheter la vol')
    expect(optionsSignal(90, dvolForRank(20))).toBe('Acheter la vol')
    expect(optionsSignal(90, dvolForRank(0))).toBe('Acheter la vol')
  })

  it('31 <= ivRank <= 69 → NEUTRAL → utilise le score', () => {
    // Score 85 dans NEUTRAL → "Vendre la vol"
    expect(optionsSignal(85, dvolForRank(50))).toBe('Vendre la vol')
    // Score 65 dans NEUTRAL → "Spreads vendeurs"
    expect(optionsSignal(65, dvolForRank(50))).toBe('Spreads vendeurs')
    // Score 45 dans NEUTRAL → "Achats sélectifs"
    expect(optionsSignal(45, dvolForRank(50))).toBe('Achats sélectifs')
    // Score 20 dans NEUTRAL → "Acheter la vol"
    expect(optionsSignal(20, dvolForRank(50))).toBe('Acheter la vol')
  })

  it('ivRank null (dvol absent) → NEUTRAL → utilise le score', () => {
    expect(optionsSignal(85, null)).toBe('Vendre la vol')
    expect(optionsSignal(20, null)).toBe('Acheter la vol')
  })
})

// ── _optionsReco — le régime prime sur le score ──────────────────────────────

describe('_optionsReco — régime prime sur le score', () => {
  it('HIGH_VOL avec score faible → "Vendre la vol" (régime > score)', () => {
    // Score = 30 → normalement "Acheter la vol", mais HIGH_VOL prend le dessus
    expect(optionsSignal(30, dvolForRank(80))).toBe('Vendre la vol')
  })

  it('LOW_VOL avec score élevé → "Acheter la vol" (régime > score)', () => {
    // Score = 90 → normalement "Vendre la vol", mais LOW_VOL prend le dessus
    expect(optionsSignal(90, dvolForRank(10))).toBe('Acheter la vol')
  })

  it('HIGH_VOL exact (ivRank=70) → "Vendre la vol"', () => {
    expect(optionsSignal(40, dvolForRank(70))).toBe('Vendre la vol')
  })

  it('LOW_VOL exact (ivRank=30) → "Acheter la vol"', () => {
    expect(optionsSignal(80, dvolForRank(30))).toBe('Acheter la vol')
  })
})

// ── _optionsReco — format de retour intact ───────────────────────────────────

describe('_optionsReco — format de retour intact', () => {
  it('retourne signal, action, timeframe, stopLoss, maxPain', () => {
    const result = interpretSignal({ global: 85 }, { dvol: dvolForRank(75), spot: 50000 })
    const opts = result.expert.recommendations.options
    expect(opts).toHaveProperty('signal')
    expect(opts).toHaveProperty('action')
    expect(opts).toHaveProperty('timeframe')
    expect(opts).toHaveProperty('stopLoss')
    expect(opts).toHaveProperty('maxPain')
  })

  it('action contient le IV Rank correct', () => {
    const result = interpretSignal({ global: 85 }, { dvol: dvolForRank(75) })
    expect(result.expert.recommendations.options.action).toContain('IV Rank 75%')
  })
})
