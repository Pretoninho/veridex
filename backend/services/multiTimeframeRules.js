'use strict'

function toScore(input) {
  if (input == null) return 0
  return Math.max(0, Math.min(100, input))
}

function evaluateTimeframeRules(data) {
  const diagnostics = []

  if (!data) {
    return {
      score: 0,
      label: 'NEUTRAL',
      diagnostics: [{ rule: 'missing_data', passed: false, impact: 0, detail: 'No timeframe data available.' }],
    }
  }

  let score = 50

  const trendDirection = data.trend?.direction
  if (trendDirection === 'UP') {
    score += 10
    diagnostics.push({ rule: 'trend_up', passed: true, impact: +10, detail: 'Trend direction is UP.' })
  } else if (trendDirection === 'DOWN') {
    score -= 10
    diagnostics.push({ rule: 'trend_down', passed: true, impact: -10, detail: 'Trend direction is DOWN.' })
  }

  const volRatio = data.volume?.ratio
  if (typeof volRatio === 'number' && volRatio > 1.3) {
    score += 5
    diagnostics.push({ rule: 'volume_expansion', passed: true, impact: +5, detail: 'Volume is above average.' })
  }

  const isSpike = Boolean(data.spike?.detected)
  if (isSpike) {
    score -= 5
    diagnostics.push({ rule: 'volatility_spike', passed: true, impact: -5, detail: 'Spike detected, setup riskier.' })
  }

  const dvolCurrent = data.dvol?.current
  const dvolMax = data.dvol?.monthMax
  if (typeof dvolCurrent === 'number' && typeof dvolMax === 'number' && dvolMax > 0) {
    const rank = (dvolCurrent / dvolMax) * 100
    if (rank > 85) {
      score -= 5
      diagnostics.push({ rule: 'high_dvol_rank', passed: true, impact: -5, detail: 'Implied vol is elevated.' })
    }
  }

  const fundingAnn = data.funding?.rateAnn
  if (typeof fundingAnn === 'number') {
    if (fundingAnn > 30) {
      score -= 5
      diagnostics.push({ rule: 'extreme_positive_funding', passed: true, impact: -5, detail: 'Crowded longs indication.' })
    } else if (fundingAnn < -10) {
      score += 5
      diagnostics.push({ rule: 'negative_funding_reversion', passed: true, impact: +5, detail: 'Potential short squeeze context.' })
    }
  }

  if (data.breakout_flags?.up) {
    score += 8
    diagnostics.push({ rule: 'breakout_up', passed: true, impact: +8, detail: 'Price is breaking recent highs.' })
  }
  if (data.breakout_flags?.down) {
    score -= 8
    diagnostics.push({ rule: 'breakout_down', passed: true, impact: -8, detail: 'Price is breaking recent lows.' })
  }

  const normalized = toScore(score)
  const label = normalized >= 65 ? 'BULLISH' : normalized <= 35 ? 'BEARISH' : 'NEUTRAL'

  return { score: normalized, label, diagnostics }
}

function computeMultiTimeframeRules({ data_4h, data_1h, data_5m }) {
  const eval4h = evaluateTimeframeRules(data_4h)
  const eval1h = evaluateTimeframeRules(data_1h)
  const eval5m = evaluateTimeframeRules(data_5m)

  const alignment = {
    htf_mtf: eval4h.label === eval1h.label,
    mtf_ltf: eval1h.label === eval5m.label,
  }
  alignment.all_aligned = alignment.htf_mtf && alignment.mtf_ltf

  return {
    regime_4h: eval4h,
    setup_1h: eval1h,
    entry_5min: eval5m,
    alignment,
    diagnostics: {
      data_4h: eval4h.diagnostics,
      data_1h: eval1h.diagnostics,
      data_5m: eval5m.diagnostics,
    },
  }
}

module.exports = {
  computeMultiTimeframeRules,
  evaluateTimeframeRules,
}
