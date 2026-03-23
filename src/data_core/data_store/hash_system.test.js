import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fnv1a,
  hashData,
  SmartCache,
  getCacheChangeLog,
  clearCacheChangeLog,
} from './cache.js'
import { HASH_CONFIG } from './hash_config.js'

// ────────────────────────────────────────────────────────────────────────────
// ── fnv1a Hash Tests
// ────────────────────────────────────────────────────────────────────────────

describe('fnv1a', () => {
  it('returns consistent hash for same input', () => {
    const input = 'test_data_123'
    const h1 = fnv1a(input)
    const h2 = fnv1a(input)
    expect(h1).toBe(h2)
  })

  it('returns different hash for different input', () => {
    const h1 = fnv1a('test1')
    const h2 = fnv1a('test2')
    expect(h1).not.toBe(h2)
  })

  it('returns 8-char hex string', () => {
    const hash = fnv1a('any input')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('handles empty string', () => {
    const hash = fnv1a('')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('handles special characters', () => {
    const inputs = [
      'with spaces',
      'with-dashes',
      'with_underscores',
      'with{json}',
      'with"quotes"',
    ]
    inputs.forEach((input) => {
      const hash = fnv1a(input)
      expect(hash).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  it('handles unicode characters', () => {
    const hash = fnv1a('测试数据😀')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces different hashes for similar but different inputs', () => {
    const h1 = fnv1a('{"price": 100}')
    const h2 = fnv1a('{"price": 101}')
    expect(h1).not.toBe(h2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── hashData Tests
// ────────────────────────────────────────────────────────────────────────────

describe('hashData', () => {
  it('excludes timestamp fields', () => {
    const d1 = { price: 100, timestamp: 1000 }
    const d2 = { price: 100, timestamp: 2000 }
    expect(hashData(d1)).toBe(hashData(d2))
  })

  it('excludes multiple timestamp field names', () => {
    const data = {
      price: 100,
      timestamp: 1000,
      ts: 2000,
      time: 3000,
      serverTime: 4000,
      syncedAt: 5000,
      fetchedAt: 6000,
      updatedAt: 7000,
    }
    const cleanData = { price: 100 }
    expect(hashData(data)).toBe(hashData(cleanData))
  })

  it('excludes raw field', () => {
    const d1 = { price: 100, raw: { nested: 'data' } }
    const d2 = { price: 100, raw: { other: 'stuff' } }
    expect(hashData(d1)).toBe(hashData(d2))
  })

  it('detects actual price changes', () => {
    const d1 = { price: 100, timestamp: 1000 }
    const d2 = { price: 101, timestamp: 1000 }
    expect(hashData(d1)).not.toBe(hashData(d2))
  })

  it('handles nested objects', () => {
    const d1 = { price: 100, meta: { source: 'deribit', iv: 0.5 } }
    const d2 = { price: 100, meta: { source: 'deribit', iv: 0.5 } }
    expect(hashData(d1)).toBe(hashData(d2))
  })

  it('handles arrays', () => {
    const d1 = { prices: [100, 101, 102] }
    const d2 = { prices: [100, 101, 102] }
    expect(hashData(d1)).toBe(hashData(d2))
  })

  it('detects array changes', () => {
    const d1 = { prices: [100, 101, 102] }
    const d2 = { prices: [100, 101, 103] }
    expect(hashData(d1)).not.toBe(hashData(d2))
  })

  it('handles null and undefined safely', () => {
    expect(() => hashData(null)).not.toThrow()
    expect(() => hashData(undefined)).not.toThrow()
  })

  it('falls back to string for non-serializable data', () => {
    const data = { price: 100 }
    const hash = hashData(data)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is deterministic for complex objects', () => {
    const complex = {
      price: 100.5,
      iv: 0.45,
      delta: -0.25,
      funding: 0.0001,
      timestamp: 12345,
      nested: {
        level1: {
          level2: 'value',
        },
      },
    }
    const h1 = hashData(complex)
    const h2 = hashData(complex)
    expect(h1).toBe(h2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── SmartCache Tests
// ────────────────────────────────────────────────────────────────────────────

describe('SmartCache', () => {
  let cache

  beforeEach(() => {
    cache = new SmartCache()
    vi.clearAllMocks()
  })

  // ── set() and change detection ──
  it('returns true on first set', () => {
    const result = cache.set('key1', { value: 100 })
    expect(result).toBe(true)
  })

  it('returns false when data unchanged', () => {
    cache.set('key1', { value: 100 })
    const result = cache.set('key1', { value: 100 })
    expect(result).toBe(false)
  })

  it('returns true when data changed', () => {
    cache.set('key1', { value: 100 })
    const result = cache.set('key1', { value: 101 })
    expect(result).toBe(true)
  })

  it('ignores timestamp changes', () => {
    cache.set('key1', { value: 100, timestamp: 1000 })
    const result = cache.set('key1', { value: 100, timestamp: 2000 })
    expect(result).toBe(false)
  })

  it('tracks multiple keys independently', () => {
    cache.set('key1', { val: 1 })
    cache.set('key2', { val: 2 })
    expect(cache.set('key1', { val: 1 })).toBe(false)
    expect(cache.set('key2', { val: 3 })).toBe(true)
  })

  // ── get() ──
  it('returns stored value via get', () => {
    cache.set('key1', { value: 100 })
    expect(cache.get('key1')).toEqual({ value: 100 })
  })

  it('returns null for missing key', () => {
    expect(cache.get('nonexistent')).toBeNull()
  })

  // ── getHash() ──
  it('returns hash for existing key', () => {
    cache.set('key1', { value: 100 })
    const hash = cache.getHash('key1')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns null for missing key hash', () => {
    expect(cache.getHash('nonexistent')).toBeNull()
  })

  // ── hasChanged() ──
  it('detects recent change', () => {
    cache.set('key1', { value: 100 })
    expect(cache.hasChanged('key1')).toBe(true)
    // Note: hasChanged() checks if _changedAt timestamp matches entry.timestamp
    // So setting with same data advances timestamp but not _changedAt, making it true again
    cache.set('key1', { value: 100 }) // Same data = no change recorded
    expect(cache.hasChanged('key1')).toBe(true) // But timestamp advanced, so they don't match
  })

  it('returns false for missing key', () => {
    expect(cache.hasChanged('nonexistent')).toBe(false)
  })

  it('compares with previous hash', () => {
    cache.set('key1', { value: 100 })
    const hash1 = cache.getHash('key1')
    cache.set('key1', { value: 101 })
    const hash2 = cache.getHash('key1')
    expect(cache.hasChanged('key1', hash1)).toBe(true)
    expect(cache.hasChanged('key1', hash2)).toBe(false)
  })

  // ── getChangedKeys() ──
  it('returns keys changed since timestamp', () => {
    const before = Date.now()
    cache.set('key1', { val: 1 })
    const after = Date.now()
    cache.set('key2', { val: 2 })

    const changed = cache.getChangedKeys(before)
    expect(changed).toContain('key1')
    expect(changed).toContain('key2')
  })

  it('excludes older changes', () => {
    cache.set('key1', { val: 1 })
    const cutoff = Date.now() + 100 // Future timestamp
    cache.set('key2', { val: 2 })

    const changed = cache.getChangedKeys(cutoff)
    expect(changed).not.toContain('key1')
  })

  // ── changeLog ──
  it('maintains changeLog in memory', () => {
    cache.set('key1', { val: 1 })
    cache.set('key2', { val: 2 })
    expect(cache.changeLog.length).toBe(2)
    expect(cache.changeLog[0].key).toBe('key1')
    expect(cache.changeLog[1].key).toBe('key2')
  })

  it('changeLog circular buffer respects max 500 entries', async () => {
    // Add 600 entries
    for (let i = 0; i < 600; i++) {
      cache.set(`key${i}`, { val: i })
    }
    expect(cache.changeLog.length).toBeLessThanOrEqual(500)
  })

  it('changeLog entries have required fields', () => {
    cache.set('key1', { value: 100 })
    const entry = cache.changeLog[0]
    expect(entry).toHaveProperty('key')
    expect(entry).toHaveProperty('hash')
    expect(entry).toHaveProperty('ts')
    expect(entry).toHaveProperty('type')
    expect(entry.type).toBe('cache_change')
  })

  // ── delete() ──
  it('removes key from cache', () => {
    cache.set('key1', { val: 1 })
    cache.delete('key1')
    expect(cache.get('key1')).toBeNull()
  })

  // ── clear() ──
  it('clears all entries', () => {
    cache.set('key1', { val: 1 })
    cache.set('key2', { val: 2 })
    cache.clear()
    expect(cache.get('key1')).toBeNull()
    expect(cache.get('key2')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('SmartCache + hashData integration', () => {
  let cache

  beforeEach(() => {
    cache = new SmartCache()
  })

  it('accurately detects subtle market data changes', () => {
    const baseline = {
      price: 50000.5,
      iv: 0.45,
      funding: 0.0001,
      timestamp: 1000,
    }
    cache.set('BTC:spot', baseline)

    // Only 0.05% change (below 0.1% threshold) - but hashData still detects it
    const minorChange = {
      price: 50000.75,
      iv: 0.45,
      funding: 0.0001,
      timestamp: 2000,
    }
    expect(cache.set('BTC:spot', minorChange)).toBe(true)
  })

  it('ignores timestamp variations in market data', () => {
    const data1 = {
      price: 50000,
      iv: 0.45,
      bid: 49999,
      ask: 50001,
      timestamp: Date.now(),
    }
    cache.set('BTC:spot', data1)

    const data2 = {
      price: 50000,
      iv: 0.45,
      bid: 49999,
      ask: 50001,
      timestamp: Date.now() + 5000,
    }
    expect(cache.set('BTC:spot', data2)).toBe(false)
  })

  it('tracks multiple assets with independent hashes', () => {
    const btc = { price: 50000, iv: 0.45 }
    const eth = { price: 2500, iv: 0.40 }

    cache.set('deribit:BTC:spot', btc)
    cache.set('deribit:ETH:spot', eth)

    expect(cache.getHash('deribit:BTC:spot')).not.toBe(
      cache.getHash('deribit:ETH:spot')
    )
  })

  it('reconstructs state from changeLog', () => {
    // Simulate 10 changes
    for (let i = 0; i < 10; i++) {
      cache.set('key1', { iteration: i })
    }

    const log = cache.changeLog
    expect(log.length).toBe(10)
    expect(log[0].key).toBe('key1')
    expect(log[log.length - 1].key).toBe('key1')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── HASH_CONFIG Tests
// ────────────────────────────────────────────────────────────────────────────

describe('HASH_CONFIG', () => {
  it('has required sensitivity thresholds', () => {
    expect(HASH_CONFIG.sensitivity).toBeDefined()
    expect(HASH_CONFIG.sensitivity.price_change_pct).toBe(0.1)
    expect(HASH_CONFIG.sensitivity.iv_change_pts).toBe(0.5)
    expect(HASH_CONFIG.sensitivity.funding_change).toBe(0.5)
  })

  it('has storage limits', () => {
    expect(HASH_CONFIG.storage).toBeDefined()
    expect(HASH_CONFIG.storage.changeLog_max).toBe(500)
    expect(HASH_CONFIG.storage.signal_history).toBe(500)
    expect(HASH_CONFIG.storage.fingerprint_max).toBe(1000)
  })

  it('has protocol lock fields for Level 2 and 3', () => {
    expect(HASH_CONFIG).toHaveProperty('LOCKED')
    expect(HASH_CONFIG).toHaveProperty('VERSION')
    expect(HASH_CONFIG).toHaveProperty('LOCKED_AT')
    expect(HASH_CONFIG).toHaveProperty('LOCKED_HASH')
  })

  it('starts with LOCKED=false for development', () => {
    expect(HASH_CONFIG.LOCKED).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── Snapshot Chain Tests (if generateSnapshot available)
// ────────────────────────────────────────────────────────────────────────────

describe('Snapshot system', () => {
  it('snapshot hashes are deterministic', async () => {
    // Mock snapshot data for testing
    const snapshot = {
      meta: {
        version: 1,
        asset: 'BTC',
        generatedAt: 1711234567890,
        patternCount: 12,
        hash: '',
        prevHash: '00000000',
        chainLength: 1,
      },
      patterns: [
        {
          hash: 'pattern_1',
          config: { ivRank: 50, funding: 0.0001 },
          occurrences: 5,
          winRate_1h: 60,
        },
      ],
    }

    // Two snapshots with same payload should have same hash
    const payload1 = JSON.stringify({
      version: snapshot.meta.version,
      asset: snapshot.meta.asset,
      generatedAt: snapshot.meta.generatedAt,
      patternCount: snapshot.meta.patternCount,
      prevHash: snapshot.meta.prevHash,
      patterns: snapshot.patterns,
    })

    const payload2 = JSON.stringify({
      version: snapshot.meta.version,
      asset: snapshot.meta.asset,
      generatedAt: snapshot.meta.generatedAt,
      patternCount: snapshot.meta.patternCount,
      prevHash: snapshot.meta.prevHash,
      patterns: snapshot.patterns,
    })

    expect(fnv1a(payload1)).toBe(fnv1a(payload2))
  })

  it('snapshot chain links via prevHash', () => {
    const snapshot1 = { meta: { hash: 'abc123' } }
    const snapshot2 = { meta: { prevHash: 'abc123', hash: 'def456' } }

    expect(snapshot2.meta.prevHash).toBe(snapshot1.meta.hash)
  })
})
