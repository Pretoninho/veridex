/**
 * Pattern Clustering Module
 * Groups similar patterns into families for collective analysis
 */

/**
 * Represents a cluster of similar patterns
 */
export class PatternCluster {
  /**
   * @param {string} clusterId - Unique cluster identifier
   * @param {string} sector - Sector type: 'futures', 'options', 'onchain'
   * @param {string} asset - Asset name (e.g., 'BTC', 'ETH')
   * @param {Object} centroid - Initial centroid configuration
   */
  constructor(clusterId, sector, asset, centroid = {}) {
    this.clusterId = clusterId
    this.sector = sector
    this.asset = asset
    this.centroid = centroid
    this.description = this._generateDescription(centroid)

    // Pattern membership
    this.patterns = [] // [{hash, config, occurrences, winRate}, ...]
    this.patternHashes = new Set() // Quick lookup

    // Performance metrics (aggregated)
    this.performanceMetrics = {
      totalOccurrences: 0,
      totalSessions: 0,
      profitableSessions: 0,
      avgMovePercent: 0,
      maxMovePercent: null,
      minMovePercent: null,
      winRate: 0
    }

    this.createdAt = Date.now()
    this.lastUpdated = Date.now()
  }

  /**
   * Add a pattern to this cluster
   *
   * @param {string} patternHash - Pattern hash
   * @param {Object} config - Pattern configuration
   * @param {number} occurrences - Number of times pattern detected
   */
  addPattern(patternHash, config, occurrences = 1) {
    if (this.patternHashes.has(patternHash)) {
      return // Already in cluster
    }

    this.patterns.push({
      hash: patternHash,
      config,
      occurrences,
      winRate: 0,
      addedAt: Date.now()
    })

    this.patternHashes.add(patternHash)
    this.lastUpdated = Date.now()
    this._updateCentroid()
  }

  /**
   * Check if pattern is already in cluster
   *
   * @param {string} patternHash - Pattern hash to check
   * @returns {boolean}
   */
  contains(patternHash) {
    return this.patternHashes.has(patternHash)
  }

  /**
   * Update centroid based on member patterns
   * Centroid is the average configuration
   *
   * @private
   */
  _updateCentroid() {
    if (this.patterns.length === 0) return

    const configs = this.patterns.map(p => p.config)

    // Simple averaging for numeric fields
    const newCentroid = {}
    const numericFields = new Set()

    // Collect all numeric fields
    for (const config of configs) {
      for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'number') {
          numericFields.add(key)
        }
      }
    }

    // Average numeric fields
    for (const field of numericFields) {
      const values = configs
        .map(c => c[field])
        .filter(v => typeof v === 'number')

      if (values.length > 0) {
        newCentroid[field] = values.reduce((a, b) => a + b, 0) / values.length
      }
    }

    this.centroid = newCentroid
    this.description = this._generateDescription(this.centroid)
  }

  /**
   * Generate human-readable description from centroid
   *
   * @private
   * @param {Object} centroid - Centroid configuration
   * @returns {string} Description
   */
  _generateDescription(centroid) {
    if (!centroid || Object.keys(centroid).length === 0) {
      return `[${this.sector}] Unclassified Pattern Cluster`
    }

    const parts = []

    // Extract key indicators
    if (centroid.ivRank !== undefined) {
      const level = centroid.ivRank > 60 ? 'High' : centroid.ivRank > 40 ? 'Medium' : 'Low'
      parts.push(`${level} IV Rank`)
    }

    if (centroid.fundingRate !== undefined) {
      const sign = centroid.fundingRate > 0 ? '+' : ''
      parts.push(`${sign}${centroid.fundingRate.toFixed(1)}% Funding`)
    }

    if (centroid.basis !== undefined) {
      const type = centroid.basis > 0 ? 'Contango' : 'Backwardation'
      parts.push(`${type}`)
    }

    if (centroid.spreadBps !== undefined) {
      const quality = centroid.spreadBps < 50 ? 'Tight' : 'Normal'
      parts.push(`${quality} Spread`)
    }

    if (centroid.pcRatio !== undefined) {
      const sentiment = centroid.pcRatio < 0.9 ? 'Bullish' : centroid.pcRatio > 1.1 ? 'Bearish' : 'Neutral'
      parts.push(`${sentiment} Positioning`)
    }

    const sectorLabel = this.sector.charAt(0).toUpperCase() + this.sector.slice(1)
    return `[${sectorLabel}] ${parts.join(' + ')}`
  }

  /**
   * Update cluster performance metrics from session results
   *
   * @param {Array} sessions - Array of completed session summaries
   */
  updateMetrics(sessions) {
    if (!sessions || sessions.length === 0) {
      return
    }

    let totalMove = 0
    let profitable = 0

    for (const session of sessions) {
      if (!this.patternHashes.has(session.patternHash)) {
        continue // Not part of this cluster
      }

      totalMove += session.movePercent || 0

      if (session.status === 'profit') {
        profitable++
      }
    }

    this.performanceMetrics.totalSessions = sessions.length
    this.performanceMetrics.profitableSessions = profitable
    this.performanceMetrics.winRate = sessions.length > 0
      ? (profitable / sessions.length) * 100
      : 0
    this.performanceMetrics.avgMovePercent = sessions.length > 0
      ? totalMove / sessions.length
      : 0

    this.lastUpdated = Date.now()
  }

  /**
   * Get cluster statistics
   *
   * @returns {Object} Cluster stats
   */
  getStats() {
    return {
      clusterId: this.clusterId,
      sector: this.sector,
      asset: this.asset,
      description: this.description,
      patternCount: this.patterns.length,
      totalOccurrences: this.patterns.reduce((sum, p) => sum + p.occurrences, 0),
      metrics: { ...this.performanceMetrics },
      createdAt: new Date(this.createdAt).toISOString(),
      lastUpdated: new Date(this.lastUpdated).toISOString()
    }
  }

  /**
   * Export cluster data
   *
   * @returns {Object} Exportable cluster data
   */
  toJSON() {
    return {
      clusterId: this.clusterId,
      sector: this.sector,
      asset: this.asset,
      description: this.description,
      centroid: this.centroid,
      patterns: this.patterns,
      metrics: this.performanceMetrics,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated
    }
  }
}

/**
 * Manages clustering of detected patterns into families
 * Patterns with similar configurations are grouped together
 */
export class PatternClusterer {
  /**
   * @param {string} asset - Asset name (e.g., 'BTC', 'ETH')
   * @param {Object} config - Configuration
   * @param {number} config.similarityThreshold - Similarity threshold (0-1, default: 0.85)
   * @param {number} config.maxClusters - Max clusters to maintain (default: 100)
   */
  constructor(asset, config = {}) {
    this.asset = asset
    this.similarityThreshold = config.similarityThreshold || 0.85
    this.maxClusters = config.maxClusters || 100

    this.clusters = {} // {clusterId: PatternCluster}
    this.clustersBySektor = {
      futures: [],
      options: [],
      onchain: []
    }
    this.nextClusterId = 0
  }

  /**
   * Assign a pattern to a cluster (create new if needed)
   *
   * @param {string} patternHash - Pattern hash
   * @param {string} sector - Sector type
   * @param {Object} config - Pattern configuration
   * @param {number} occurrences - Pattern occurrences (default: 1)
   * @returns {string} Cluster ID assigned
   */
  clusterPattern(patternHash, sector, config, occurrences = 1) {
    // Find most similar cluster
    const bestMatch = this._findMostSimilarCluster(sector, config)

    let clusterId

    if (bestMatch && bestMatch.similarity >= this.similarityThreshold) {
      // Add to existing cluster
      clusterId = bestMatch.clusterId
      this.clusters[clusterId].addPattern(patternHash, config, occurrences)
    } else {
      // Create new cluster
      clusterId = this._createCluster(sector, config)
      this.clusters[clusterId].addPattern(patternHash, config, occurrences)
    }

    return clusterId
  }

  /**
   * Find most similar cluster for a given configuration
   *
   * @private
   * @param {string} sector - Sector type
   * @param {Object} config - Pattern configuration
   * @returns {Object|null} Best match {clusterId, similarity} or null
   */
  _findMostSimilarCluster(sector, config) {
    const sectorClusters = this.clustersBySektor[sector] || []

    if (sectorClusters.length === 0) {
      return null
    }

    let bestMatch = null
    let bestSimilarity = -1

    for (const clusterId of sectorClusters) {
      const cluster = this.clusters[clusterId]
      const similarity = this._calculateSimilarity(config, cluster.centroid)

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = { clusterId, similarity }
      }
    }

    return bestMatch
  }

  /**
   * Calculate similarity between two configurations (0-1)
   *
   * @private
   * @param {Object} config1 - First configuration
   * @param {Object} config2 - Second configuration
   * @returns {number} Similarity score (0-1)
   */
  _calculateSimilarity(config1, config2) {
    if (!config1 || !config2) return 0

    const keys1 = Object.keys(config1)
    const keys2 = Object.keys(config2)

    if (keys1.length === 0 || keys2.length === 0) {
      return 0
    }

    let matchingKeys = 0
    let totalDifference = 0
    let commonKeys = 0

    for (const key of keys1) {
      if (key in config2) {
        commonKeys++
        const v1 = config1[key]
        const v2 = config2[key]

        if (typeof v1 === 'number' && typeof v2 === 'number') {
          // Normalized difference
          const maxVal = Math.max(Math.abs(v1), Math.abs(v2))
          const diff = maxVal > 0 ? Math.abs(v1 - v2) / maxVal : 0
          totalDifference += diff

          if (diff < 0.2) {
            // Within 20% difference
            matchingKeys++
          }
        } else if (v1 === v2) {
          matchingKeys++
        }
      }
    }

    if (commonKeys === 0) return 0

    // Combine key matching and value similarity
    const keyScore = matchingKeys / commonKeys
    const valueScore = 1 - Math.min(1, totalDifference / commonKeys)

    return (keyScore + valueScore) / 2
  }

  /**
   * Create new cluster
   *
   * @private
   * @param {string} sector - Sector type
   * @param {Object} centroid - Initial centroid
   * @returns {string} Cluster ID
   */
  _createCluster(sector, centroid) {
    if (Object.keys(this.clusters).length >= this.maxClusters) {
      console.warn(`[${this.asset}] Max clusters (${this.maxClusters}) reached`)
      return null
    }

    const clusterId = `c_${this.asset}_${sector}_${this.nextClusterId++}`
    const cluster = new PatternCluster(clusterId, sector, this.asset, centroid)

    this.clusters[clusterId] = cluster

    if (!this.clustersBySektor[sector]) {
      this.clustersBySektor[sector] = []
    }
    this.clustersBySektor[sector].push(clusterId)

    return clusterId
  }

  /**
   * Get clusters for a specific sector
   *
   * @param {string} sector - Sector type
   * @returns {Array} Cluster objects
   */
  getClusters(sector) {
    const clusterIds = this.clustersBySektor[sector] || []
    return clusterIds.map(id => this.clusters[id])
  }

  /**
   * Get cluster by ID
   *
   * @param {string} clusterId - Cluster ID
   * @returns {PatternCluster|null}
   */
  getCluster(clusterId) {
    return this.clusters[clusterId] || null
  }

  /**
   * Get all clusters
   *
   * @returns {Array} All clusters
   */
  getAllClusters() {
    return Object.values(this.clusters)
  }

  /**
   * Get cluster statistics
   *
   * @param {string} sector - Optional sector filter
   * @returns {Array} Cluster stats
   */
  getClusterStats(sector) {
    const clusters = sector ? this.getClusters(sector) : this.getAllClusters()
    return clusters.map(c => c.getStats())
  }

  /**
   * Find which cluster a pattern belongs to (if any)
   *
   * @param {string} patternHash - Pattern hash
   * @returns {PatternCluster|null}
   */
  findClusterByPattern(patternHash) {
    for (const cluster of this.getAllClusters()) {
      if (cluster.contains(patternHash)) {
        return cluster
      }
    }
    return null
  }

  /**
   * Export all clusters
   *
   * @returns {Object} Exportable data
   */
  export() {
    return {
      asset: this.asset,
      exportedAt: new Date().toISOString(),
      clusterCount: Object.keys(this.clusters).length,
      clusters: this.getAllClusters().map(c => c.toJSON()),
      bySektor: Object.fromEntries(
        Object.entries(this.clustersBySektor).map(([sector, ids]) => [
          sector,
          ids.length
        ])
      )
    }
  }

  /**
   * Clear clusters (use with caution)
   *
   * @param {string} sector - Optional sector filter
   */
  clear(sector) {
    if (sector) {
      const clusterIds = this.clustersBySektor[sector] || []
      for (const id of clusterIds) {
        delete this.clusters[id]
      }
      this.clustersBySektor[sector] = []
    } else {
      this.clusters = {}
      this.clustersBySektor = { futures: [], options: [], onchain: [] }
      this.nextClusterId = 0
    }
  }

  /**
   * Get human-readable summary
   *
   * @returns {string} Summary
   */
  getSummary() {
    const totalClusters = Object.keys(this.clusters).length
    const bySektor = Object.entries(this.clustersBySektor)
      .map(([s, ids]) => `${s}: ${ids.length}`)
      .join(', ')

    return `[${this.asset}] ${totalClusters} clusters (${bySektor})`
  }
}
