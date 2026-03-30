/**
 * PatternAnalyticsTrajectoryChart.jsx
 * Price trajectory visualization after pattern detection
 */

import { useEffect, useRef } from 'react'

export default function PatternAnalyticsTrajectoryChart({
  trajectory = [],
  metadata = null,
  selectedPattern = null,
  loading = false
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !trajectory || trajectory.length === 0) return
    if (loading) return

    // Create SVG canvas for trajectory visualization
    const container = containerRef.current
    const width = container.offsetWidth
    const height = 300

    // Clear previous chart
    if (chartRef.current) {
      chartRef.current.remove()
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.style.background = 'var(--bg-surface)'
    svg.style.borderRadius = '8px'

    // Calculate price range
    const prices = trajectory.map(t => t.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1

    // Calculate scaling
    const padding = 40
    const chartWidth = width - padding * 2
    const chartHeight = height - padding * 2
    const scaleX = chartWidth / (trajectory.length - 1 || 1)
    const scaleY = chartHeight / priceRange

    // Draw grid lines
    const gridColor = 'var(--border)'
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    gridGroup.style.stroke = 'rgba(255,255,255,0.05)'
    gridGroup.style.strokeWidth = '1'

    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', padding)
      line.setAttribute('y1', y)
      line.setAttribute('x2', width - padding)
      line.setAttribute('y2', y)
      gridGroup.appendChild(line)
    }
    svg.appendChild(gridGroup)

    // Draw price line
    const pathData = trajectory
      .map((point, idx) => {
        const x = padding + idx * scaleX
        const y = height - padding - (point.price - minPrice) * scaleY
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pathData)
    path.style.fill = 'none'
    path.style.stroke = 'var(--call)'
    path.style.strokeWidth = '2'
    path.style.strokeLinecap = 'round'
    path.style.strokeLinejoin = 'round'
    svg.appendChild(path)

    // Draw filled area under curve
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const areaData = pathData + ` L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`
    areaPath.setAttribute('d', areaData)
    areaPath.style.fill = 'rgba(0, 200, 150, 0.1)'
    svg.appendChild(areaPath)

    // Draw start point
    const startX = padding
    const startY = height - padding - (trajectory[0].price - minPrice) * scaleY
    const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    startDot.setAttribute('cx', startX)
    startDot.setAttribute('cy', startY)
    startDot.setAttribute('r', '4')
    startDot.style.fill = 'var(--text)'
    startDot.style.stroke = 'var(--surface)'
    startDot.style.strokeWidth = '2'
    svg.appendChild(startDot)

    // Draw end point
    const endX = padding + (trajectory.length - 1) * scaleX
    const endY = height - padding - (trajectory[trajectory.length - 1].price - minPrice) * scaleY
    const endDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    endDot.setAttribute('cx', endX)
    endDot.setAttribute('cy', endY)
    endDot.setAttribute('r', '4')
    endDot.style.fill = metadata?.movePercent > 0 ? 'var(--call)' : 'var(--put)'
    endDot.style.stroke = 'var(--surface)'
    endDot.style.strokeWidth = '2'
    svg.appendChild(endDot)

    // Draw Y-axis labels
    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    labelGroup.style.fontSize = '10px'
    labelGroup.style.fill = 'var(--text-muted)'
    labelGroup.style.fontFamily = 'var(--mono)'

    for (let i = 0; i <= 5; i++) {
      const price = minPrice + (priceRange / 5) * i
      const y = height - padding - (chartHeight / 5) * i
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', padding - 8)
      text.setAttribute('y', y + 3)
      text.setAttribute('text-anchor', 'end')
      text.textContent = price.toFixed(2)
      labelGroup.appendChild(text)
    }
    svg.appendChild(labelGroup)

    // Draw X-axis
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    xAxis.setAttribute('x1', padding)
    xAxis.setAttribute('y1', height - padding)
    xAxis.setAttribute('x2', width - padding)
    xAxis.setAttribute('y2', height - padding)
    xAxis.style.stroke = 'var(--border)'
    xAxis.style.strokeWidth = '1'
    svg.appendChild(xAxis)

    // Draw Y-axis
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    yAxis.setAttribute('x1', padding)
    yAxis.setAttribute('y1', padding)
    yAxis.setAttribute('x2', padding)
    yAxis.setAttribute('y2', height - padding)
    yAxis.style.stroke = 'var(--border)'
    yAxis.style.strokeWidth = '1'
    svg.appendChild(yAxis)

    container.appendChild(svg)
    chartRef.current = svg
  }, [trajectory, loading])

  if (loading) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '32px 16px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        minHeight: 300
      }}>
        <div className="dot-live" style={{ display: 'inline-block', marginBottom: 12 }} />
        <div>Loading trajectory data...</div>
      </div>
    )
  }

  if (!trajectory || trajectory.length === 0) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '32px 16px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        minHeight: 300
      }}>
        Select a pattern to view price trajectory
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      overflow: 'hidden'
    }}>
      {/* Header with metadata */}
      {metadata && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 16,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid var(--border)'
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
              Duration
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {metadata.durationMinutes} min
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
              Price Move
            </div>
            <div style={{
              fontSize: 12,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              color: metadata.movePercent > 0 ? 'var(--call)' : 'var(--put)'
            }}>
              {metadata.movePercent >= 0 ? '+' : ''}{metadata.movePercent.toFixed(2)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
              Max Excursion
            </div>
            <div style={{
              fontSize: 12,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              color: metadata.maxDrawdown < 0 ? 'var(--put)' : 'var(--call)'
            }}>
              {metadata.maxDrawdown >= 0 ? '+' : ''}{metadata.maxDrawdown.toFixed(2)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
              Status
            </div>
            <div style={{
              fontSize: 12,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              color: metadata.status === 'profit' ? 'var(--call)' : metadata.status === 'loss' ? 'var(--put)' : 'var(--atm)'
            }}>
              {metadata.status === 'profit' ? '✓ Profit' : metadata.status === 'loss' ? '✗ Loss' : '→ Breakeven'}
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div ref={containerRef} style={{ minHeight: 300, width: '100%' }} />
    </div>
  )
}
