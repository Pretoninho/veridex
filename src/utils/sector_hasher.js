/**
 * Sector Hasher Module
 * Computes stable, sector-specific hashes for signal data
 */

import { sanitize, NOISY_FIELDS } from './data_sanitizer.js'
import { fnv1a } from '../data/data_store/cache.js'

/**
 * Supported market sectors
 * @type {string[]}
 */
export const SUPPORTED_SECTORS = ['futures', 'options', 'onchain']

/**
 * Computes a stable, deterministic hash for sector-specific data
 * - Sanitizes data to exclude noisy fields
 * - Adds sector identifier to ensure different sectors produce different hashes
 * - Serializes with sorted keys for determinism
 * - Uses FNV-1a hashing
 *
 * @param {Object} data - Market data to hash
 * @param {string} sector - Sector type: 'futures', 'options', or 'onchain'
 * @param {string[]} excludeFields - Additional fields to exclude (merged with NOISY_FIELDS)
 * @returns {{hash: string, sector: string, size: number}} Hash result object
 *
 * @example
 * const fut = { funding: 12.5, basis: 5.2, timestamp: 100 }
 * const result = hashSector(fut, 'futures')
 * // Returns: {hash: 'a1b2c3d4', sector: 'futures', size: 42}
 *
 * @throws {Error} If sector is not supported
 */
export function hashSector(data, sector, excludeFields = []) {
  // Validate sector
  if (!SUPPORTED_SECTORS.includes(sector)) {
    throw new Error(
      `Invalid sector: "${sector}". Must be one of: ${SUPPORTED_SECTORS.join(', ')}`
    )
  }

  // Merge custom and default exclusions
  const allExcludeFields = Array.from(new Set([...NOISY_FIELDS, ...excludeFields]))

  // Sanitize data
  const sanitized = sanitize(data, allExcludeFields)

  // Add sector identifier to ensure different sectors hash differently
  const sectorizedData = {
    __sector: sector,
    ...sanitized
  }

  // Serialize deterministically (sorted keys)
  const jsonString = JSON.stringify(sectorizedData, Object.keys(sectorizedData).sort())

  // Compute FNV-1a hash
  const hash = fnv1a(jsonString)

  return {
    hash,
    sector,
    size: jsonString.length
  }
}

/**
 * Compares hashes from two data snapshots
 * Returns detailed comparison information
 *
 * @param {{hash: string, sector: string}} prev - Previous hash result
 * @param {{hash: string, sector: string}} curr - Current hash result
 * @returns {{changed: boolean, prevHash: string, currHash: string, sector: string}} Comparison result
 *
 * @example
 * const prev = hashSector(oldData, 'futures')
 * const curr = hashSector(newData, 'futures')
 * const comparison = compareHashes(prev, curr)
 * // Returns: {changed: true, prevHash: 'a1b2...', currHash: 'c3d4...', sector: 'futures'}
 */
export function compareHashes(prev, curr) {
  if (!prev || !curr) {
    return {
      changed: true,
      prevHash: prev?.hash || null,
      currHash: curr?.hash || null,
      sector: curr?.sector || prev?.sector || null
    }
  }

  return {
    changed: prev.hash !== curr.hash,
    prevHash: prev.hash,
    currHash: curr.hash,
    sector: curr.sector
  }
}

/**
 * Batch hashes multiple sectors
 * Useful for computing all sector hashes in one operation
 *
 * @param {Object} sectorData - Object with sector names as keys
 * @param {Object} sectorData.futures - Futures data
 * @param {Object} sectorData.options - Options data
 * @param {Object} sectorData.onchain - On-chain data
 * @returns {{futures: {hash, sector, size}, options: {hash, sector, size}, onchain: {hash, sector, size}}} Hash results by sector
 *
 * @example
 * const results = hashAllSectors({
 *   futures: {funding: 12.5, basis: 5.2},
 *   options: {dvol: 45, ivRank: 65},
 *   onchain: {flowBtc: 'bullish'}
 * })
 * // Returns: {futures: {...}, options: {...}, onchain: {...}}
 */
export function hashAllSectors(sectorData) {
  const results = {}

  for (const sector of SUPPORTED_SECTORS) {
    if (sectorData[sector]) {
      results[sector] = hashSector(sectorData[sector], sector)
    }
  }

  return results
}

/**
 * Detects if any sector hash has changed from previous state
 * Useful for batch change detection
 *
 * @param {Object} prevHashes - Previous hashes by sector
 * @param {Object} currHashes - Current hashes by sector
 * @returns {{anyChanged: boolean, changedSectors: string[]}} Aggregate change status
 *
 * @example
 * const prevHashes = {futures: {hash: 'a1b2...'}, options: {hash: 'c3d4...'}}
 * const currHashes = {futures: {hash: 'a1b2...'}, options: {hash: 'e5f6...'}}
 * const result = detectSectorChanges(prevHashes, currHashes)
 * // Returns: {anyChanged: true, changedSectors: ['options']}
 */
export function detectSectorChanges(prevHashes, currHashes) {
  const changedSectors = []

  for (const sector of SUPPORTED_SECTORS) {
    const prev = prevHashes?.[sector]
    const curr = currHashes?.[sector]

    if (!prev || !curr || prev.hash !== curr.hash) {
      changedSectors.push(sector)
    }
  }

  return {
    anyChanged: changedSectors.length > 0,
    changedSectors
  }
}

/**
 * Generates a human-readable summary of sector hashes
 * Useful for logging and debugging
 *
 * @param {Object} hashes - Hash results by sector
 * @returns {string} Human-readable summary
 *
 * @example
 * const summary = getSectorHashSummary({
 *   futures: {hash: 'a1b2...', size: 42},
 *   options: {hash: 'c3d4...', size: 55}
 * })
 * // Returns: "[Futures] hash=a1b2... (42B) | [Options] hash=c3d4... (55B)"
 */
export function getSectorHashSummary(hashes) {
  return SUPPORTED_SECTORS
    .filter(sector => hashes?.[sector])
    .map(
      sector =>
        `[${sector.charAt(0).toUpperCase() + sector.slice(1)}] hash=${hashes[sector].hash} (${hashes[sector].size}B)`
    )
    .join(' | ')
}
