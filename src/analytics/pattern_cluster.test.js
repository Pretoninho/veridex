import { describe, it, expect } from 'vitest'
import { clusterPatterns } from './pattern_cluster.js'

describe('clusterPatterns', () => {
  it('retourne un objet vide pour un tableau vide', () => {
    expect(clusterPatterns([])).toEqual({})
  })

  it('regroupe les patterns par type_direction', () => {
    const patterns = [
      { type: 'strong', direction: 'bullish', ev: 0.8 },
      { type: 'strong', direction: 'bullish', ev: 0.6 },
      { type: 'moderate', direction: 'bearish', ev: -0.3 },
    ]
    const clusters = clusterPatterns(patterns)
    expect(Object.keys(clusters)).toHaveLength(2)
    expect(clusters['strong_bullish']).toHaveLength(2)
    expect(clusters['moderate_bearish']).toHaveLength(1)
  })

  it('utilise unknown_neutral quand type et direction sont absents', () => {
    const clusters = clusterPatterns([{ ev: 0.5 }])
    expect(clusters['unknown_neutral']).toBeDefined()
    expect(clusters['unknown_neutral']).toHaveLength(1)
  })

  it('utilise unknown comme fallback pour type absent', () => {
    const clusters = clusterPatterns([{ direction: 'bullish' }])
    expect(clusters['unknown_bullish']).toBeDefined()
  })

  it('utilise neutral comme fallback pour direction absente', () => {
    const clusters = clusterPatterns([{ type: 'strong' }])
    expect(clusters['strong_neutral']).toBeDefined()
  })

  it('conserve tous les champs originaux dans le cluster', () => {
    const p = { type: 'moderate', direction: 'bullish', ev: 0.4, count: 5 }
    const clusters = clusterPatterns([p])
    expect(clusters['moderate_bullish'][0]).toEqual(p)
  })

  it('retourne objet vide sans argument', () => {
    expect(clusterPatterns()).toEqual({})
  })
})
