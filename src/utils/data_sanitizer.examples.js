/**
 * Test Examples for data_sanitizer.js
 *
 * Note: To run these tests with Jest, use:
 * npm test -- src/utils/data_sanitizer.examples.js
 *
 * Or paste these example calls in browser console to verify behavior
 */

import { sanitize, getExcludedFields, getSanitizedSize, NOISY_FIELDS } from './data_sanitizer.js'

// Example 1: Removes noisy fields from flat object
console.log('Test 1: Remove noisy fields')
const input1 = { a: 1, timestamp: 100, b: 2, ts: 200 }
const output1 = sanitize(input1)
console.log('Input:', input1)
console.log('Output:', output1)
console.log('Expected: {a: 1, b: 2}')
console.log('Pass:', JSON.stringify(output1) === JSON.stringify({a: 1, b: 2}))
console.log()

// Example 2: Preserves business fields
console.log('Test 2: Preserve business fields')
const input2 = { funding: 12.5, basis: 5.2, timestamp: 100 }
const output2 = sanitize(input2)
console.log('Input:', input2)
console.log('Output:', output2)
console.log('Expected: funding=12.5, basis=5.2, no timestamp')
console.log('Pass:', output2.funding === 12.5 && output2.basis === 5.2 && output2.timestamp === undefined)
console.log()

// Example 3: Recursively sanitizes nested objects
console.log('Test 3: Recursive sanitization')
const input3 = {
  data: {
    nested: { ts: 1, val: 2 }
  },
  timestamp: 100
}
const output3 = sanitize(input3)
console.log('Input:', input3)
console.log('Output:', output3)
console.log('Expected: nested.val=2, no ts or timestamp')
console.log('Pass:', output3.data.nested.val === 2 && output3.data.nested.ts === undefined && output3.timestamp === undefined)
console.log()

// Example 4: Handles arrays correctly
console.log('Test 4: Array handling')
const input4 = [{ x: 1, ts: 2 }, { x: 3, ts: 4 }]
const output4 = sanitize(input4)
console.log('Input:', input4)
console.log('Output:', output4)
console.log('Expected: Array with x values only, no ts')
console.log('Pass:', Array.isArray(output4) && output4[0].x === 1 && output4[0].ts === undefined)
console.log()

// Example 5: Maintains deterministic key order
console.log('Test 5: Deterministic key order')
const input5a = { b: 2, a: 1 }
const input5b = { a: 1, b: 2 }
const output5a = JSON.stringify(sanitize(input5a))
const output5b = JSON.stringify(sanitize(input5b))
console.log('Input A:', input5a)
console.log('Input B:', input5b)
console.log('Output A:', output5a)
console.log('Output B:', output5b)
console.log('Expected: Both outputs identical')
console.log('Pass:', output5a === output5b)
console.log()

// Example 6: Custom exclude fields
console.log('Test 6: Custom exclude fields')
const input6 = { price: 100, iv: 45, custom: 'exclude' }
const output6 = sanitize(input6, ['custom', 'iv'])
console.log('Input:', input6)
console.log('Output:', output6)
console.log('Expected: price only, no iv or custom')
console.log('Pass:', output6.price === 100 && output6.iv === undefined && output6.custom === undefined)
console.log()

// Example 7: Get excluded fields
console.log('Test 7: Get excluded fields')
const input7 = { a: 1, timestamp: 100, b: 2, ts: 200 }
const excluded7 = getExcludedFields(input7)
console.log('Input:', input7)
console.log('Excluded fields:', excluded7)
console.log('Expected: [timestamp, ts]')
console.log('Pass:', excluded7.includes('timestamp') && excluded7.includes('ts'))
console.log()

// Example 8: Get sanitized size
console.log('Test 8: Sanitized size calculation')
const input8 = { a: 1, timestamp: Date.now() }
const size8 = getSanitizedSize(input8)
console.log('Input:', input8)
console.log('Sanitized size (bytes):', size8)
console.log('Expected: size > 0')
console.log('Pass:', size8 > 0)
