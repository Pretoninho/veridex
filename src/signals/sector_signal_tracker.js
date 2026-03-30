/**
 * Sector Signal Tracker Module
 * Tracks signal hash changes per sector and maintains change history
 */

import { hashSector, compareHashes, SUPPORTED_SECTORS } from '../utils/sector_hasher.js'

/**
 * Represents the hash state and history for a single sector
 */
class SectorState {
  constructor(sector) {
    this.sector = sector
    this.hash = null
    this.snapshot = null
    this.timestamp = null
    this.prevHash = null
  }
}

/**
 * Tracks sector-specific signal changes and maintains history
 * One instance per asset (BTC, ETH, etc.)
 */
export class SectorSignalTracker {
  /**
   * @param {string} asset - Asset name (e.g., 'BTC', 'ETH')
   */
  constructor(asset) {
    this.asset = asset
    this.sectorStates = {
      futures: new SectorState('futures'),
      options: new SectorState('options'),
      onchain: new SectorState('onchain')
    }
    this.history = [] // Max 500 entries
    this.maxHistorySize = 500
    this.changeCallbacks = {} // {sector: [callback, ...]}
  }

  /**
   * Updates sector data and detects if hash has changed
   * Automatically records changes in history
   *
   * @param {string} sector - Sector name ('futures', 'options', 'onchain')
   * @param {Object} data - Sector data to hash
   * @param {string[]} customExcludeFields - Optional additional fields to exclude
   * @returns {{changed: boolean, hash: string, prevHash: string, changedFields: string[]}} Change info
   *
   * @throws {Error} If sector is not supported
   */
  updateSector(sector, data, customExcludeFields = []) {
    // Validate sector
    if (!SUPPORTED_SECTORS.includes(sector)) {
      throw new Error(`Invalid sector: "${sector}"`)
    }

    if (!data) {
      return { changed: false, hash: null, prevHash: null, changedFields: [] }
    }

    const state = this.sectorStates[sector]

    // Compute new hash
    const hashResult = hashSector(data, sector, customExcludeFields)

    // Compare to previous hash
    const comparison = compareHashes(
      state.hash ? { hash: state.hash, sector } : null,
      hashResult
    )

    const changeInfo = {
      changed: comparison.changed,
      hash: hashResult.hash,
      prevHash: comparison.prevHash,
      changedFields: []
    }

    // If hash changed, compute diff and record
    if (comparison.changed) {
      // Find which specific fields changed
      changeInfo.changedFields = this._findDiffFields(state.snapshot, data, sector)

      // Update state
      state.prevHash = state.hash
      state.hash = hashResult.hash
      state.snapshot = JSON.parse(JSON.stringify(data)) // Deep copy
      state.timestamp = Date.now()

      // Record in history
      this._recordChange(sector, changeInfo, data)

      // Trigger callbacks
      this._triggerCallbacks(sector, changeInfo)

      // Log change
      this._logChange(sector, changeInfo)
    }

    return changeInfo
  }

  /**
   * Finds which specific fields have changed between two data snapshots
   * Excludes noisy/temporal fields
   *
   * @private
   * @param {Object} prevSnapshot - Previous snapshot
   * @param {Object} currSnapshot - Current snapshot
   * @param {string} sector - Sector name (for field naming)
   * @returns {string[]} List of field names that changed
   */
  _findDiffFields(prevSnapshot, currSnapshot, sector) {
    if (!prevSnapshot || typeof currSnapshot !== 'object') {
      return []
    }

    const changed = []
    const seenKeys = new Set([...Object.keys(prevSnapshot), ...Object.keys(currSnapshot)])

    for (const key of seenKeys) {
      const prev = prevSnapshot[key]
      const curr = currSnapshot[key]

      // Skip if same
      if (JSON.stringify(prev) === JSON.stringify(curr)) {
        continue
      }

      changed.push(key)
    }

    return changed
  }

  /**
   * Records a change event in the history
   * Maintains circular buffer (max 500 entries)
   *
   * @private
   * @param {string} sector - Sector name
   * @param {Object} changeInfo - Change information
   * @param {Object} snapshot - Data snapshot
   */
  _recordChange(sector, changeInfo, snapshot) {
    const entry = {
      sector,
      hash: changeInfo.hash,
      prevHash: changeInfo.prevHash,
      changedFields: changeInfo.changedFields,
      timestamp: Date.now(),
      snapshot: JSON.parse(JSON.stringify(snapshot)) // Deep copy
    }

    this.history.push(entry)

    // Maintain max size (circular buffer)
    if (this.history.length > this.maxHistorySize) {
      this.history.shift()
    }
  }

  /**
   * Logs sector change with human-readable format
   *
   * @private
   * @param {string} sector - Sector name
   * @param {Object} changeInfo - Change information
   */
  _logChange(sector, changeInfo) {
    const sectorLabel = sector.charAt(0).toUpperCase() + sector.slice(1)
    const fieldsStr = changeInfo.changedFields.join(', ') || '(unknown fields)'
    const hashStr = `${changeInfo.prevHash?.slice(0, 4)}... → ${changeInfo.hash.slice(0, 4)}...`

    console.log(
      `[${this.asset}] [${sectorLabel}] Changement détecté : ${fieldsStr} (hash: ${hashStr})`
    )
  }

  /**
   * Triggers registered callbacks for sector changes
   *
   * @private
   * @param {string} sector - Sector name
   * @param {Object} changeInfo - Change information
   */
  _triggerCallbacks(sector, changeInfo) {
    const callbacks = this.changeCallbacks[sector] || []
    for (const callback of callbacks) {
      try {
        callback(changeInfo)
      } catch (error) {
        console.error(`Callback error for sector ${sector}:`, error)
      }
    }
  }

  /**
   * Subscribe to changes for a specific sector
   *
   * @param {string} sector - Sector name
   * @param {Function} callback - Function to call on change: (changeInfo) => void
   * @returns {Function} Unsubscribe function
   *
   * @example
   * const unsubscribe = tracker.subscribe('futures', (change) => {
   *   console.log('Futures changed:', change.changedFields)
   * })
   * unsubscribe() // Stop listening
   */
  subscribe(sector, callback) {
    if (!this.changeCallbacks[sector]) {
      this.changeCallbacks[sector] = []
    }

    this.changeCallbacks[sector].push(callback)

    // Return unsubscribe function
    return () => {
      const idx = this.changeCallbacks[sector].indexOf(callback)
      if (idx > -1) {
        this.changeCallbacks[sector].splice(idx, 1)
      }
    }
  }

  /**
   * Get change history for a specific sector
   *
   * @param {string} sector - Sector name (optional, returns all if omitted)
   * @param {number} limit - Max entries to return
   * @returns {Array} History entries
   *
   * @example
   * const recent = tracker.getHistory('futures', 10)
   * // Returns last 10 futures changes
   */
  getHistory(sector, limit = 100) {
    let filtered = this.history

    if (sector) {
      filtered = this.history.filter(entry => entry.sector === sector)
    }

    return filtered.slice(-limit)
  }

  /**
   * Get current state for all sectors
   *
   * @returns {Object} Current hashes by sector
   *
   * @example
   * const state = tracker.getCurrentState()
   * // Returns: {
   * //   futures: {hash: 'a1b2c3d4', timestamp: 1234567890},
   * //   options: {hash: null, timestamp: null},
   * //   onchain: {hash: 'e5f6g7h8', timestamp: 1234567890}
   * // }
   */
  getCurrentState() {
    const state = {}

    for (const sector of SUPPORTED_SECTORS) {
      const sectorState = this.sectorStates[sector]
      state[sector] = {
        hash: sectorState.hash,
        prevHash: sectorState.prevHash,
        timestamp: sectorState.timestamp
      }
    }

    return state
  }

  /**
   * Get a human-readable summary of all sector hashes
   *
   * @returns {string} Summary string
   *
   * @example
   * console.log(tracker.getSummary())
   * // Output: "[BTC] [Futures] a1b2c3d4 | [Options] (empty) | [On-chain] e5f6g7h8"
   */
  getSummary() {
    const parts = []

    for (const sector of SUPPORTED_SECTORS) {
      const state = this.sectorStates[sector]
      const hash = state.hash ? state.hash.slice(0, 8) : '(empty)'
      const label = sector.charAt(0).toUpperCase() + sector.slice(1)
      parts.push(`[${label}] ${hash}`)
    }

    return `[${this.asset}] ${parts.join(' | ')}`
  }

  /**
   * Clear history
   *
   * @param {string} sector - Optional sector to clear (clears all if omitted)
   */
  clearHistory(sector) {
    if (sector) {
      this.history = this.history.filter(entry => entry.sector !== sector)
    } else {
      this.history = []
    }
  }

  /**
   * Export history as JSON for debugging/analysis
   *
   * @param {number} limit - Max entries to export
   * @returns {Object} Exportable history object
   */
  exportHistory(limit = 100) {
    return {
      asset: this.asset,
      exportedAt: new Date().toISOString(),
      totalEntries: this.history.length,
      entries: this.getHistory(null, limit)
    }
  }
}
