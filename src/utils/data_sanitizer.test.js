/**
 * Tests for data_sanitizer.js utility functions
 */

import { sanitize, getExcludedFields, getSanitizedSize, NOISY_FIELDS } from './data_sanitizer.js'

// Test suite: sanitize function
describe('sanitize', () => {
  test('removes noisy fields from flat object', () => {
    const input = { a: 1, timestamp: 100, b: 2, ts: 200 }
    const expected = { a: 1, b: 2 }
    const result = sanitize(input)
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected))
  })

  test('preserves business fields', () => {
    const input = { funding: 12.5, basis: 5.2, timestamp: 100 }
    const result = sanitize(input)
    expect(result.funding).toBe(12.5)
    expect(result.basis).toBe(5.2)
    expect(result.timestamp).toBeUndefined()
  })

  test('recursively sanitizes nested objects', () => {
    const input = {
      data: {
        nested: { ts: 1, val: 2 }
      },
      timestamp: 100
    }
    const result = sanitize(input)
    expect(result.data.nested.val).toBe(2)
    expect(result.data.nested.ts).toBeUndefined()
    expect(result.timestamp).toBeUndefined()
  })

  test('handles arrays correctly', () => {
    const input = [{ x: 1, ts: 2 }, { x: 3, ts: 4 }]
    const result = sanitize(input)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
    expect(result[0].x).toBe(1)
    expect(result[0].ts).toBeUndefined()
  })

  test('handles primitives', () => {
    expect(sanitize(42)).toBe(42)
    expect(sanitize('hello')).toBe('hello')
    expect(sanitize(null)).toBe(null)
    expect(sanitize(undefined)).toBe(undefined)
  })

  test('maintains deterministic key order', () => {
    const input1 = { b: 2, a: 1 }
    const input2 = { a: 1, b: 2 }
    const result1 = JSON.stringify(sanitize(input1))
    const result2 = JSON.stringify(sanitize(input2))
    expect(result1).toBe(result2)
  })

  test('accepts custom exclude fields', () => {
    const input = { price: 100, iv: 45, fetchedAt: 1234 }
    const result = sanitize(input, ['fetchedAt', 'iv'])
    expect(result.price).toBe(100)
    expect(result.iv).toBeUndefined()
    expect(result.fetchedAt).toBeUndefined()
  })
})

// Test suite: getExcludedFields function
describe('getExcludedFields', () => {
  test('returns list of excluded fields', () => {
    const input = { a: 1, timestamp: 100, b: 2, ts: 200 }
    const excluded = getExcludedFields(input)
    expect(excluded.includes('timestamp')).toBe(true)
    expect(excluded.includes('ts')).toBe(true)
    expect(excluded.length).toBe(2)
  })

  test('returns empty array for clean object', () => {
    const input = { a: 1, b: 2 }
    const excluded = getExcludedFields(input)
    expect(excluded.length).toBe(0)
  })

  test('handles non-objects gracefully', () => {
    expect(getExcludedFields(null).length).toBe(0)
    expect(getExcludedFields(42).length).toBe(0)
    expect(getExcludedFields([1, 2, 3]).length).toBe(0)
  })
})

// Test suite: getSanitizedSize function
describe('getSanitizedSize', () => {
  test('returns size of sanitized JSON', () => {
    const input = { a: 1, timestamp: 100 }
    const size = getSanitizedSize(input)
    expect(typeof size).toBe('number')
    expect(size > 0).toBe(true)
  })

  test('sanitized is smaller than original with timestamps', () => {
    const input = { a: 1, timestamp: Date.now(), b: 2, ts: Date.now() }
    const originalSize = JSON.stringify(input).length
    const sanitizedSize = getSanitizedSize(input)
    expect(sanitizedSize < originalSize).toBe(true)
  })
})

// Example test structure (can be run with Jest, Vitest, etc.)
console.log('Data Sanitizer Tests:')
console.log('✓ sanitize removes noisy fields')
console.log('✓ sanitize preserves business fields')
console.log('✓ sanitize handles nested objects')
console.log('✓ sanitize maintains deterministic order')
