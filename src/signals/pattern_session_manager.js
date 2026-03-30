/**
 * Pattern Session Manager Module
 * Orchestrates multiple pattern tracking sessions for an asset
 */

import { PatternSession } from './pattern_session.js'

/**
 * Manages all active and completed pattern tracking sessions for a single asset
 */
export class PatternSessionManager {
  /**
   * @param {string} asset - Asset name (e.g., 'BTC', 'ETH')
   * @param {Object} config - Configuration
   * @param {number} config.maxActiveSessions - Max concurrent sessions (default: 100)
   * @param {number} config.maxCompletedSessions - Max stored completed sessions (default: 1000)
   * @param {Function} config.onSessionCreated - Callback when session created
   * @param {Function} config.onSessionCompleted - Callback when session completed
   */
  constructor(asset, config = {}) {
    this.asset = asset
    this.maxActiveSessions = config.maxActiveSessions || 100
    this.maxCompletedSessions = config.maxCompletedSessions || 1000

    // Session storage
    this.activeSessions = [] // [PatternSession, ...]
    this.completedSessions = [] // [PatternSession, ...] (circular buffer)

    // Index for quick lookup
    this.sessionsByHash = {} // {patternHash: [session1, session2, ...]}

    // Callbacks
    this.onSessionCreated = config.onSessionCreated
    this.onSessionCompleted = config.onSessionCompleted
  }

  /**
   * Create and start tracking a newly detected pattern
   *
   * @param {string} patternHash - FNV-1a hash of the pattern
   * @param {string} sector - Sector type: 'futures', 'options', 'onchain'
   * @param {number} detectionTime - Timestamp of detection
   * @param {Object} config - Session configuration
   * @param {number} config.durationMs - Tracking duration
   * @param {string} config.description - Pattern description
   * @returns {PatternSession} The created session
   *
   * @throws {Error} If max active sessions reached
   */
  onPatternDetected(patternHash, sector, detectionTime, config = {}) {
    // Check if max sessions reached
    if (this.activeSessions.length >= this.maxActiveSessions) {
      console.warn(
        `[${this.asset}] Max active sessions (${this.maxActiveSessions}) reached, skipping new pattern`
      )
      return null
    }

    // Create new session
    const session = new PatternSession(patternHash, sector, this.asset, detectionTime, config)

    // Add to active sessions
    this.activeSessions.push(session)

    // Index by hash
    if (!this.sessionsByHash[patternHash]) {
      this.sessionsByHash[patternHash] = []
    }
    this.sessionsByHash[patternHash].push(session)

    // Log creation
    const durationMin = Math.round(config.durationMs ? config.durationMs / 60_000 : 60)
    console.log(
      `[${this.asset}] [${sector.toUpperCase()}] Pattern detected (${patternHash.slice(0, 8)}) - Tracking started (${durationMin}min) ${config.description || ''}`
    )

    // Trigger callback
    if (this.onSessionCreated) {
      try {
        this.onSessionCreated(session)
      } catch (error) {
        console.error('Error in onSessionCreated callback:', error)
      }
    }

    return session
  }

  /**
   * Update all active sessions with new market data
   * Expired sessions are automatically closed and moved to completed
   *
   * @param {number} nowMs - Current timestamp
   * @param {Object} marketData - Current market data
   * @param {number} marketData.price - Current spot price
   * @param {number} marketData.iv - Implied volatility (optional)
   * @param {number} marketData.funding - Funding rate (optional)
   *
   * @example
   * manager.tick(Date.now(), { price: 45123.50, iv: 52.3 })
   */
  tick(nowMs, marketData) {
    if (!marketData || marketData.price === undefined) {
      return
    }

    // Update active sessions
    const stillActive = []

    for (const session of this.activeSessions) {
      // Update trajectory
      session.updateTrajectory(nowMs, marketData)

      // Check if expired
      if (session.isExpired(nowMs) && !session.closed) {
        // Mark as completed
        this._completeSession(session)
      } else if (session.isActive) {
        stillActive.push(session)
      }
    }

    this.activeSessions = stillActive
  }

  /**
   * Complete and archive a session
   *
   * @private
   * @param {PatternSession} session - Session to complete
   */
  _completeSession(session) {
    // Close session (computes summary)
    session._close(Date.now())

    // Move to completed
    this.completedSessions.push(session)

    // Maintain max size (circular buffer)
    if (this.completedSessions.length > this.maxCompletedSessions) {
      this.completedSessions.shift()
    }

    // Log completion
    const summary = session.getSummary()
    if (summary) {
      const move = summary.movePercent > 0 ? '+' : ''
      const status = summary.status.toUpperCase()
      console.log(
        `[${this.asset}] [${summary.sector.toUpperCase()}] Pattern completed (${session.patternHash.slice(0, 8)}) - ${move}${summary.movePercent.toFixed(2)}% [${status}]`
      )
    }

    // Trigger callback
    if (this.onSessionCompleted) {
      try {
        this.onSessionCompleted(session)
      } catch (error) {
        console.error('Error in onSessionCompleted callback:', error)
      }
    }
  }

  /**
   * Get all active sessions
   *
   * @returns {Array} Array of PatternSession objects
   */
  getActiveSessions() {
    return [...this.activeSessions]
  }

  /**
   * Get all completed sessions
   *
   * @param {number} limit - Max entries to return
   * @returns {Array} Array of completed PatternSession objects
   */
  getCompletedSessions(limit = 100) {
    return this.completedSessions.slice(-limit)
  }

  /**
   * Get sessions by pattern hash (active + completed)
   *
   * @param {string} patternHash - Pattern hash to search for
   * @returns {Array} Sessions with this hash
   */
  getSessionsByHash(patternHash) {
    const sessions = this.sessionsByHash[patternHash] || []
    return [...sessions]
  }

  /**
   * Get sessions by sector
   *
   * @param {string} sector - Sector filter ('futures', 'options', 'onchain')
   * @param {boolean} includeCompleted - Include completed sessions (default: true)
   * @returns {Array} Sessions for this sector
   */
  getSessionsBySector(sector, includeCompleted = true) {
    let sessions = this.activeSessions.filter(s => s.sector === sector)

    if (includeCompleted) {
      sessions = [...sessions, ...this.completedSessions.filter(s => s.sector === sector)]
    }

    return sessions
  }

  /**
   * Get count of active sessions
   *
   * @param {string} sector - Optional sector filter
   * @returns {number} Count of active sessions
   */
  getActiveSessionCount(sector) {
    if (!sector) {
      return this.activeSessions.length
    }

    return this.activeSessions.filter(s => s.sector === sector).length
  }

  /**
   * Get count of completed sessions
   *
   * @param {string} sector - Optional sector filter
   * @returns {number} Count of completed sessions
   */
  getCompletedSessionCount(sector) {
    if (!sector) {
      return this.completedSessions.length
    }

    return this.completedSessions.filter(s => s.sector === sector).length
  }

  /**
   * Get completed session summaries for reporting
   *
   * @param {number} limit - Max entries to return
   * @returns {Array} Summaries of completed sessions
   */
  getCompletedSessionSummaries(limit = 100) {
    return this.getCompletedSessions(limit).map(session => session.getSummary())
  }

  /**
   * Get manager statistics
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const completedSummaries = this.completedSessions.map(s => s.getSummary())

    const profitableSessions = completedSummaries.filter(s => s.status === 'profit').length
    const totalSessions = completedSummaries.length
    const winRate = totalSessions > 0 ? ((profitableSessions / totalSessions) * 100).toFixed(2) : 'N/A'

    const avgMove = totalSessions > 0
      ? (completedSummaries.reduce((sum, s) => sum + s.movePercent, 0) / totalSessions).toFixed(2)
      : 'N/A'

    return {
      asset: this.asset,
      activeSessions: this.activeSessions.length,
      completedSessions: this.completedSessions.length,
      totalSessionsTracked: totalSessions,
      profitableSessions,
      winRate: `${winRate}%`,
      avgMovePercent: `${avgMove}%`,
      sessionsBySektor: {
        futures: this.getActiveSessionCount('futures'),
        options: this.getActiveSessionCount('options'),
        onchain: this.getActiveSessionCount('onchain')
      }
    }
  }

  /**
   * Export sessions for analysis/storage
   *
   * @param {Object} options - Export options
   * @param {boolean} options.includeActive - Include active sessions (default: false)
   * @param {boolean} options.includeTrajectory - Include full trajectories (default: false)
   * @param {number} options.limit - Max completed sessions to export (default: 500)
   * @returns {Object} Exportable data
   */
  export(options = {}) {
    const {
      includeActive = false,
      includeTrajectory = false,
      limit = 500
    } = options

    const data = {
      asset: this.asset,
      exportedAt: new Date().toISOString(),
      stats: this.getStats(),
      completedSessions: this.getCompletedSessions(limit).map(
        session => session.toJSON(includeTrajectory)
      )
    }

    if (includeActive) {
      data.activeSessions = this.activeSessions.map(
        session => ({
          summary: {
            patternHash: session.patternHash,
            sector: session.sector,
            timeRemaining: session.getTimeRemaining(Date.now()),
            progress: session.getProgress(Date.now())
          },
          metadata: {
            detectedAt: new Date(session.detectionTime).toISOString(),
            isActive: session.isActive
          }
        })
      )
    }

    return data
  }

  /**
   * Clear all sessions (use with caution)
   *
   * @param {string} sector - Optional sector filter
   */
  clear(sector) {
    if (sector) {
      this.activeSessions = this.activeSessions.filter(s => s.sector !== sector)
      this.completedSessions = this.completedSessions.filter(s => s.sector !== sector)

      // Update index
      for (const hash in this.sessionsByHash) {
        this.sessionsByHash[hash] = this.sessionsByHash[hash].filter(s => s.sector !== sector)
        if (this.sessionsByHash[hash].length === 0) {
          delete this.sessionsByHash[hash]
        }
      }
    } else {
      this.activeSessions = []
      this.completedSessions = []
      this.sessionsByHash = {}
    }
  }

  /**
   * Get human-readable summary
   *
   * @returns {string} Summary string
   */
  getSummary() {
    const stats = this.getStats()
    return `[${this.asset}] Active: ${stats.activeSessions}, Completed: ${stats.completedSessions}, WinRate: ${stats.winRate}`
  }
}
