/**
 * PatternAnalyticsTable.jsx
 * Reusable patterns table for top/bottom patterns
 */

export default function PatternAnalyticsTable({
  title,
  patterns = [],
  isBottom = false,
  onPatternSelect,
  selectedPattern
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        fontWeight: 700,
        color: isBottom ? 'var(--put)' : 'var(--call)'
      }}>
        {title}
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11
        }}>
          <thead>
            <tr style={{ backgroundColor: 'rgba(255,255,255,.02)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>#</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Hash</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Win %</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Avg Move</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {patterns.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                  No patterns found
                </td>
              </tr>
            ) : (
              patterns.map((pattern, idx) => {
                const isSelected = selectedPattern === pattern.hash
                return (
                  <tr
                    key={pattern.hash}
                    onClick={() => onPatternSelect(pattern.hash)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: isSelected ? 'rgba(0, 200, 150, 0.1)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = isSelected ? 'rgba(0, 200, 150, 0.1)' : 'rgba(255,255,255,.02)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = isSelected ? 'rgba(0, 200, 150, 0.1)' : 'transparent'}
                  >
                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>{idx + 1}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 10 }}>
                      {pattern.hash.slice(0, 8)}
                    </td>
                    <td style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      color: parseInt(pattern.winRate) > 60 ? 'var(--call)' : 'var(--text)'
                    }}>
                      {pattern.winRate}%
                    </td>
                    <td style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      color: parseFloat(pattern.avgMovePercent) > 0 ? 'var(--call)' : 'var(--put)'
                    }}>
                      {pattern.avgMovePercent}%
                    </td>
                    <td style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      color: 'var(--text-muted)'
                    }}>
                      {pattern.sessionCount}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
