# Veridex: Sector Hashing & Pattern Tracking System

## Overview

This implementation introduces a sophisticated multi-sector signal hashing and pattern tracking system for Veridex. The system provides:

1. **Sector-Specific Hashing** - Individual hash computation for Futures, Options, and On-chain sectors
2. **Field Exclusion** - Explicit exclusion of noisy/temporal fields (timestamp, fetchedAt, etc.)
3. **Pattern Session Tracking** - Automatic price movement tracking after pattern detection
4. **Cluster Analysis** - Grouping of similar patterns into families for collective analysis
5. **Performance Reporting** - Analytics API for analyzing pattern effectiveness

---

## Architecture

### Core Components

#### 1. **Data Sanitizer** (`src/utils/data_sanitizer.js`)
Removes noisy fields from data structures to enable stable hashing.

```javascript
import { sanitize, NOISY_FIELDS } from '../utils/data_sanitizer.js'

const cleanData = sanitize({
  funding: 12.5,
  timestamp: 1234567890,  // Will be removed
  basis: 5.2
})
// Result: { basis: 5.2, funding: 12.5 } (deterministic order)
```

**Features:**
- Recursive field exclusion
- Deterministic key ordering
- Custom field exclusion support

---

#### 2. **Sector Hasher** (`src/utils/sector_hasher.js`)
Computes stable, deterministic hashes for each market sector.

```javascript
import { hashSector, hashAllSectors } from '../utils/sector_hasher.js'

// Single sector hash
const futuresHash = hashSector(
  { funding: 12.5, basis: 5.2 },
  'futures'
)
// Returns: { hash: 'a1b2c3d4', sector: 'futures', size: 42 }

// All sectors at once
const allHashes = hashAllSectors({
  futures: { funding: 12.5, basis: 5.2 },
  options: { dvol: 45, ivRank: 65 },
  onchain: { score: 75 }
})
```

**Sectors:**
- `'futures'` - Funding rate, Basis
- `'options'` - DVOL, IV/RV premium
- `'onchain'` - Exchange flows, sentiment

---

#### 3. **Sector Signal Tracker** (`src/signals/sector_signal_tracker.js`)
Tracks hash changes per sector and maintains detailed change history.

```javascript
import { SectorSignalTracker } from '../signals/sector_signal_tracker.js'

const tracker = new SectorSignalTracker('BTC')

// Update a sector
const change = tracker.updateSector('futures', {
  funding: { rateAnn: 12.5, avgAnn7d: 10 },
  basis: 5.2
})

if (change.changed) {
  console.log('Futures changed:', change.changedFields)
  // Output: ['funding_rate', 'basis']
}

// Subscribe to changes
tracker.subscribe('futures', (changeInfo) => {
  console.log(`[${changeInfo.sector}] Fields changed:`, changeInfo.changedFields)
})

// Get history
const recent = tracker.getHistory('futures', 10)
```

**Key Methods:**
- `updateSector(sector, data)` - Detect and record changes
- `subscribe(sector, callback)` - Listen to sector changes
- `getHistory(sector, limit)` - Retrieve change history
- `getCurrentState()` - Get current hashes for all sectors
- `exportHistory(limit)` - Export for analysis

---

#### 4. **Pattern Session** (`src/signals/pattern_session.js`)
Tracks price movement after pattern detection.

```javascript
import { PatternSession } from '../signals/pattern_session.js'

// Create session when pattern detected
const session = new PatternSession(
  'a1b2c3d4',           // patternHash
  'futures',            // sector
  'BTC',                // asset
  Date.now(),           // detectionTime
  { durationMs: 3600000, description: 'Positive Funding' }
)

// Update with each market tick
session.updateTrajectory(Date.now(), {
  price: 45123.50,
  iv: 52.3,
  funding: 0.08
})

// Get summary when completed
const summary = session.getSummary()
console.log({
  move: summary.movePercent,
  maxDrawdown: summary.maxDrawdown,
  status: summary.status  // 'profit' | 'loss' | 'breakeven'
})
```

---

#### 5. **Pattern Session Manager** (`src/signals/pattern_session_manager.js`)
Orchestrates multiple pattern tracking sessions in parallel.

```javascript
import { PatternSessionManager } from '../signals/pattern_session_manager.js'

const manager = new PatternSessionManager('BTC', {
  onSessionCompleted: (session) => {
    console.log(`Pattern ${session.patternHash} completed:`, session.getSummary())
  }
})

// Create session on pattern detection
manager.onPatternDetected(
  'a1b2c3d4',
  'futures',
  Date.now(),
  { durationMs: 3600000 }
)

// Update all sessions every tick
manager.tick(Date.now(), { price: 45123.50, iv: 52.3 })

// Get statistics
const stats = manager.getStats()
console.log({
  active: stats.activeSessions,
  completed: stats.completedSessions,
  winRate: stats.winRate
})
```

---

#### 6. **Pattern Clustering** (`src/signals/pattern_clustering.js`)
Groups similar patterns into families for analysis.

```javascript
import { PatternClusterer } from '../signals/pattern_clustering.js'

const clusterer = new PatternClusterer('BTC')

// Cluster patterns automatically
const clusterId = clusterer.clusterPattern(
  'a1b2c3d4',
  'futures',
  { ivRank: 65, fundingRate: 12.5, basis: 5 },
  1  // occurrences
)

// Get clusters by sector
const futuresClusters = clusterer.getClusters('futures')

// Get cluster stats
const stats = clusterer.getClusterStats('futures')
console.log(stats)
// Output: [{clusterId, description, patternCount, avgWinRate, ...}]
```

---

#### 7. **Pattern Session Store** (`src/data/data_store/pattern_session_store.js`)
Persists sessions to IndexedDB for long-term analysis.

```javascript
import {
  savePatternSession,
  getPatternSessions,
  getSessionStats
} from '../data/data_store/pattern_session_store.js'

// Save completed session
await savePatternSession('BTC', 'futures', summary, trajectory)

// Retrieve sessions
const sessions = await getPatternSessions('BTC', 'futures', {
  limit: 100,
  sinceMs: Date.now() - 30 * 24 * 60 * 60 * 1000  // Last 30 days
})

// Get statistics
const stats = await getSessionStats('BTC', 'futures')
console.log({
  totalSessions: stats.totalSessions,
  winRate: stats.winRate,
  avgMove: stats.avgMove
})
```

---

#### 8. **Pattern Analytics API** (`src/api/pattern_analytics.js`)
Provides analysis and reporting functions.

```javascript
import {
  getPatternPerformanceReport,
  comparePatternPerformanceBySector,
  getTrendingPatterns,
  exportPatternDataAsCSV
} from '../src/api/pattern_analytics.js'

// Get comprehensive performance report
const report = await getPatternPerformanceReport('BTC', 'futures', { days: 30 })
console.log({
  totalPatterns: report.totalPatternsDetected,
  successRate: report.successRate,
  avgMove: report.avgMovePercent,
  patterns: report.patterns  // [{hash, description, winRate, ...}]
})

// Compare sectors
const comparison = await comparePatternPerformanceBySector('BTC')
console.log({
  bestPerformer: comparison.comparison.bestPerformer,
  sectorStats: comparison.comparison.summary
})

// Get trending patterns
const trends = await getTrendingPatterns('BTC', 'futures', {
  topN: 10,
  sortBy: 'winRate'
})

// Export as CSV
const csv = await exportPatternDataAsCSV('BTC', 'futures', 30)
```

---

## Integration in App.jsx

The system is automatically initialized and integrated in the main app loop:

```javascript
// Trackers are stored globally
const trackers = window.__veridexTrackers = {
  BTC: {
    sectorTracker: SectorSignalTracker,    // Detects sector changes
    sessionManager: PatternSessionManager,  // Tracks price after pattern
    clusterer: PatternClusterer            // Groups patterns
  },
  ETH: { /* ... */ }
}

// Every 60 seconds:
// 1. Sector hashes are computed
// 2. Changes are detected and notifications sent
// 3. Pattern sessions are updated
// 4. Completed sessions are saved to IndexedDB
```

---

## Example: Complete Workflow

### Scenario: Detecting and Tracking a Futures Pattern

```javascript
// 1. APP TICK (every 60 seconds)
// Compute sector hashes
const futuresData = { funding: 12.5, basis: 5.2 }
const futuresChange = tracker.updateSector('futures', futuresData)

// 2. CHANGE DETECTED
if (futuresChange.changed) {
  // Notify user
  await notifySectorChange('BTC', 'futures', ['funding_rate', 'basis'], ...)

  // Get pattern fingerprint (from existing system)
  const fingerprint = createFingerprint('BTC', { ivRank: 65, fundingRate: 12.5 })

  // 3. CREATE TRACKING SESSION
  const clusterId = clusterer.clusterPattern(
    fingerprint.hash,
    'futures',
    fingerprint.config
  )

  manager.onPatternDetected(
    fingerprint.hash,
    'futures',
    Date.now(),
    { description: 'High Funding + Contango' }
  )
}

// 4. TRACK PRICE FOR 1 HOUR
// (done automatically in app tick every 60s)
manager.tick(Date.now(), { price: spot, iv: ivRank })

// 5. SESSION EXPIRES (after 1 hour)
// Automatically:
// - Computes summary (price move, max drawdown, etc.)
// - Saves to IndexedDB
// - Updates cluster statistics
// - Available in analytics

// 6. ANALYZE
const report = await getPatternPerformanceReport('BTC', 'futures', { days: 30 })
// Includes: win rate, avg move, frequency for each detected pattern
```

---

## Logging Output

### Sector Change Log
```
[2024-03-30 15:45:32] [BTC] [Futures] Changement détecté : funding_rate (+12.5%), basis (+5.2%)
  Hash: a1b2c3d4 → c3d4e5f6
```

### Pattern Session Log
```
[2024-03-30 15:46:00] [BTC] [Futures] Pattern detected (a1b2...) - Tracking started (60min)
[2024-03-30 16:46:00] [BTC] [Futures] Pattern completed (a1b2...)
  Duration: 60 minutes
  Price move: +2.3%
  Max drawdown: -1.8%
  Status: Profitable
```

---

## Performance Considerations

### Memory
- **Active Sessions:** ~100 per asset, ~1KB each = ~100KB
- **Sector Trackers:** ~1 per asset, ~50KB history = ~50KB
- **Pattern Clusters:** ~50 per asset, ~10KB each = ~500KB
- **Total:** ~700KB per asset (manageable)

### Storage (IndexedDB)
- **Max Sessions:** 500 per sector/asset
- **Retention:** Automatic circular buffer (oldest removed)
- **Average:** ~1MB per asset over 30 days

### CPU
- **Sector Hashing:** ~0.1ms per call (FNV-1a)
- **Change Detection:** ~0.5ms per call
- **Session Updates:** ~0.1ms per active session
- **Total per tick:** ~50ms for all operations

---

## Testing

### Unit Tests

Run tests for utility functions:
```bash
npm test src/utils/data_sanitizer.test.js
npm test src/utils/sector_hasher.test.js
```

### Integration Test

Monitor logs during normal operation:
```javascript
// Access trackers in browser console
console.log(window.__veridexTrackers.BTC.sectorTracker.getSummary())
console.log(window.__veridexTrackers.BTC.sessionManager.getStats())
```

---

## Debugging

### Export Sector History
```javascript
const exportData = window.__veridexTrackers.BTC.sectorTracker.exportHistory(100)
console.table(exportData.entries)
```

### Export Session Data
```javascript
const export Data = window.__veridexTrackers.BTC.sessionManager.export({
  includeActive: true,
  includeTrajectory: false,
  limit: 50
})
console.table(export Data.completedSessions)
```

### Export Cluster Data
```javascript
const clusterData = window.__veridexTrackers.BTC.clusterer.export()
console.table(clusterData.clusters)
```

---

## Future Enhancements

1. **Webhook Notifications** - Send pattern alerts to external services
2. **Advanced Clustering** - ML-based pattern similarity
3. **Strategy Optimization** - Auto-tune sector thresholds based on performance
4. **Real-time Dashboard** - Live pattern visualization
5. **Backtesting Engine** - Replay historical patterns

---

## References

- **Sanitizer**: Deterministic JSON serialization for stable hashing
- **Hasher**: FNV-1a 32-bit hash (fast, non-cryptographic)
- **Tracker**: Event-driven sector monitoring
- **Sessions**: Time-windowed price tracking
- **Store**: Async IndexedDB persistence
- **Analytics**: Aggregate performance metrics

---

**Last Updated:** 2024-03-30
**Version:** 1.0.0
**Status:** Production Ready
