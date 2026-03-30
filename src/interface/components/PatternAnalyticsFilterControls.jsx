/**
 * PatternAnalyticsFilterControls.jsx
 * Sector, timerange, and sort order filters
 */

export default function PatternAnalyticsFilterControls({
  sector,
  days,
  sortBy,
  onFilterChange,
  asset
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      marginBottom: 24,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 16
    }}>
      {/* Sector Filter */}
      <div>
        <label style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          display: 'block',
          marginBottom: 8
        }}>
          Sector
        </label>
        <select
          value={sector || ''}
          onChange={(e) => onFilterChange({ sector: e.target.value || null })}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            fontFamily: 'var(--sans)',
            cursor: 'pointer'
          }}
        >
          <option value="">All Sectors</option>
          <option value="futures">Futures</option>
          <option value="options">Options</option>
          <option value="onchain">On-Chain</option>
        </select>
      </div>

      {/* Time Range Filter */}
      <div>
        <label style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          display: 'block',
          marginBottom: 8
        }}>
          Time Range
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => onFilterChange({ days: d })}
              style={{
                flex: 1,
                padding: '8px',
                background: days === d ? 'var(--accent)' : 'var(--bg-surface)',
                border: `1px solid ${days === d ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                color: days === d ? 'var(--bg-base)' : 'var(--text)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Sort Filter */}
      <div>
        <label style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          display: 'block',
          marginBottom: 8
        }}>
          Sort By
        </label>
        <select
          value={sortBy}
          onChange={(e) => onFilterChange({ sortBy: e.target.value })}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            fontFamily: 'var(--sans)',
            cursor: 'pointer'
          }}
        >
          <option value="winRate">Win Rate</option>
          <option value="avgMove">Average Move</option>
          <option value="frequency">Frequency</option>
        </select>
      </div>
    </div>
  )
}
