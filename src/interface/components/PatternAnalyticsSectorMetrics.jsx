/**
 * PatternAnalyticsSectorMetrics.jsx
 * 3-column sector comparison grid
 */

export default function PatternAnalyticsSectorMetrics({ sectorReports, comparison }) {
  const sectors = ['futures', 'options', 'onchain']

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
        {sectors.map(sector => {
          const report = sectorReports[sector]
          if (!report) return null

          const sectorLabel = sector.charAt(0).toUpperCase() + sector.slice(1)
          const isBest = comparison.bestPerformer === sector
          const isWorst = comparison.worstPerformer === sector

          return (
            <div
              key={sector}
              style={{
                background: 'var(--surface)',
                border: `1px solid ${isBest ? 'var(--call)' : isWorst ? 'var(--put)' : 'var(--border)'}`,
                borderRadius: 12,
                padding: '16px',
                opacity: isWorst ? 0.7 : 1
              }}
            >
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: isBest ? 'var(--call)' : isWorst ? 'var(--put)' : 'var(--text)',
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{sectorLabel}</span>
                {isBest && <span style={{ fontSize: 10, color: 'var(--call)' }}>★ Best</span>}
                {isWorst && <span style={{ fontSize: 10, color: 'var(--put)' }}>★ Worst</span>}
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <MetricRow label="Sessions" value={report.totalSessionsAnalyzed} />
                <MetricRow label="Patterns" value={report.totalPatternsDetected} />
                <MetricRow
                  label="Win Rate"
                  value={`${(report.successRate * 100).toFixed(1)}%`}
                  color={report.successRate > 0.6 ? 'var(--call)' : report.successRate < 0.4 ? 'var(--put)' : 'var(--atm)'}
                />
                <MetricRow
                  label="Avg Move"
                  value={`${report.avgMovePercent >= 0 ? '+' : ''}${report.avgMovePercent.toFixed(2)}%`}
                  color={report.avgMovePercent > 0 ? 'var(--call)' : 'var(--put)'}
                />
              </div>
            </div>
          )
        })}
      </div>

      {comparison && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 11,
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Sector Summary</div>
          {comparison.summary.map((item, idx) => (
            <div key={idx} style={{ marginBottom: 4 }}>
              {item.sector}: {item.sessionsAnalyzed} sessions • {(item.winRate).toFixed(1)}% win rate
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color, fontFamily: 'var(--mono)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
