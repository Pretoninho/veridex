import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  POLL,
  HASH_CONFIG,
  getPollInterval,
  getSensitivity,
  getStorageLimits,
  computeConfigHash,
  verifyConfigIntegrity,
  isBreakingChange,
} from './hash_config.js'

// ────────────────────────────────────────────────────────────────────────────
// ── getPollInterval
// ────────────────────────────────────────────────────────────────────────────

describe('getPollInterval', () => {
  let originalMode

  beforeEach(() => {
    originalMode = HASH_CONFIG.MODE
    HASH_CONFIG.MODE = 'production'
  })

  afterEach(() => {
    HASH_CONFIG.MODE = originalMode
  })

  it('returns base interval when no marketState provided', () => {
    expect(getPollInterval('REALTIME')).toBe(POLL.REALTIME)
    expect(getPollInterval('FAST')).toBe(POLL.FAST)
    expect(getPollInterval('SLOW')).toBe(POLL.SLOW)
  })

  it('returns base interval for neutral volatility (30–70)', () => {
    expect(getPollInterval('REALTIME', { volatility: 50 })).toBe(POLL.REALTIME)
    expect(getPollInterval('FAST',     { volatility: 30 })).toBe(POLL.FAST)
    expect(getPollInterval('SLOW',     { volatility: 70 })).toBe(POLL.SLOW)
  })

  it('accelerates polling when volatility > 70 (× 0.5)', () => {
    const result = getPollInterval('REALTIME', { volatility: 80 })
    expect(result).toBe(Math.round(POLL.REALTIME * 0.5))
  })

  it('slows polling when volatility < 30 (× 1.5)', () => {
    const result = getPollInterval('NORMAL', { volatility: 20 })
    expect(result).toBe(Math.round(POLL.NORMAL * 1.5))
  })

  it('returns undefined for unknown poll type', () => {
    expect(getPollInterval('UNKNOWN')).toBeUndefined()
  })

  it('applies debug mode multiplier (× 0.25) regardless of marketState', () => {
    HASH_CONFIG.MODE = 'debug'
    expect(getPollInterval('REALTIME', { volatility: 20 })).toBe(Math.round(POLL.REALTIME * 0.25))
    expect(getPollInterval('FAST')).toBe(Math.round(POLL.FAST * 0.25))
  })

  it('applies simulation mode multiplier (× 0.1) regardless of marketState', () => {
    HASH_CONFIG.MODE = 'simulation'
    expect(getPollInterval('SLOW', { volatility: 90 })).toBe(Math.round(POLL.SLOW * 0.1))
  })

  it('debug mode is faster than production with high volatility', () => {
    HASH_CONFIG.MODE = 'debug'
    const debugInterval = getPollInterval('REALTIME', { volatility: 80 })

    HASH_CONFIG.MODE = 'production'
    const prodInterval = getPollInterval('REALTIME', { volatility: 80 })

    expect(debugInterval).toBeLessThan(prodInterval)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── getSensitivity
// ────────────────────────────────────────────────────────────────────────────

describe('getSensitivity', () => {
  it('returns default sensitivity when no marketState', () => {
    const s = getSensitivity()
    expect(s.price_change_pct).toBe(HASH_CONFIG.sensitivity.price_change_pct)
    expect(s.iv_change_pts).toBe(HASH_CONFIG.sensitivity.iv_change_pts)
    expect(s.funding_change).toBe(HASH_CONFIG.sensitivity.funding_change)
  })

  it('returns default sensitivity for undefined marketState', () => {
    const s = getSensitivity(undefined)
    expect(s).toEqual({ ...HASH_CONFIG.sensitivity })
  })

  it('widens price_change_pct when volatility > 60', () => {
    const s = getSensitivity({ volatility: 75, iv: 50, fundingVol: 30 })
    expect(s.price_change_pct).toBe(0.3)
  })

  it('keeps default price_change_pct when volatility <= 60', () => {
    const s = getSensitivity({ volatility: 60, iv: 50, fundingVol: 30 })
    expect(s.price_change_pct).toBe(0.1)
  })

  it('widens iv_change_pts when iv > 70', () => {
    const s = getSensitivity({ volatility: 50, iv: 80, fundingVol: 30 })
    expect(s.iv_change_pts).toBe(1.0)
  })

  it('keeps default iv_change_pts when iv <= 70', () => {
    const s = getSensitivity({ volatility: 50, iv: 70, fundingVol: 30 })
    expect(s.iv_change_pts).toBe(0.5)
  })

  it('widens funding_change when fundingVol > 50', () => {
    const s = getSensitivity({ volatility: 50, iv: 50, fundingVol: 60 })
    expect(s.funding_change).toBe(1.0)
  })

  it('keeps default funding_change when fundingVol <= 50', () => {
    const s = getSensitivity({ volatility: 50, iv: 50, fundingVol: 50 })
    expect(s.funding_change).toBe(0.5)
  })

  it('all fields widened in extreme market conditions', () => {
    const s = getSensitivity({ volatility: 90, iv: 90, fundingVol: 90 })
    expect(s.price_change_pct).toBe(0.3)
    expect(s.iv_change_pts).toBe(1.0)
    expect(s.funding_change).toBe(1.0)
  })

  it('all fields default in calm market', () => {
    const s = getSensitivity({ volatility: 10, iv: 10, fundingVol: 10 })
    expect(s.price_change_pct).toBe(0.1)
    expect(s.iv_change_pts).toBe(0.5)
    expect(s.funding_change).toBe(0.5)
  })

  it('returns a copy — mutations do not affect HASH_CONFIG.sensitivity', () => {
    const s = getSensitivity()
    s.price_change_pct = 999
    expect(HASH_CONFIG.sensitivity.price_change_pct).toBe(0.1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── getStorageLimits
// ────────────────────────────────────────────────────────────────────────────

describe('getStorageLimits', () => {
  let originalMode

  beforeEach(() => {
    originalMode = HASH_CONFIG.MODE
    HASH_CONFIG.MODE = 'production'
  })

  afterEach(() => {
    HASH_CONFIG.MODE = originalMode
  })

  it('returns default limits for neutral activity (30–70)', () => {
    const limits = getStorageLimits(50)
    expect(limits.signal_history).toBe(HASH_CONFIG.storage.signal_history)
    expect(limits.changeLog_max).toBe(HASH_CONFIG.storage.changeLog_max)
    expect(limits.fingerprint_max).toBe(HASH_CONFIG.storage.fingerprint_max)
    expect(limits.clock_sync_history).toBe(HASH_CONFIG.storage.clock_sync_history)
  })

  it('doubles limits when activity > 70', () => {
    const limits = getStorageLimits(80)
    expect(limits.changeLog_max).toBe(1000)
    expect(limits.signal_history).toBe(1000)
    expect(limits.fingerprint_max).toBe(2000)
  })

  it('clock_sync_history is always preserved unchanged', () => {
    expect(getStorageLimits(10).clock_sync_history).toBe(HASH_CONFIG.storage.clock_sync_history)
    expect(getStorageLimits(50).clock_sync_history).toBe(HASH_CONFIG.storage.clock_sync_history)
    expect(getStorageLimits(90).clock_sync_history).toBe(HASH_CONFIG.storage.clock_sync_history)
  })

  it('halves limits in production mode with activity < 30', () => {
    const limits = getStorageLimits(20)
    expect(limits.changeLog_max).toBe(Math.round(HASH_CONFIG.storage.changeLog_max / 2))
    expect(limits.signal_history).toBe(Math.round(HASH_CONFIG.storage.signal_history / 2))
    expect(limits.fingerprint_max).toBe(Math.round(HASH_CONFIG.storage.fingerprint_max / 2))
  })

  it('does NOT halve limits in debug mode with low activity', () => {
    HASH_CONFIG.MODE = 'debug'
    const limits = getStorageLimits(10)
    expect(limits.changeLog_max).toBe(HASH_CONFIG.storage.changeLog_max)
    expect(limits.signal_history).toBe(HASH_CONFIG.storage.signal_history)
  })

  it('activity boundary: exactly 70 uses defaults (not doubled)', () => {
    const limits = getStorageLimits(70)
    expect(limits.signal_history).toBe(HASH_CONFIG.storage.signal_history)
  })

  it('activity boundary: exactly 30 uses defaults (not halved) in production', () => {
    const limits = getStorageLimits(30)
    expect(limits.signal_history).toBe(HASH_CONFIG.storage.signal_history)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── computeConfigHash
// ────────────────────────────────────────────────────────────────────────────

describe('computeConfigHash', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await computeConfigHash({ version: '1.0.0' })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input yields same hash', async () => {
    const config = { version: '1.0.0', sensitivity: { price_change_pct: 0.1 } }
    const h1 = await computeConfigHash(config)
    const h2 = await computeConfigHash(config)
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different configs', async () => {
    const h1 = await computeConfigHash({ version: '1.0.0' })
    const h2 = await computeConfigHash({ version: '2.0.0' })
    expect(h1).not.toBe(h2)
  })

  it('handles empty object', async () => {
    const hash = await computeConfigHash({})
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is sensitive to nested value changes', async () => {
    const h1 = await computeConfigHash({ sensitivity: { price_change_pct: 0.1 } })
    const h2 = await computeConfigHash({ sensitivity: { price_change_pct: 0.2 } })
    expect(h1).not.toBe(h2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── verifyConfigIntegrity
// ────────────────────────────────────────────────────────────────────────────

describe('verifyConfigIntegrity', () => {
  let savedLocked, savedHash

  beforeEach(() => {
    savedLocked = HASH_CONFIG.LOCKED
    savedHash   = HASH_CONFIG.LOCKED_HASH
  })

  afterEach(() => {
    HASH_CONFIG.LOCKED      = savedLocked
    HASH_CONFIG.LOCKED_HASH = savedHash
  })

  it('resolves without error when LOCKED is false', async () => {
    HASH_CONFIG.LOCKED = false
    await expect(verifyConfigIntegrity()).resolves.toBeUndefined()
  })

  it('resolves without error when LOCKED_HASH is null', async () => {
    HASH_CONFIG.LOCKED      = true
    HASH_CONFIG.LOCKED_HASH = null
    await expect(verifyConfigIntegrity()).resolves.toBeUndefined()
  })

  it('resolves when hash of stable config matches LOCKED_HASH', async () => {
    // Compute the hash of the stable parts (same logic as verifyConfigIntegrity)
    const stableConfig = {
      VERSION:     HASH_CONFIG.VERSION,
      MODE:        HASH_CONFIG.MODE,
      sensitivity: HASH_CONFIG.sensitivity,
      storage:     HASH_CONFIG.storage,
    }
    HASH_CONFIG.LOCKED      = true
    HASH_CONFIG.LOCKED_HASH = await computeConfigHash(stableConfig)
    await expect(verifyConfigIntegrity()).resolves.toBeUndefined()
  })

  it('throws CONFIG TAMPERED when hash does not match', async () => {
    HASH_CONFIG.LOCKED      = true
    HASH_CONFIG.LOCKED_HASH = 'a'.repeat(64)  // wrong hash
    await expect(verifyConfigIntegrity()).rejects.toThrow('CONFIG TAMPERED')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ── isBreakingChange
// ────────────────────────────────────────────────────────────────────────────

describe('isBreakingChange', () => {
  it('detects a major version bump as a breaking change', () => {
    expect(isBreakingChange('1.0.0', '2.0.0')).toBe(true)
    expect(isBreakingChange('1.5.3', '2.0.0')).toBe(true)
    expect(isBreakingChange('0.9.9', '1.0.0')).toBe(true)
  })

  it('returns false for minor version bump', () => {
    expect(isBreakingChange('1.0.0', '1.1.0')).toBe(false)
    expect(isBreakingChange('1.2.3', '1.9.0')).toBe(false)
  })

  it('returns false for patch version bump', () => {
    expect(isBreakingChange('1.0.0', '1.0.1')).toBe(false)
    expect(isBreakingChange('1.2.3', '1.2.9')).toBe(false)
  })

  it('returns false for identical versions', () => {
    expect(isBreakingChange('1.0.0', '1.0.0')).toBe(false)
    expect(isBreakingChange('2.3.4', '2.3.4')).toBe(false)
  })

  it('works with multi-digit major versions', () => {
    expect(isBreakingChange('10.0.0', '11.0.0')).toBe(true)
    expect(isBreakingChange('10.5.3', '10.6.0')).toBe(false)
  })
})
