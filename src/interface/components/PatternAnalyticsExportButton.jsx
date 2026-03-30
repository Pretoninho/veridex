/**
 * PatternAnalyticsExportButton.jsx
 * CSV export functionality for pattern data
 */

export default function PatternAnalyticsExportButton({
  asset = 'BTC',
  sector = null,
  days = 30,
  onExport,
  exporting = false
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text)',
          marginBottom: 4
        }}>
          Export Data
        </div>
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)'
        }}>
          Download pattern analytics as CSV
          {sector && <span> • Sector: {sector}</span>}
          <span> • {days}d period</span>
        </div>
      </div>

      <button
        onClick={onExport}
        disabled={exporting}
        style={{
          padding: '8px 16px',
          background: exporting ? 'var(--text-muted)' : 'var(--accent)',
          border: 'none',
          borderRadius: 6,
          color: exporting ? 'var(--text-muted)' : 'var(--bg-base)',
          cursor: exporting ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 600,
          opacity: exporting ? 0.5 : 1,
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
          marginLeft: 16
        }}
        onMouseEnter={(e) => {
          if (!exporting) {
            e.target.style.background = 'var(--call)'
          }
        }}
        onMouseLeave={(e) => {
          if (!exporting) {
            e.target.style.background = 'var(--accent)'
          }
        }}
      >
        {exporting ? '⟳ Exporting...' : '↓ Export CSV'}
      </button>
    </div>
  )
}
