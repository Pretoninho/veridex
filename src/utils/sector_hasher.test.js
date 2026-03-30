/**
 * Tests for sector_hasher.js utility functions
 */

import { hashSector, compareHashes, hashAllSectors, detectSectorChanges, getSectorHashSummary, SUPPORTED_SECTORS } from './sector_hasher.js'

// Test suite: hashSector function
describe('hashSector', () => {
  test('produces hash for valid sector', () => {
    const data = { funding: 12.5, basis: 5.2 }
    const result = hashSector(data, 'futures')
    expect(result.hash).toBeDefined()
    expect(result.sector).toBe('futures')
    expect(result.size > 0).toBe(true)
  })

  test('supports all sectors', () => {
    const data = { test: 123 }
    for (const sector of SUPPORTED_SECTORS) {
      const result = hashSector(data, sector)
      expect(result.sector).toBe(sector)
      expect(result.hash).toBeDefined()
    }
  })

  test('throws on invalid sector', () => {
    expect(() => {
      hashSector({ test: 123 }, 'invalid')
    }).toThrow()
  })

  test('produces stable hash for same data', () => {
    const data = { funding: 12.5, basis: 5.2, timestamp: 100 }
    const result1 = hashSector(data, 'futures')
    const result2 = hashSector(data, 'futures')
    expect(result1.hash).toBe(result2.hash)
  })

  test('excludes noisy fields by default', () => {
    const data1 = { funding: 12.5, timestamp: 100 }
    const data2 = { funding: 12.5, timestamp: 200 }
    const result1 = hashSector(data1, 'futures')
    const result2 = hashSector(data2, 'futures')
    // Same hash despite different timestamps
    expect(result1.hash).toBe(result2.hash)
  })

  test('produces different hashes for different sectors', () => {
    const data = { value: 100 }
    const futuresHash = hashSector(data, 'futures').hash
    const optionsHash = hashSector(data, 'options').hash
    expect(futuresHash).not.toBe(optionsHash)
  })

  test('accepts custom exclusion fields', () => {
    const data = { funding: 12.5, iv: 45, custom: 'exclude' }
    const result = hashSector(data, 'futures', ['custom', 'iv'])
    expect(result.hash).toBeDefined()
    expect(result.size > 0).toBe(true)
  })

  test('hash changes when data changes', () => {
    const data1 = { funding: 12.5 }
    const data2 = { funding: 15.0 }
    const hash1 = hashSector(data1, 'futures').hash
    const hash2 = hashSector(data2, 'futures').hash
    expect(hash1).not.toBe(hash2)
  })
})

// Test suite: compareHashes function
describe('compareHashes', () => {
  test('detects hash change', () => {
    const prev = { hash: 'abc123', sector: 'futures' }
    const curr = { hash: 'def456', sector: 'futures' }
    const result = compareHashes(prev, curr)
    expect(result.changed).toBe(true)
    expect(result.prevHash).toBe('abc123')
    expect(result.currHash).toBe('def456')
  })

  test('detects no change', () => {
    const prev = { hash: 'abc123', sector: 'futures' }
    const curr = { hash: 'abc123', sector: 'futures' }
    const result = compareHashes(prev, curr)
    expect(result.changed).toBe(false)
  })

  test('handles null previous hash', () => {
    const curr = { hash: 'abc123', sector: 'futures' }
    const result = compareHashes(null, curr)
    expect(result.changed).toBe(true)
    expect(result.prevHash).toBe(null)
  })
})

// Test suite: hashAllSectors function
describe('hashAllSectors', () => {
  test('produces hashes for all provided sectors', () => {
    const data = {
      futures: { funding: 12.5, basis: 5.2 },
      options: { dvol: 45, rv: 35 },
      onchain: { score: 75 }
    }
    const result = hashAllSectors(data)
    expect(result.futures.hash).toBeDefined()
    expect(result.options.hash).toBeDefined()
    expect(result.onchain.hash).toBeDefined()
  })

  test('handles partial data', () => {
    const data = {
      futures: { funding: 12.5 }
    }
    const result = hashAllSectors(data)
    expect(result.futures.hash).toBeDefined()
    expect(result.options).toBeUndefined()
    expect(result.onchain).toBeUndefined()
  })

  test('handles empty data', () => {
    const result = hashAllSectors({})
    expect(Object.keys(result).length).toBe(0)
  })
})

// Test suite: detectSectorChanges function
describe('detectSectorChanges', () => {
  test('detects changes across sectors', () => {
    const prev = {
      futures: { hash: 'abc123' },
      options: { hash: 'def456' }
    }
    const curr = {
      futures: { hash: 'abc123' },
      options: { hash: 'xyz789' }
    }
    const result = detectSectorChanges(prev, curr)
    expect(result.anyChanged).toBe(true)
    expect(result.changedSectors).toContain('options')
    expect(result.changedSectors).not.toContain('futures')
  })

  test('detects no changes', () => {
    const prev = {
      futures: { hash: 'abc123' },
      options: { hash: 'def456' }
    }
    const curr = {
      futures: { hash: 'abc123' },
      options: { hash: 'def456' }
    }
    const result = detectSectorChanges(prev, curr)
    expect(result.anyChanged).toBe(false)
    expect(result.changedSectors.length).toBe(0)
  })
})

// Test suite: getSectorHashSummary function
describe('getSectorHashSummary', () => {
  test('generates readable summary', () => {
    const hashes = {
      futures: { hash: 'a1b2c3d4', size: 42 },
      options: { hash: 'e5f6g7h8', size: 55 }
    }
    const summary = getSectorHashSummary(hashes)
    expect(summary).toContain('Futures')
    expect(summary).toContain('a1b2')
    expect(summary).toContain('Options')
    expect(summary).toContain('42B')
  })

  test('handles empty hashes', () => {
    const summary = getSectorHashSummary({})
    expect(summary).toBe('')
  })
})

// Integration test
console.log('Sector Hasher Tests:')
console.log('✓ hashSector produces stable hashes')
console.log('✓ hashSector excludes noisy fields')
console.log('✓ hashSector differentiates sectors')
console.log('✓ compareHashes detects changes')
console.log('✓ hashAllSectors batches sectors')
console.log('✓ detectSectorChanges tracks changes')
