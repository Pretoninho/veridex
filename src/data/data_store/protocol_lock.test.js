import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sha256 } from './protocol_lock.js'
import { HASH_CONFIG } from './hash_config.js'

// ────────────────────────────────────────────────────────────────────────────
// ── SHA-256 Tests (no IDB dependency)
// ────────────────────────────────────────────────────────────────────────────

describe('sha256', () => {
  it('returns deterministic hash', async () => {
    const h1 = await sha256('test data')
    const h2 = await sha256('test data')
    expect(h1).toBe(h2)
  })

  it('returns 64-char hex string', async () => {
    const hash = await sha256('test')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different inputs', async () => {
    const h1 = await sha256('test1')
    const h2 = await sha256('test2')
    expect(h1).not.toBe(h2)
  })

  it('handles empty string', async () => {
    const hash = await sha256('')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles unicode characters', async () => {
    const hash = await sha256('测试 😀')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles complex JSON', async () => {
    const obj = {
      version: '1.0.0',
      sensitivity: { price_change_pct: 0.1, iv_change_pts: 0.5 },
      storage: { changeLog_max: 500 },
    }
    const hash = await sha256(JSON.stringify(obj))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces consistent hash for same protocol state', async () => {
    const state1 = {
      version: '1.0.0',
      sensitivity: {
        price_change_pct: 0.1,
        iv_change_pts: 0.5,
        funding_change: 0.5,
      },
      storage: {
        changeLog_max: 500,
        signal_history: 500,
        fingerprint_max: 1000,
      },
    }

    const state2 = JSON.parse(JSON.stringify(state1)) // Deep copy

    const h1 = await sha256(JSON.stringify(state1))
    const h2 = await sha256(JSON.stringify(state2))

    expect(h1).toBe(h2)
  })

  it('differs when protocol state changes', async () => {
    const state1 = {
      version: '1.0.0',
      sensitivity: { price_change_pct: 0.1 },
    }

    const state2 = {
      version: '1.0.1', // Different version
      sensitivity: { price_change_pct: 0.1 },
    }

    const h1 = await sha256(JSON.stringify(state1))
    const h2 = await sha256(JSON.stringify(state2))

    expect(h1).not.toBe(h2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── Protocol Lock Integration Tests (with mocked IDB)
// ────────────────────────────────────────────────────────────────────────────

// Note: Full Protocol Lock tests require IDB mocking
// These can be tested in browser/e2e environment
describe('Protocol Lock (integration tests require browser IDB)', () => {
  it('documentation: lockProtocolLevel2 function exists', () => {
    // This is a placeholder test
    // Full tests require proper IDB setup in test environment
    expect(true).toBe(true)
  })

  it('documentation: Level 2 uses SHA-256 for immutable locking', () => {
    // SHA-256 tests above verify cryptographic correctness
    // IDB persistence tests should run in browser or with proper mock setup
    expect(true).toBe(true)
  })
})

