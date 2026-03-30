/**
 * Pattern Session Module
 * Tracks price movement after pattern detection
 */

/**
 * Represents a single tracking session for a detected pattern
 * Maintains a trajectory of market data from detection until expiration
 */
export class PatternSession {
  /**
   * @param {string} patternHash - FNV-1a hash of the pattern/fingerprint
   * @param {string} sector - Sector type: 'futures', 'options', 'onchain'
   * @param {string} asset - Asset name (e.g., 'BTC', 'ETH')
   * @param {number} detectionTime - Timestamp of pattern detection (ms)
   * @param {Object} config - Configuration object
   * @param {number} config.durationMs - How long to track (default: 3600000 = 1 hour)
   * @param {string} config.description - Human-readable description of pattern
   */
  constructor(patternHash, sector, asset, detectionTime, config = {}) {
    this.patternHash = patternHash
    this.sector = sector
    this.asset = asset
    this.detectionTime = detectionTime
    this.description = config.description || ''
    this.trackingDurationMs = config.durationMs || 60 * 60 * 1000 // Default: 1 hour
    this.endTime = detectionTime + this.trackingDurationMs

    // Trajectory tracking
    this.trajectory = [] // [{timestamp, price, iv, funding, ...}]
    this.startPrice = null
    this.startTime = null
    this.endPrice = null
    this.endTimestamp = null

    // Statistics
    this.maxPrice = null
    this.minPrice = null
    this.maxPriceMove = null
    this.minPriceMove = null
    this.maxDrawdown = null

    // Status
    this.isActive = true
    this.summary = null
    this.closed = false
  }

  /**
   * Check if session has expired
   *
   * @param {number} nowMs - Current timestamp
   * @returns {boolean} True if session duration exceeded
   */
  isExpired(nowMs) {
    return nowMs > this.endTime
  }

  /**
   * Get time remaining in tracking period
   *
   * @param {number} nowMs - Current timestamp
   * @returns {number} Milliseconds remaining (0 if expired)
   */
  getTimeRemaining(nowMs) {
    const remaining = this.endTime - nowMs
    return Math.max(0, remaining)
  }

  /**
   * Get progress as percentage (0-100)
   *
   * @param {number} nowMs - Current timestamp
   * @returns {number} Progress percentage
   */
  getProgress(nowMs) {
    const elapsed = nowMs - this.detectionTime
    return Math.min(100, Math.round((elapsed / this.trackingDurationMs) * 100))
  }

  /**
   * Update trajectory with new market data
   * Call this on each market tick while session is active
   *
   * @param {number} nowMs - Current timestamp
   * @param {Object} marketData - Current market data
   * @param {number} marketData.price - Current spot price
   * @param {number} marketData.iv - Current implied volatility (optional)
   * @param {number} marketData.funding - Current funding rate (optional)
   * @returns {boolean} True if update was recorded, false if session expired
   *
   * @example
   * session.updateTrajectory(Date.now(), {
   *   price: 45123.50,
   *   iv: 52.3,
   *   funding: 0.08
   * })
   */
  updateTrajectory(nowMs, marketData) {
    // Check if expired
    if (this.isExpired(nowMs)) {
      if (!this.closed) {
        this._close(nowMs)
      }
      return false
    }

    const price = marketData?.price
    if (price === undefined || price === null) {
      return false
    }

    // Initialize start price on first update
    if (this.startPrice === null) {
      this.startPrice = price
      this.startTime = this.detectionTime
      this.maxPrice = price
      this.minPrice = price
    }

    // Record trajectory point
    const point = {
      timestamp: nowMs,
      price: price,
      iv: marketData?.iv,
      funding: marketData?.funding,
      spread: marketData?.spread,
      volume: marketData?.volume
    }

    this.trajectory.push(point)

    // Update statistics
    this.maxPrice = Math.max(this.maxPrice, price)
    this.minPrice = Math.min(this.minPrice, price)

    // Calculate moves
    if (this.startPrice) {
      const movePercent = ((price - this.startPrice) / this.startPrice) * 100
      this.maxPriceMove = this.maxPriceMove === null ? movePercent : Math.max(this.maxPriceMove, movePercent)
      this.minPriceMove = this.minPriceMove === null ? movePercent : Math.min(this.minPriceMove, movePercent)

      // Drawdown: from max to current
      const drawdownPercent = ((price - this.maxPrice) / this.maxPrice) * 100
      this.maxDrawdown = this.maxDrawdown === null ? drawdownPercent : Math.min(this.maxDrawdown, drawdownPercent)
    }

    return true
  }

  /**
   * Close the session (internal - called when expired)
   *
   * @private
   * @param {number} nowMs - Closing timestamp
   */
  _close(nowMs) {
    this.isActive = false
    this.closed = true
    this.endTimestamp = nowMs

    // Get final price from last trajectory point
    if (this.trajectory.length > 0) {
      this.endPrice = this.trajectory[this.trajectory.length - 1].price
    }

    this._computeSummary()
  }

  /**
   * Compute summary statistics
   *
   * @private
   */
  _computeSummary() {
    const duration = this.trackingDurationMs
    const durationMin = Math.round(duration / 60_000)

    const movePercent = this.startPrice
      ? ((this.endPrice - this.startPrice) / this.startPrice) * 100
      : 0

    const maxDrawdownPercent = this.maxDrawdown || 0

    this.summary = {
      patternHash: this.patternHash,
      sector: this.sector,
      asset: this.asset,
      description: this.description,
      detectedAt: new Date(this.detectionTime).toISOString(),
      closedAt: new Date(this.endTimestamp).toISOString(),
      duration: `${durationMin}min`,
      durationMs: duration,
      startPrice: this.startPrice,
      endPrice: this.endPrice,
      maxPrice: this.maxPrice,
      minPrice: this.minPrice,
      maxMove: this.maxPriceMove,
      minMove: this.minPriceMove,
      movePercent: parseFloat(movePercent.toFixed(2)),
      maxDrawdown: parseFloat(maxDrawdownPercent.toFixed(2)),
      trajectoryPoints: this.trajectory.length,
      status: this._determineStatus()
    }
  }

  /**
   * Determine session status (profitable/breakeven/loss)
   *
   * @private
   * @returns {string} Status: 'profit', 'breakeven', 'loss'
   */
  _determineStatus() {
    if (!this.startPrice) return 'unknown'

    const movePercent = ((this.endPrice - this.startPrice) / this.startPrice) * 100

    if (movePercent > 0.1) return 'profit'
    if (movePercent < -0.1) return 'loss'
    return 'breakeven'
  }

  /**
   * Get current summary (or null if still active)
   *
   * @returns {Object|null} Summary object or null
   */
  getSummary() {
    return this.summary
  }

  /**
   * Get full session data including trajectory
   *
   * @returns {Object} Complete session data
   */
  getFullData() {
    return {
      summary: this.summary,
      trajectory: this.trajectory,
      isActive: this.isActive,
      closed: this.closed
    }
  }

  /**
   * Get trajectory compressed (every Nth point for large datasets)
   *
   * @param {number} compressionFactor - Return every Nth point (default: 1 = all points)
   * @returns {Array} Compressed trajectory
   */
  getCompressedTrajectory(compressionFactor = 1) {
    if (compressionFactor <= 1) {
      return this.trajectory
    }

    const compressed = []
    for (let i = 0; i < this.trajectory.length; i += compressionFactor) {
      compressed.push(this.trajectory[i])
    }

    // Always include last point
    if (this.trajectory.length > 0 && compressed[compressed.length - 1] !== this.trajectory[this.trajectory.length - 1]) {
      compressed.push(this.trajectory[this.trajectory.length - 1])
    }

    return compressed
  }

  /**
   * Export session as JSON (for storage/analysis)
   *
   * @param {boolean} includeTrajectory - Include full trajectory (default: true)
   * @returns {Object} Exportable session data
   */
  toJSON(includeTrajectory = true) {
    return {
      summary: this.summary,
      trajectory: includeTrajectory ? this.trajectory : undefined,
      metadata: {
        patternHash: this.patternHash,
        sector: this.sector,
        asset: this.asset,
        isActive: this.isActive,
        closed: this.closed,
        exportedAt: new Date().toISOString()
      }
    }
  }

  /**
   * Get human-readable session description
   *
   * @returns {string} Description string
   */
  toString() {
    const status = this.isActive ? 'ACTIVE' : 'CLOSED'
    const moveStr = this.maxPriceMove !== null ? `${this.maxPriceMove.toFixed(2)}%` : 'pending'
    return `[${status}] ${this.asset} ${this.sector} pattern (${moveStr}) - ${this.description}`
  }
}
