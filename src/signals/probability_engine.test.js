import { describe, it, expect, beforeEach } from 'vitest'
import {
  patternStats,
  updatePatternStats,
  computeProbabilities,
  storeSignal,
  evaluateSignals,
  getTimeframeStats,
  computeAdvancedStatsForHash,
  TIMEFRAMES,
} from './probability_engine.js'

// Réinitialise patternStats et les signaux en attente avant chaque test
beforeEach(() => {
  for (const key of Object.keys(patternStats)) {
    delete patternStats[key]
  }
  // Vide les signaux en attente restants sans impacter le test suivant
  evaluateSignals(0)
})

// ── updatePatternStats ────────────────────────────────────────────────────────

describe('updatePatternStats', () => {
  it('crée une entrée multi-timeframe pour un nouveau hash', () => {
    updatePatternStats('abc', 0.05)
    expect(patternStats['abc']).toBeDefined()
    for (const tf of TIMEFRAMES) {
      expect(patternStats['abc'][tf]).toBeDefined()
    }
    expect(patternStats['abc']['24h'].occurrences).toBe(1)
  })

  it('incrémente occurrences à chaque appel (timeframe par défaut : 24h)', () => {
    updatePatternStats('abc', 0.05)
    updatePatternStats('abc', -0.03)
    expect(patternStats['abc']['24h'].occurrences).toBe(2)
  })

  it('compte move > 0.01 comme upMove', () => {
    updatePatternStats('h1', 0.02)
    expect(patternStats['h1']['24h'].upMoves).toBe(1)
    expect(patternStats['h1']['24h'].downMoves).toBe(0)
    expect(patternStats['h1']['24h'].flatMoves).toBe(0)
  })

  it('compte move < -0.01 comme downMove', () => {
    updatePatternStats('h2', -0.05)
    expect(patternStats['h2']['24h'].downMoves).toBe(1)
    expect(patternStats['h2']['24h'].upMoves).toBe(0)
    expect(patternStats['h2']['24h'].flatMoves).toBe(0)
  })

  it('compte move dans [-0.01, 0.01] comme flatMove', () => {
    updatePatternStats('h3', 0.005)
    updatePatternStats('h3', -0.005)
    updatePatternStats('h3', 0)
    expect(patternStats['h3']['24h'].flatMoves).toBe(3)
    expect(patternStats['h3']['24h'].upMoves).toBe(0)
    expect(patternStats['h3']['24h'].downMoves).toBe(0)
  })

  it('maintient les moyennes courantes avgUpMove et avgDownMove', () => {
    updatePatternStats('h4', 0.03)
    updatePatternStats('h4', 0.07)
    updatePatternStats('h4', -0.04)
    // avgUpMove = (0.03 + 0.07) / 2 = 0.05
    expect(patternStats['h4']['24h'].avgUpMove).toBeCloseTo(0.05)
    expect(patternStats['h4']['24h'].avgDownMove).toBeCloseTo(-0.04)
  })

  it('limite : move exactement 0.01 → flatMove', () => {
    updatePatternStats('h5', 0.01)
    expect(patternStats['h5']['24h'].flatMoves).toBe(1)
  })

  it('limite : move exactement -0.01 → flatMove', () => {
    updatePatternStats('h6', -0.01)
    expect(patternStats['h6']['24h'].flatMoves).toBe(1)
  })

  it('met à jour uniquement le timeframe spécifié', () => {
    updatePatternStats('h7', 0.05, '1h')
    expect(patternStats['h7']['1h'].occurrences).toBe(1)
    expect(patternStats['h7']['24h'].occurrences).toBe(0)
    expect(patternStats['h7']['7d'].occurrences).toBe(0)
  })

  it('met à jour la distribution avec classifyMove (move en fraction → %)', () => {
    // 0.05 fraction = 5% → classifyMove(5) = 'bigUp' (> 3)
    updatePatternStats('h8', 0.05)
    expect(patternStats['h8']['24h'].distribution.bigUp).toBe(1)
    // 0.02 fraction = 2% → classifyMove(2) = 'up' (0.1 < 2 ≤ 3)
    updatePatternStats('h8', 0.02)
    expect(patternStats['h8']['24h'].distribution.up).toBe(1)
    // -0.05 fraction = -5% → classifyMove(-5) = 'bigDown' (< -3)
    updatePatternStats('h8', -0.05)
    expect(patternStats['h8']['24h'].distribution.bigDown).toBe(1)
  })
})

// ── computeProbabilities ──────────────────────────────────────────────────────

describe('computeProbabilities', () => {
  it('retourne les probabilités correctes', () => {
    updatePatternStats('p1', 0.05)
    updatePatternStats('p1', 0.03)
    updatePatternStats('p1', -0.04)
    updatePatternStats('p1', 0.005)

    const result = computeProbabilities(patternStats['p1']['24h'])

    expect(result.probUp).toBeCloseTo(2 / 4)
    expect(result.probDown).toBeCloseTo(1 / 4)
    expect(result.probFlat).toBeCloseTo(1 / 4)
  })

  it('retourne le avgUpMove correct', () => {
    updatePatternStats('p2', 0.04)
    updatePatternStats('p2', 0.06)

    const result = computeProbabilities(patternStats['p2']['24h'])
    expect(result.avgUpMove).toBeCloseTo(0.05)
  })

  it('retourne le avgDownMove correct', () => {
    updatePatternStats('p3', -0.02)
    updatePatternStats('p3', -0.06)

    const result = computeProbabilities(patternStats['p3']['24h'])
    expect(result.avgDownMove).toBeCloseTo(-0.04)
  })

  it('retourne 0 pour avgUpMove quand aucun upMove', () => {
    updatePatternStats('p4', -0.03)
    const result = computeProbabilities(patternStats['p4']['24h'])
    expect(result.avgUpMove).toBe(0)
  })

  it('retourne 0 pour avgDownMove quand aucun downMove', () => {
    updatePatternStats('p5', 0.03)
    const result = computeProbabilities(patternStats['p5']['24h'])
    expect(result.avgDownMove).toBe(0)
  })

  it('gère un stat avec zéro occurrence sans division par zéro', () => {
    const emptyStat = {
      occurrences: 0,
      upMoves:     0,
      downMoves:   0,
      flatMoves:   0,
      avgUpMove:   0,
      avgDownMove: 0,
      distribution: { bigDown: 0, down: 0, flat: 0, up: 0, bigUp: 0 },
    }
    const result = computeProbabilities(emptyStat)
    expect(result.probUp).toBe(0)
    expect(result.probDown).toBe(0)
    expect(result.probFlat).toBe(0)
    expect(result.avgUpMove).toBe(0)
    expect(result.avgDownMove).toBe(0)
  })

  it('gère null comme stat sans erreur', () => {
    const result = computeProbabilities(null)
    expect(result.probUp).toBe(0)
    expect(result.probDown).toBe(0)
    expect(result.probFlat).toBe(0)
    expect(result.avgUpMove).toBe(0)
    expect(result.avgDownMove).toBe(0)
  })
})

// ── storeSignal / evaluateSignals ─────────────────────────────────────────────

describe('storeSignal + evaluateSignals', () => {
  it('evaluateSignals calcule le bon move et met à jour patternStats', () => {
    storeSignal({ hash: 'sig1', entryPrice: 100, timestamp: Date.now() })
    evaluateSignals(105)

    // move = (105 - 100) / 100 = 0.05 → upMove
    expect(patternStats['sig1']['24h'].occurrences).toBe(1)
    expect(patternStats['sig1']['24h'].upMoves).toBe(1)
    expect(patternStats['sig1']['24h'].downMoves).toBe(0)
  })

  it('evaluateSignals supprime tous les signaux en attente après traitement', () => {
    storeSignal({ hash: 'sig2', entryPrice: 200, timestamp: Date.now() })
    evaluateSignals(190)
    // Second appel ne doit pas ajouter une occurrence supplémentaire
    evaluateSignals(190)
    expect(patternStats['sig2']['24h'].occurrences).toBe(1)
  })

  it('evaluateSignals gère plusieurs signaux en attente', () => {
    storeSignal({ hash: 'multi', entryPrice: 100, timestamp: Date.now() })
    storeSignal({ hash: 'multi', entryPrice: 200, timestamp: Date.now() })
    evaluateSignals(110) // moves: +10% et -45%

    expect(patternStats['multi']['24h'].occurrences).toBe(2)
    expect(patternStats['multi']['24h'].upMoves).toBe(1)   // (110-100)/100 = 0.10
    expect(patternStats['multi']['24h'].downMoves).toBe(1) // (110-200)/200 = -0.45
  })

  it('workflow complet : store → evaluate → computeProbabilities est déterministe', () => {
    const hash = 'workflow'
    storeSignal({ hash, entryPrice: 1000, timestamp: 1 })
    storeSignal({ hash, entryPrice: 1000, timestamp: 2 })
    storeSignal({ hash, entryPrice: 1000, timestamp: 3 })
    evaluateSignals(1050) // tous les moves +5%

    const result = computeProbabilities(patternStats[hash]['24h'])
    expect(result.probUp).toBeCloseTo(1)
    expect(result.probDown).toBeCloseTo(0)
    expect(result.avgUpMove).toBeCloseTo(0.05)
  })

  it('evaluateSignals met à jour le timeframe spécifié', () => {
    storeSignal({ hash: 'tf_test', entryPrice: 100, timestamp: Date.now() })
    evaluateSignals(110, '1h')

    expect(patternStats['tf_test']['1h'].occurrences).toBe(1)
    expect(patternStats['tf_test']['24h'].occurrences).toBe(0)
  })
})

// ── getTimeframeStats ─────────────────────────────────────────────────────────

describe('getTimeframeStats', () => {
  it('retourne null pour un hash inexistant', () => {
    expect(getTimeframeStats('unknown')).toBeNull()
  })

  it('retourne les stats multi-timeframes après mise à jour', () => {
    updatePatternStats('tf1', 0.05, '1h')
    updatePatternStats('tf1', 0.03, '24h')

    const stats = getTimeframeStats('tf1')
    expect(stats).not.toBeNull()
    expect(stats['1h'].occurrences).toBe(1)
    expect(stats['24h'].occurrences).toBe(1)
    expect(stats['7d'].occurrences).toBe(0)
  })
})

// ── computeAdvancedStatsForHash ───────────────────────────────────────────────

describe('computeAdvancedStatsForHash', () => {
  it('retourne null pour un hash inexistant', () => {
    expect(computeAdvancedStatsForHash('unknown')).toBeNull()
  })

  it('retourne null si le timeframe n\'a aucune occurrence', () => {
    updatePatternStats('adv1', 0.05, '1h')
    // '24h' est vide
    expect(computeAdvancedStatsForHash('adv1', '24h')).toBeNull()
  })

  it('calcule correctement les métriques avancées', () => {
    updatePatternStats('adv2', 0.05)
    updatePatternStats('adv2', 0.03)
    updatePatternStats('adv2', -0.02)

    const result = computeAdvancedStatsForHash('adv2', '24h')
    expect(result).not.toBeNull()
    expect(result.probUp).toBeCloseTo(2 / 3)
    expect(result.probDown).toBeCloseTo(1 / 3)
    expect(typeof result.expectedValue).toBe('number')
    expect(result.distribution).toBeDefined()
  })

  it('utilise \'24h\' comme timeframe par défaut', () => {
    updatePatternStats('adv3', 0.05)
    const result = computeAdvancedStatsForHash('adv3')
    expect(result).not.toBeNull()
  })
})
