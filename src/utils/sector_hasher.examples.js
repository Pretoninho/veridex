/**
 * Test Examples for sector_hasher.js
 *
 * Note: To run these tests with Jest, use:
 * npm test -- src/utils/sector_hasher.examples.js
 *
 * Or paste these example calls in browser console to verify behavior
 */

import {
  hashSector,
  compareHashes,
  hashAllSectors,
  detectSectorChanges,
  getSectorHashSummary,
  SUPPORTED_SECTORS
} from './sector_hasher.js'

// Example 1: Hash for valid sector
console.log('Test 1: Hash valid sector')
const data1 = { funding: 12.5, basis: 5.2 }
const result1 = hashSector(data1, 'futures')
console.log('Input:', data1)
console.log('Sector:', 'futures')
console.log('Result:', result1)
console.log('Expected: {hash: string, sector: "futures", size: number}')
console.log('Pass:', result1.hash && result1.sector === 'futures' && result1.size > 0)
console.log()

// Example 2: All sectors are supported
console.log('Test 2: All sectors supported')
const data2 = { test: 123 }
const results2 = {}
for (const sector of SUPPORTED_SECTORS) {
  results2[sector] = hashSector(data2, sector)
}
console.log('Supported sectors:', SUPPORTED_SECTORS)
console.log('Results:', results2)
console.log('Expected: All sectors return valid hashes')
console.log('Pass:', SUPPORTED_SECTORS.every(s => results2[s].hash && results2[s].sector === s))
console.log()

// Example 3: Stable hash for same data
console.log('Test 3: Stable hash production')
const data3 = { funding: 12.5, basis: 5.2, timestamp: 100 }
const result3a = hashSector(data3, 'futures')
const result3b = hashSector(data3, 'futures')
console.log('Input (called twice):', data3)
console.log('Result A:', result3a.hash)
console.log('Result B:', result3b.hash)
console.log('Expected: Same hash both times')
console.log('Pass:', result3a.hash === result3b.hash)
console.log()

// Example 4: Excludes noisy fields by default
console.log('Test 4: Exclude noisy fields')
const data4a = { funding: 12.5, timestamp: 100 }
const data4b = { funding: 12.5, timestamp: 200 }
const result4a = hashSector(data4a, 'futures')
const result4b = hashSector(data4b, 'futures')
console.log('Input A (ts=100):', data4a)
console.log('Input B (ts=200):', data4b)
console.log('Hash A:', result4a.hash)
console.log('Hash B:', result4b.hash)
console.log('Expected: Same hash despite different timestamps')
console.log('Pass:', result4a.hash === result4b.hash)
console.log()

// Example 5: Different sectors produce different hashes
console.log('Test 5: Different sectors = different hashes')
const data5 = { value: 100 }
const hash5futures = hashSector(data5, 'futures').hash
const hash5options = hashSector(data5, 'options').hash
console.log('Data:', data5)
console.log('Futures hash:', hash5futures)
console.log('Options hash:', hash5options)
console.log('Expected: Different hashes')
console.log('Pass:', hash5futures !== hash5options)
console.log()

// Example 6: Compare hashes - detects change
console.log('Test 6: Compare hashes - change detection')
const prev6 = { hash: 'abc123', sector: 'futures' }
const curr6 = { hash: 'def456', sector: 'futures' }
const cmp6 = compareHashes(prev6, curr6)
console.log('Previous:', prev6)
console.log('Current:', curr6)
console.log('Comparison:', cmp6)
console.log('Expected: changed=true, hashes match')
console.log('Pass:', cmp6.changed === true && cmp6.prevHash === 'abc123' && cmp6.currHash === 'def456')
console.log()

// Example 7: Compare hashes - no change
console.log('Test 7: Compare hashes - no change')
const prev7 = { hash: 'abc123', sector: 'futures' }
const curr7 = { hash: 'abc123', sector: 'futures' }
const cmp7 = compareHashes(prev7, curr7)
console.log('Previous:', prev7)
console.log('Current:', curr7)
console.log('Comparison:', cmp7)
console.log('Expected: changed=false')
console.log('Pass:', cmp7.changed === false)
console.log()

// Example 8: Hash all sectors
console.log('Test 8: Hash all sectors at once')
const data8 = {
  futures: { funding: 12.5, basis: 5.2 },
  options: { dvol: 45, rv: 35 },
  onchain: { score: 75 }
}
const result8 = hashAllSectors(data8)
console.log('Input data:', data8)
console.log('Result:', result8)
console.log('Expected: All three sectors hashed')
console.log('Pass:', result8.futures && result8.options && result8.onchain)
console.log()

// Example 9: Detect sector changes
console.log('Test 9: Detect changes across sectors')
const prev9 = {
  futures: { hash: 'abc123' },
  options: { hash: 'def456' }
}
const curr9 = {
  futures: { hash: 'abc123' },
  options: { hash: 'xyz789' }
}
const chg9 = detectSectorChanges(prev9, curr9)
console.log('Previous hashes:', prev9)
console.log('Current hashes:', curr9)
console.log('Changes detected:', chg9)
console.log('Expected: options changed, futures did not')
console.log('Pass:', chg9.anyChanged === true && chg9.changedSectors.includes('options') && !chg9.changedSectors.includes('futures'))
console.log()

// Example 10: Get sector hash summary
console.log('Test 10: Get readable summary')
const data10 = {
  futures: { hash: 'a1b2c3d4', size: 42 },
  options: { hash: 'e5f6g7h8', size: 55 }
}
const summary10 = getSectorHashSummary(data10)
console.log('Hashes:', data10)
console.log('Summary:', summary10)
console.log('Expected: Human-readable string')
console.log('Pass:', summary10.includes('Futures') && summary10.includes('a1b2'))
console.log()

console.log('=== All examples completed ===')
