/**
 * PatternAnalyticsKPICard.jsx
 * Reusable KPI metric card component
 */

export default function PatternAnalyticsKPICard({
  label,
  value,
  subtext,
  color = 'var(--text)',
  badge = null,
  trend = null,
  loading = false
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px',
      borderLeft: `3px solid ${color}`,
      minHeight: 80,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }}>
      <div>
        <div style={{
          fontSize: 10,
          fontFamily: 'var(--sans)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--text-muted)',
          marginBottom: 4
        }}>
          {label}
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 20,
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          color: color,
          marginBottom: 4
        }}>
          {loading ? '—' : value}
        </div>

        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{subtext}</span>
          {trend && (
            <span style={{ color: trend > 0 ? 'var(--call)' : trend < 0 ? 'var(--put)' : 'var(--text-muted)' }}>
              {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
