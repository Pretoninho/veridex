/**
 * Data Sanitizer Module
 * Removes noisy/temporal fields from data structures for stable hashing
 */

/**
 * Fields that are commonly noisy/temporal and should be excluded from hashing
 * @type {string[]}
 */
export const NOISY_FIELDS = [
  'timestamp',
  'ts',
  'time',
  'serverTime',
  'syncedAt',
  'fetchedAt',
  'updatedAt',
  'lastUpdate',
  'raw',
  '_raw',
  'requestId',
  'sessionId',
  'nonce'
]

/**
 * Recursively removes specified fields from data structure
 * Returns a new object/array without the excluded fields
 * Maintains deterministic order by sorting object keys
 *
 * @param {*} data - The data to sanitize (object, array, or primitive)
 * @param {string[]} excludeFields - Fields to exclude (default: NOISY_FIELDS)
 * @returns {*} Sanitized copy of data
 *
 * @example
 * sanitize({a: 1, timestamp: 100, b: 2})
 * // Returns: {a: 1, b: 2}
 *
 * @example
 * sanitize([{x: 1, ts: 2}, {x: 3, ts: 4}])
 * // Returns: [{x: 1}, {x: 3}]
 *
 * @example
 * sanitize({data: {nested: {ts: 1, val: 2}}})
 * // Returns: {data: {nested: {val: 2}}}
 */
export function sanitize(data, excludeFields = NOISY_FIELDS) {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return data
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitize(item, excludeFields))
  }

  // Handle objects
  const sanitized = {}
  const keys = Object.keys(data).sort() // Sort for deterministic order

  for (const key of keys) {
    // Skip excluded fields
    if (excludeFields.includes(key)) {
      continue
    }

    const value = data[key]

    // Recursively sanitize nested structures
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitize(value, excludeFields)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitizes data with custom exclusion list
 * Useful for sector-specific field exclusions
 *
 * @param {*} data - The data to sanitize
 * @param {string[]} customExcludeFields - Custom fields to exclude
 * @returns {*} Sanitized copy of data
 *
 * @example
 * sanitizeWithCustomFields(
 *   {price: 100, iv: 45, fetchedAt: 1234},
 *   ['fetchedAt', 'iv'] // Exclude IV for options aggregation
 * )
 * // Returns: {price: 100}
 */
export function sanitizeWithCustomFields(data, customExcludeFields = []) {
  const combinedExclude = Array.from(new Set([...NOISY_FIELDS, ...customExcludeFields]))
  return sanitize(data, combinedExclude)
}

/**
 * Get the size (character count) of sanitized JSON representation
 * Useful for monitoring data compaction
 *
 * @param {*} data - The data to measure
 * @param {string[]} excludeFields - Fields to exclude
 * @returns {number} Size in bytes of JSON string representation
 */
export function getSanitizedSize(data, excludeFields = NOISY_FIELDS) {
  const sanitized = sanitize(data, excludeFields)
  return JSON.stringify(sanitized).length
}

/**
 * Get list of fields that were excluded from data
 * Useful for debugging and understanding what was sanitized
 *
 * @param {Object} data - The original data object
 * @param {string[]} excludeFields - Fields to check for exclusion
 * @returns {string[]} List of fields that were excluded
 */
export function getExcludedFields(data, excludeFields = NOISY_FIELDS) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return []
  }

  const excluded = []
  for (const key of Object.keys(data)) {
    if (excludeFields.includes(key)) {
      excluded.push(key)
    }
  }

  return excluded
}
