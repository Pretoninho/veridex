import { useEffect, useMemo, useState } from 'react'
import { getATMIV, getSpot } from '../../utils/api.js'
import { calcOptionGreeks } from '../../utils/greeks.js'
import {
  evaluateDualPolicy,
  getDualRlMetrics,
  getDualRlSnapshot,
  learnFromSettlement,
  resetDualRl,
  getDualRewardConfig,
  updateDualRewardConfig,
  resetDualRewardConfig,
} from '../../utils/rlDual.js'

const LS_DI_POSITIONS = 'paper_di_positions'
const LS_DI_BALANCES = 'paper_di_balances'
const LS_DI_HISTORY = 'paper_di_history'

const MIN_LOT = { BTC: 0.01, ETH: 0.2 }
const INITIAL_BALANCES = { USDC: 100000, BTC: 0.4, ETH: 6 }

function getStoredDca(asset) {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`di_dca_${asset}`)
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function computeDualDelta({ side, spot, strike, days, iv }) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(days) || !Number.isFinite(iv) || days <= 0 || iv <= 0) return null
  const greeks = calcOptionGreeks({
    type: side === 'sell-high' ? 'call' : 'put',
    S: spot,
    K: strike,
    T: days / 365,
    sigma: iv / 100,
    r: 0,
  })
  return greeks?.delta ?? null
}

function formatNum(n, max = 2) {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: 0 })
}

function formatDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function calcDaysToExpiry(expiryTs) {
  if (!expiryTs) return null
  return Math.max(0.01, (expiryTs - Date.now()) / 86400000)
}

function nextWeekFridayTs(fromTs = Date.now()) {
  const d = new Date(fromTs)
  const dow = d.getUTCDay()
  const daysToThisFriday = (5 - dow + 7) % 7
  const daysToNextFriday = daysToThisFriday + 7
  d.setUTCDate(d.getUTCDate() + daysToNextFriday)
  d.setUTCHours(8, 0, 0, 0)
  return d.getTime()
}

function calcPeriodRate(apr, days) {
  if (!Number.isFinite(apr) || !Number.isFinite(days) || days <= 0) return 0
  return (apr / 100) * (days / 365)
}

function buildTradePreview(form) {
  const strike = Number(form.strike)
  const apr = Number(form.apr)
  const qtyAsset = Number(form.quantityAsset)
  const days = Number(form.days)
  const minLot = MIN_LOT[form.asset] ?? 0.01

  if (!Number.isFinite(strike) || strike <= 0 || !Number.isFinite(apr) || apr <= 0 || !Number.isFinite(days) || days <= 0) {
    return null
  }
  if (!Number.isFinite(qtyAsset) || qtyAsset < minLot) {
    return { invalidLot: true, minLot }
  }

  const periodRate = calcPeriodRate(apr, days)

  if (form.side === 'sell-high') {
    const collateralAsset = qtyAsset
    const premiumAsset = collateralAsset * periodRate
    return {
      side: form.side,
      collateralAsset,
      premiumAsset,
      collateralUsdc: 0,
      premiumUsdc: 0,
      periodRate,
      days,
      strike,
      apr,
      qtyAsset,
      minLot,
    }
  }

  const collateralUsdc = strike * qtyAsset
  const premiumUsdc = collateralUsdc * periodRate
  return {
    side: form.side,
    collateralAsset: 0,
    premiumAsset: 0,
    collateralUsdc,
    premiumUsdc,
    periodRate,
    days,
    strike,
    apr,
    qtyAsset,
    minLot,
  }
}

function calcPositionMarkValue(position, spots) {
  const spot = spots[position.asset]
  if (!spot) return 0
  const elapsedDays = Math.max(0, (Date.now() - position.entryTs) / 86400000)
  const progress = Math.min(1, elapsedDays / Math.max(position.days, 0.01))

  if (position.side === 'sell-high') {
    const accruedPremiumAsset = position.premiumAsset * progress
    return (position.collateralAsset + accruedPremiumAsset) * spot
  }

  const accruedPremiumUsdc = position.premiumUsdc * progress
  return position.collateralUsdc + accruedPremiumUsdc
}

function calcWalletEquity(balances, positions, spots) {
  const btc = balances.BTC * (spots.BTC ?? 0)
  const eth = balances.ETH * (spots.ETH ?? 0)
  const liquid = balances.USDC + btc + eth
  const locked = positions.reduce((acc, p) => acc + calcPositionMarkValue(p, spots), 0)
  return liquid + locked
}

function calcSettlementReward(position, settleSpot) {
  if (!settleSpot || !position) {
    return { exercised: false, netPnlUsd: 0, rewardPct: 0 }
  }

  if (position.side === 'sell-high') {
    const entryRef = Math.max(1, position.entrySpot || settleSpot)
    const entryCollateralUsd = position.collateralAsset * entryRef
    const exercised = settleSpot >= position.strike
    const finalValueUsd = exercised
      ? (position.collateralAsset * position.strike) + (position.premiumAsset * settleSpot)
      : (position.collateralAsset + position.premiumAsset) * settleSpot
    const netPnlUsd = finalValueUsd - entryCollateralUsd
    const rewardPct = entryCollateralUsd > 0 ? (netPnlUsd / entryCollateralUsd) * 100 : 0
    return { exercised, netPnlUsd, rewardPct }
  }

  const entryCollateralUsd = position.collateralUsdc
  const exercised = settleSpot <= position.strike
  const finalValueUsd = exercised
    ? ((position.collateralUsdc / position.strike) * settleSpot) + position.premiumUsdc
    : position.collateralUsdc + position.premiumUsdc
  const netPnlUsd = finalValueUsd - entryCollateralUsd
  const rewardPct = entryCollateralUsd > 0 ? (netPnlUsd / entryCollateralUsd) * 100 : 0
  return { exercised, netPnlUsd, rewardPct }
}

function PerformanceChart({ points }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  if (!points.length) {
    return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>En attente de donnees de performance...</div>
  }

  const width = 1000
  const height = 250
  const p = { l: 44, r: 16, t: 16, b: 36 }

  const minTs = points[0].ts
  const maxTs = points[points.length - 1].ts
  const eqs = points.map((x) => x.equity)
  const minEqRaw = Math.min(...eqs)
  const maxEqRaw = Math.max(...eqs)
  const margin = Math.max(20, (maxEqRaw - minEqRaw) * 0.18)
  const minEq = minEqRaw - margin
  const maxEq = maxEqRaw + margin

  const mapX = (ts) => {
    if (maxTs === minTs) return p.l
    return p.l + ((ts - minTs) / (maxTs - minTs)) * (width - p.l - p.r)
  }

  const mapY = (eq) => {
    if (maxEq === minEq) return height / 2
    return p.t + ((maxEq - eq) / (maxEq - minEq)) * (height - p.t - p.b)
  }

  const line = points.map((pt) => `${mapX(pt.ts).toFixed(1)},${mapY(pt.equity).toFixed(1)}`).join(' ')
  const area = `${p.l},${height - p.b} ${line} ${mapX(points[points.length - 1].ts)},${height - p.b}`

  const activeIndex = hoverIndex == null ? points.length - 1 : hoverIndex
  const active = points[activeIndex]
  const activeX = mapX(active.ts)
  const activeY = mapY(active.equity)

  const onMove = (evt) => {
    const rect = evt.currentTarget.getBoundingClientRect()
    const x = evt.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    const targetTs = minTs + ratio * (maxTs - minTs)
    let bestIdx = 0
    let bestGap = Infinity
    for (let i = 0; i < points.length; i += 1) {
      const gap = Math.abs(points[i].ts - targetTs)
      if (gap < bestGap) {
        bestGap = gap
        bestIdx = i
      }
    }
    setHoverIndex(bestIdx)
  }

  return (
    <div style={{ background: 'linear-gradient(180deg, rgba(0,212,255,.08), rgba(0,0,0,.05))', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>Performance du compte DI</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Equity liquide + collateraux + primes accrues</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>${formatNum(active.equity, 2)}</div>
          <div style={{ fontSize: 10, color: active.pnl >= 0 ? 'var(--call)' : 'var(--put)' }}>{active.pnl >= 0 ? '+' : ''}{formatNum(active.pnl, 2)} USD</div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 220, display: 'block', borderRadius: 8, background: 'rgba(5,12,20,.55)' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="eqLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--call)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
          <linearGradient id="eqFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,229,160,.24)" />
            <stop offset="100%" stopColor="rgba(0,229,160,.02)" />
          </linearGradient>
        </defs>

        <line x1={p.l} y1={mapY(points[0].equity - points[0].pnl)} x2={width - p.r} y2={mapY(points[0].equity - points[0].pnl)} stroke="rgba(255,255,255,.16)" strokeDasharray="4 4" />
        <polyline fill="url(#eqFill)" stroke="none" points={area} />
        <polyline fill="none" stroke="url(#eqLine)" strokeWidth="3" points={line} />

        <line x1={activeX} y1={p.t} x2={activeX} y2={height - p.b} stroke="rgba(0,212,255,.4)" strokeDasharray="3 4" />
        <circle cx={activeX} cy={activeY} r="5" fill="var(--accent)" stroke="white" strokeWidth="1.5" />

        <text x={p.l} y={height - 10} fill="var(--text-muted)" fontSize="11">{formatTime(points[0].ts)}</text>
        <text x={width - p.r} y={height - 10} fill="var(--text-muted)" fontSize="11" textAnchor="end">{formatTime(points[points.length - 1].ts)}</text>
        <text x={p.l} y={13} fill="var(--text-muted)" fontSize="11">max {formatNum(maxEqRaw, 0)}</text>
        <text x={p.l} y={height - p.b + 12} fill="var(--text-muted)" fontSize="11">min {formatNum(minEqRaw, 0)}</text>
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
        <span>{formatDate(active.ts)} {formatTime(active.ts)}</span>
        <span>{active.openPositions} positions ouvertes</span>
      </div>
    </div>
  )
}

export default function PaperTradingPage({ onBack, prefillTrade }) {
  const [asset, setAsset] = useState('BTC')
  const [spots, setSpots] = useState({ BTC: null, ETH: null })
  const [marketIvByAsset, setMarketIvByAsset] = useState({ BTC: null, ETH: null })
  const [balances, setBalances] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_DI_BALANCES) || JSON.stringify(INITIAL_BALANCES))
    } catch {
      return INITIAL_BALANCES
    }
  })
  const [positions, setPositions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_DI_POSITIONS) || '[]')
    } catch {
      return []
    }
  })
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_DI_HISTORY) || '[]')
    } catch {
      return []
    }
  })

  const [showTradeModal, setShowTradeModal] = useState(false)
  const [rlMetrics, setRlMetrics] = useState(() => getDualRlMetrics())
  const [rlSnapshot, setRlSnapshot] = useState(() => getDualRlSnapshot())
  const [rewardConfig, setRewardConfig] = useState(() => getDualRewardConfig())
  const [tradeForm, setTradeForm] = useState({
    asset: 'BTC',
    side: 'buy-low',
    strike: '',
    expiryTs: null,
    apr: '',
    quantityAsset: MIN_LOT.BTC,
    days: '',
    iv: '',
    rlStateKey: null,
    rlAction: null,
    rlConfidence: null,
    trappedTrend: false,
  })

  const loadSpots = async () => {
    const [btc, eth] = await Promise.all([
      getSpot('BTC').catch(() => null),
      getSpot('ETH').catch(() => null),
    ])
    setSpots({ BTC: btc, ETH: eth })
  }

  const loadMarketIv = async (targetAsset) => {
    if (!targetAsset) return
    try {
      const data = await getATMIV(targetAsset)
      setMarketIvByAsset((prev) => ({ ...prev, [targetAsset]: data }))
    } catch {
      setMarketIvByAsset((prev) => ({ ...prev, [targetAsset]: null }))
    }
  }

  useEffect(() => {
    loadSpots()
    const id = setInterval(loadSpots, 20000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    loadMarketIv(asset)
  }, [asset])

  useEffect(() => {
    loadMarketIv(tradeForm.asset)
  }, [tradeForm.asset])

  useEffect(() => {
    localStorage.setItem(LS_DI_BALANCES, JSON.stringify(balances))
  }, [balances])

  useEffect(() => {
    localStorage.setItem(LS_DI_POSITIONS, JSON.stringify(positions))
  }, [positions])

  useEffect(() => {
    localStorage.setItem(LS_DI_HISTORY, JSON.stringify(history))
  }, [history])

  const currentSpot = spots[asset]

  useEffect(() => {
    if (!prefillTrade) return
    const prefillAsset = prefillTrade.asset || 'BTC'
    const minLot = MIN_LOT[prefillAsset] ?? 0.01

    setAsset(prefillAsset)
    setTradeForm({
      asset: prefillAsset,
      side: prefillTrade.side === 'sell-high' ? 'sell-high' : 'buy-low',
      strike: prefillTrade.strike ? String(prefillTrade.strike) : '',
      expiryTs: prefillTrade.expiryTs ?? null,
      apr: prefillTrade.apr ? Number(prefillTrade.apr).toFixed(2) : '',
      quantityAsset: minLot,
      days: prefillTrade.days ? Number(prefillTrade.days).toFixed(2) : (prefillTrade.expiryTs ? calcDaysToExpiry(prefillTrade.expiryTs).toFixed(2) : ''),
      iv: prefillTrade.iv != null ? Number(prefillTrade.iv).toFixed(2) : '',
      rlStateKey: prefillTrade.rlStateKey ?? null,
      rlAction: prefillTrade.rlAction ?? null,
      rlConfidence: prefillTrade.rlConfidence ?? null,
      trappedTrend: prefillTrade.trappedTrend ?? false,
    })
    setShowTradeModal(true)
  }, [prefillTrade])

  const tradePreview = useMemo(() => {
    const days = Number(tradeForm.days) || calcDaysToExpiry(Number(tradeForm.expiryTs))
    return buildTradePreview({
      ...tradeForm,
      days,
    })
  }, [tradeForm])

  const tradeSpot = spots[tradeForm.asset]
  const tradeIv = useMemo(() => {
    const explicitIv = Number(tradeForm.iv)
    if (Number.isFinite(explicitIv) && explicitIv > 0) return explicitIv
    return marketIvByAsset[tradeForm.asset]?.iv ?? null
  }, [marketIvByAsset, tradeForm.asset, tradeForm.iv])
  const tradeDca = useMemo(() => getStoredDca(tradeForm.asset), [tradeForm.asset, balances])

  const liveRlEval = useMemo(() => {
    const strike = Number(tradeForm.strike)
    const apr = Number(tradeForm.apr)
    const days = Number(tradeForm.days) || calcDaysToExpiry(Number(tradeForm.expiryTs))
    const delta = computeDualDelta({ side: tradeForm.side, spot: tradeSpot, strike, days, iv: tradeIv })
    const distPct = tradeSpot && Number.isFinite(strike) && strike > 0
      ? ((strike - tradeSpot) / tradeSpot) * 100
      : null
    const plusValueLocked = Number.isFinite(strike) && Number.isFinite(tradeDca)
      ? (tradeForm.side === 'sell-high' ? strike >= tradeDca : strike <= tradeDca)
      : null
    const dcaGapPct = Number.isFinite(strike) && Number.isFinite(tradeDca) && tradeDca > 0
      ? ((strike - tradeDca) / tradeDca) * 100
      : null

    return evaluateDualPolicy({
      asset: tradeForm.asset,
      side: tradeForm.side,
      strike,
      dca: tradeDca,
      delta,
      plusValueLocked,
      dcaGapPct,
      trappedTrend: Boolean(tradeForm.trappedTrend),
      days,
      expiryTs: Number(tradeForm.expiryTs),
      apr,
      distPct,
      iv: tradeIv,
    })
  }, [tradeDca, tradeForm, tradeIv, tradeSpot])

  const lockedSummary = useMemo(() => {
    return positions.reduce((acc, pos) => {
      if (pos.side === 'sell-high') {
        acc[pos.asset] += pos.collateralAsset
      } else {
        acc.USDC += pos.collateralUsdc
      }
      return acc
    }, { USDC: 0, BTC: 0, ETH: 0 })
  }, [positions])

  const equity = useMemo(() => calcWalletEquity(balances, positions, spots), [balances, positions, spots])
  const baselineEquity = history[0]?.equity ?? equity
  const pnl = equity - baselineEquity

  useEffect(() => {
    if (!Number.isFinite(equity) || equity <= 0) return
    const now = Date.now()
    setHistory((prev) => {
      if (!prev.length) {
        return [{ ts: now, equity, pnl: 0, openPositions: positions.length }]
      }
      const last = prev[prev.length - 1]
      const point = { ts: now, equity, pnl: equity - prev[0].equity, openPositions: positions.length }
      if (now - last.ts < 25000) {
        const copy = prev.slice(0, -1)
        copy.push(point)
        return copy
      }
      return [...prev, point].slice(-180)
    })
  }, [equity, positions.length])

  const resetSimulation = () => {
    if (!window.confirm('Reinitialiser le compte de simulation DI ?')) return
    setBalances(INITIAL_BALANCES)
    setPositions([])
    setHistory([])
  }

  const openNewTrade = () => {
    const baseAsset = asset
    const defaultExpiryTs = nextWeekFridayTs()
    setTradeForm((prev) => ({
      ...prev,
      asset: baseAsset,
      side: prev.side || 'buy-low',
      quantityAsset: MIN_LOT[baseAsset] ?? 0.01,
      expiryTs: defaultExpiryTs,
      days: calcDaysToExpiry(defaultExpiryTs).toFixed(2),
      iv: marketIvByAsset[baseAsset]?.iv != null ? Number(marketIvByAsset[baseAsset].iv).toFixed(2) : '',
      rlStateKey: null,
      rlAction: null,
      rlConfidence: null,
      trappedTrend: false,
    }))
    setShowTradeModal(true)
  }

  const resetRlDataset = () => {
    if (!window.confirm('Reinitialiser le dataset RL local ?')) return
    resetDualRl()
    setRlMetrics(getDualRlMetrics())
    setRlSnapshot(getDualRlSnapshot())
  }

  const saveRewardConfig = () => {
    const next = updateDualRewardConfig(rewardConfig)
    setRewardConfig(next)
    setRlSnapshot(getDualRlSnapshot())
  }

  const resetRewardConfig = () => {
    const next = resetDualRewardConfig()
    setRewardConfig(next)
    setRlSnapshot(getDualRlSnapshot())
  }

  const executeTrade = () => {
    const strike = Number(tradeForm.strike)
    const apr = Number(tradeForm.apr)
    const days = Number(tradeForm.days) || calcDaysToExpiry(Number(tradeForm.expiryTs))
    const qtyAsset = Number(tradeForm.quantityAsset)

    if (!Number.isFinite(strike) || strike <= 0) return alert('Strike invalide')
    if (!Number.isFinite(apr) || apr <= 0) return alert('APR invalide')
    if (!Number.isFinite(days) || days <= 0) return alert('Duree invalide')
    if (!Number.isFinite(qtyAsset) || qtyAsset <= 0) return alert('Quantite invalide')

    const preview = buildTradePreview({
      ...tradeForm,
      strike,
      apr,
      days,
      quantityAsset: qtyAsset,
    })

    if (!preview || preview.invalidLot) {
      return alert(`Lot minimum ${tradeForm.asset}: ${preview?.minLot ?? (MIN_LOT[tradeForm.asset] ?? 0.01)}`)
    }

    if (preview.side === 'sell-high') {
      if (balances[tradeForm.asset] < preview.collateralAsset) {
        return alert(`Solde ${tradeForm.asset} insuffisant pour verrouiller ${preview.collateralAsset}`)
      }
    } else if (balances.USDC < preview.collateralUsdc) {
      return alert(`Solde USDC insuffisant. Requis: ${preview.collateralUsdc.toFixed(2)}`)
    }

    const now = Date.now()
    const spotNow = spots[tradeForm.asset]
    const distPct = spotNow ? ((strike - spotNow) / spotNow) * 100 : null
    const resolvedIv = Number.isFinite(Number(tradeForm.iv)) && Number(tradeForm.iv) > 0
      ? Number(tradeForm.iv)
      : (marketIvByAsset[tradeForm.asset]?.iv ?? null)
    const dca = getStoredDca(tradeForm.asset)
    const delta = computeDualDelta({ side: preview.side, spot: spotNow, strike, days, iv: resolvedIv })
    const plusValueLocked = Number.isFinite(strike) && Number.isFinite(dca)
      ? (preview.side === 'sell-high' ? strike >= dca : strike <= dca)
      : null
    const dcaGapPct = Number.isFinite(strike) && Number.isFinite(dca) && dca > 0
      ? ((strike - dca) / dca) * 100
      : null
    const rlEval = evaluateDualPolicy({
      asset: tradeForm.asset,
      side: preview.side,
      strike,
      dca,
      delta,
      plusValueLocked,
      dcaGapPct,
      trappedTrend: Boolean(tradeForm.trappedTrend),
      days,
      expiryTs: Number(tradeForm.expiryTs) || (now + preview.days * 86400000),
      apr,
      distPct,
      iv: resolvedIv,
    })

    const position = {
      id: now,
      asset: tradeForm.asset,
      side: preview.side,
      strike: preview.strike,
      apr: preview.apr,
      days: preview.days,
      expiryTs: Number(tradeForm.expiryTs) || (now + preview.days * 86400000),
      quantityAsset: preview.qtyAsset,
      collateralAsset: preview.collateralAsset,
      collateralUsdc: preview.collateralUsdc,
      premiumAsset: preview.premiumAsset,
      premiumUsdc: preview.premiumUsdc,
      periodRate: preview.periodRate,
      entrySpot: spots[tradeForm.asset],
      entryTs: now,
      entryIv: resolvedIv,
      dca,
      delta,
      plusValueLocked,
      trappedTrend: Boolean(tradeForm.trappedTrend),
      dcaGapPct,
      rlStateKey: rlEval?.stateKey ?? null,
      rlAction: rlEval?.action ?? null,
      rlConfidence: rlEval?.confidence ?? null,
    }

    setBalances((prev) => {
      if (preview.side === 'sell-high') {
        return { ...prev, [tradeForm.asset]: prev[tradeForm.asset] - preview.collateralAsset }
      }
      return { ...prev, USDC: prev.USDC - preview.collateralUsdc }
    })

    setPositions((prev) => [position, ...prev])
    setShowTradeModal(false)
  }

  const settlePosition = (id) => {
    const pos = positions.find((p) => p.id === id)
    if (!pos) return

    const settleSpot = spots[pos.asset]
    if (!settleSpot) return alert('Spot indisponible pour settlement')

    const exercised = pos.side === 'sell-high'
      ? settleSpot >= pos.strike
      : settleSpot <= pos.strike
    const reward = calcSettlementReward(pos, settleSpot)

    setBalances((prev) => {
      const next = { ...prev }
      if (pos.side === 'sell-high') {
        if (exercised) {
          next.USDC += pos.collateralAsset * pos.strike
          next[pos.asset] += pos.premiumAsset
        } else {
          next[pos.asset] += pos.collateralAsset + pos.premiumAsset
        }
      } else if (exercised) {
        next[pos.asset] += pos.collateralUsdc / pos.strike
        next.USDC += pos.premiumUsdc
      } else {
        next.USDC += pos.collateralUsdc + pos.premiumUsdc
      }
      return next
    })

    setPositions((prev) => prev.filter((p) => p.id !== id))

    if (pos.rlStateKey) {
      learnFromSettlement({
        stateKey: pos.rlStateKey,
        rewardPct: reward.rewardPct,
        meta: {
          side: pos.side,
          asset: pos.asset,
          exercised,
          strike: pos.strike,
          settleSpot,
          apr: pos.apr,
          days: pos.days,
          entryTs: pos.entryTs,
          expiryTs: pos.expiryTs,
          dca: pos.dca,
          delta: pos.delta,
          plusValueLocked: pos.plusValueLocked,
          trappedTrend: pos.trappedTrend,
          dcaGapPct: pos.dcaGapPct,
          netPnlUsd: reward.netPnlUsd,
        },
      })
      setRlMetrics(getDualRlMetrics())
      setRlSnapshot(getDualRlSnapshot())
    }
  }

  return (
    <div className="app-shell">
      <div className="app-content">
        <div className="page-wrap">

          <div className="page-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="page-title">Dual <span>Paper Trading</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="icon-btn" onClick={openNewTrade}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Nouvelle
              </button>
              <button className="icon-btn" onClick={resetSimulation}>Reset</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div className="stat-card">
              <div className="stat-label">Equity</div>
              <div className="stat-value blue">${formatNum(equity, 2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">P&L Simule</div>
              <div className="stat-value" style={{ color: pnl >= 0 ? 'var(--call)' : 'var(--put)' }}>{pnl >= 0 ? '+' : ''}{formatNum(pnl, 2)} USD</div>
            </div>
          </div>

          <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>RL Dataset</div>
              <button onClick={resetRlDataset} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}>
                Reset RL
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10 }}>
              <div style={{ color: 'var(--text-muted)' }}>Etats: <span style={{ color: 'var(--text)' }}>{rlMetrics.states}</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Experiences: <span style={{ color: 'var(--text)' }}>{rlMetrics.experiences}</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Reward final moy: <span style={{ color: rlMetrics.avgReward >= 0 ? 'var(--call)' : 'var(--put)' }}>{formatNum(rlMetrics.avgReward, 2)}%</span></div>
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
              Reward PnL brut moy: <span style={{ color: rlMetrics.avgBaseReward >= 0 ? 'var(--call)' : 'var(--put)' }}>{formatNum(rlMetrics.avgBaseReward, 2)}%</span>
            </div>
            {rlMetrics.lastTs && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                Dernier apprentissage: {formatDate(rlMetrics.lastTs)} {formatTime(rlMetrics.lastTs)}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>Reward Config</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={resetRewardConfig} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}>
                  Defaut
                </button>
                <button onClick={saveRewardConfig} style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#001016', cursor: 'pointer', fontSize: 10, padding: '3px 8px', fontWeight: 700 }}>
                  Sauver
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['pnlWeight', 'Poids PnL'],
                ['calendarWeight', 'Poids calendrier'],
                ['fridayWeight', 'Poids vendredi'],
                ['cycleWeight', 'Poids cycle'],
                ['cycleTargetDays', 'Cible jours'],
                ['cycleToleranceDays', 'Tolerance jours'],
                ['exercisedPenalty', 'Penalite exercice'],
                ['dcaWeight', 'Poids DCA'],
                ['plusValueWeight', 'Bonus plus-value'],
                ['trappedWeight', 'Poids marche piege'],
                ['deltaWeight', 'Poids delta'],
                ['deltaTarget', 'Delta cible'],
                ['deltaTolerance', 'Tolerance delta'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  {label}
                  <input
                    type="number"
                    step="0.1"
                    value={rewardConfig[key]}
                    onChange={(e) => setRewardConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', padding: 7, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>Analyse RL</div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Top etats appris</div>
            {rlSnapshot.topStates.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Aucune experience enregistree pour le moment.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {rlSnapshot.topStates.map((state) => (
                  <div key={state.stateKey} style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--text)', wordBreak: 'break-all' }}>{state.stateKey}</span>
                      <span style={{ fontSize: 10, color: state.edge >= 0 ? 'var(--call)' : 'var(--put)', whiteSpace: 'nowrap' }}>
                        edge {state.edge >= 0 ? '+' : ''}{formatNum(state.edge, 2)}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10 }}>
                      <div style={{ color: 'var(--text-muted)' }}>Samples: <span style={{ color: 'var(--text)' }}>{state.samples}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Avg: <span style={{ color: state.avgReward >= 0 ? 'var(--call)' : 'var(--put)' }}>{formatNum(state.avgReward, 2)}%</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Dernier: <span style={{ color: state.lastReward >= 0 ? 'var(--call)' : 'var(--put)' }}>{state.lastReward != null ? `${formatNum(state.lastReward, 2)}%` : '—'}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Contraintes calendrier</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12, fontSize: 10 }}>
              <div style={{ color: 'var(--text-muted)' }}>Samples: <span style={{ color: 'var(--text)' }}>{rlSnapshot.calendarStats?.samples ?? 0}</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Friday rate: <span style={{ color: 'var(--text)' }}>{formatNum((rlSnapshot.calendarStats?.fridayRate ?? 0) * 100, 1)}%</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Dist. cible: <span style={{ color: 'var(--text)' }}>{rlSnapshot.calendarStats?.avgCycleDistance != null ? `${formatNum(rlSnapshot.calendarStats.avgCycleDistance, 2)}j` : '—'}</span></div>
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Protocole DCA / Delta</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12, fontSize: 10 }}>
              <div style={{ color: 'var(--text-muted)' }}>Tx plus-value: <span style={{ color: 'var(--text)' }}>{formatNum((rlSnapshot.protocolStats?.plusValueRate ?? 0) * 100, 1)}%</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Delta ≥ cible: <span style={{ color: 'var(--text)' }}>{formatNum((rlSnapshot.protocolStats?.deltaFloorRate ?? 0) * 100, 1)}%</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Tx piege: <span style={{ color: 'var(--text)' }}>{formatNum((rlSnapshot.protocolStats?.trappedRate ?? 0) * 100, 1)}%</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Gap DCA moyen: <span style={{ color: 'var(--text)' }}>{rlSnapshot.protocolStats?.avgDcaGapPct != null ? `${formatNum(rlSnapshot.protocolStats.avgDcaGapPct, 2)}%` : '—'}</span></div>
              <div style={{ color: 'var(--text-muted)' }}>Delta moyen: <span style={{ color: 'var(--text)' }}>{rlSnapshot.protocolStats?.avgDeltaAbs != null ? formatNum(rlSnapshot.protocolStats.avgDeltaAbs, 3) : '—'}</span></div>
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Experiences recentes</div>
            {rlSnapshot.recentExperiences.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Le tableau se remplira apres les premiers settlements.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rlSnapshot.recentExperiences.map((entry) => (
                  <div key={`${entry.ts}-${entry.stateKey}`} style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatDate(entry.ts)} {formatTime(entry.ts)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: entry.rewardPct >= 0 ? 'var(--call)' : 'var(--put)' }}>
                        {entry.rewardPct >= 0 ? '+' : ''}{formatNum(entry.rewardPct, 2)}%
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text)' }}>{entry.stateKey}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4, fontSize: 10 }}>
                      <div style={{ color: 'var(--text-muted)' }}>Base PnL: <span style={{ color: (entry.rewardBasePct ?? 0) >= 0 ? 'var(--call)' : 'var(--put)' }}>{Number.isFinite(entry.rewardBasePct) ? `${formatNum(entry.rewardBasePct, 2)}%` : '—'}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Trade: <span style={{ color: 'var(--text)' }}>{entry.meta?.asset || '—'} {entry.meta?.side || ''}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Net: <span style={{ color: (entry.meta?.netPnlUsd ?? 0) >= 0 ? 'var(--call)' : 'var(--put)' }}>{entry.meta?.netPnlUsd != null ? `${formatNum(entry.meta.netPnlUsd, 2)} USD` : '—'}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Exerce: <span style={{ color: entry.meta?.exercised ? 'var(--put)' : 'var(--call)' }}>{entry.meta?.exercised ? 'Oui' : 'Non'}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Bonus cal: <span style={{ color: (entry.rewardDiagnostics?.calendar?.calendarBonus ?? 0) >= 0 ? 'var(--call)' : 'var(--put)' }}>{entry.rewardDiagnostics?.calendar?.calendarBonus != null ? `${formatNum(entry.rewardDiagnostics.calendar.calendarBonus, 2)}%` : '—'}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Q: <span style={{ color: 'var(--text)' }}>{formatNum(entry.qSubscribe, 2)} / {formatNum(entry.qSkip, 2)}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>DCA: <span style={{ color: entry.rewardDiagnostics?.dca?.plusValueLocked ? 'var(--call)' : 'var(--text)' }}>{entry.rewardDiagnostics?.dca?.plusValueLocked ? 'plus-value' : entry.rewardDiagnostics?.dca?.dcaGapPct != null ? `${formatNum(Math.abs(entry.rewardDiagnostics.dca.dcaGapPct), 2)}% gap` : '—'}</span></div>
                      <div style={{ color: 'var(--text-muted)' }}>Delta: <span style={{ color: entry.rewardDiagnostics?.delta?.deltaFloorOk ? 'var(--call)' : 'var(--put)' }}>{entry.rewardDiagnostics?.delta?.deltaAbs != null ? formatNum(entry.rewardDiagnostics.delta.deltaAbs, 3) : '—'}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>USDC dispo</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14 }}>${formatNum(balances.USDC, 2)}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Lock: ${formatNum(lockedSummary.USDC, 2)}</div>
            </div>
            <div className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>BTC dispo</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14 }}>{formatNum(balances.BTC, 5)} BTC</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Lock: {formatNum(lockedSummary.BTC, 5)}</div>
            </div>
            <div className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>ETH dispo</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14 }}>{formatNum(balances.ETH, 4)} ETH</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Lock: {formatNum(lockedSummary.ETH, 4)}</div>
            </div>
          </div>

          <PerformanceChart points={history} />

          <div className="asset-toggle" style={{ margin: '12px 0' }}>
            <button className={`asset-btn${asset === 'BTC' ? ' active-btc' : ''}`} onClick={() => setAsset('BTC')}>BTC</button>
            <button className={`asset-btn${asset === 'ETH' ? ' active-eth' : ''}`} onClick={() => setAsset('ETH')}>ETH</button>
          </div>

          <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            Spot {asset}: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>${formatNum(currentSpot, 2)}</span>
          </div>

          <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>Positions DI ouvertes ({asset})</div>
          {positions.filter((p) => p.asset === asset).length === 0 ? (
            <div className="card">
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                Aucune position ouverte. Utilise Subscribe depuis la chaine ou "Nouvelle".
              </div>
            </div>
          ) : (
            positions.filter((p) => p.asset === asset).map((pos) => {
              const exercisedIfNow = pos.side === 'sell-high' ? (currentSpot >= pos.strike) : (currentSpot <= pos.strike)
              return (
                <div key={pos.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 7 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>
                          {pos.side === 'buy-low' ? 'Buy Low' : 'Sell High'} {pos.asset} @ ${formatNum(pos.strike, 0)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          APR {formatNum(pos.apr, 2)}% · {formatNum(pos.days, 2)}j · exp {formatDate(pos.expiryTs)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                          RL {pos.rlAction === 'subscribe' ? 'GO' : 'WAIT'} {pos.rlConfidence ?? 50}%
                        </div>
                        <div style={{ fontSize: 9, color: pos.plusValueLocked ? 'var(--call)' : 'var(--text-muted)', marginTop: 2 }}>
                          {pos.plusValueLocked ? 'Plus-value si exerce' : pos.dcaGapPct != null ? `Gap DCA ${formatNum(Math.abs(pos.dcaGapPct), 2)}%` : 'DCA non renseigne'} · delta {pos.delta != null ? Math.abs(pos.delta).toFixed(2) : '—'}
                        </div>
                      </div>
                      <button onClick={() => settlePosition(pos.id)} style={{ background: 'var(--accent)', color: '#001016', border: 'none', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>
                        Regler au spot actuel
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
                      <div style={{ background: 'rgba(0,212,255,.06)', border: '1px solid rgba(0,212,255,.2)', borderRadius: 8, padding: '7px 8px' }}>
                        <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>Si exerce</div>
                        {pos.side === 'sell-high' ? (
                          <div style={{ color: 'var(--text)' }}>Vente {formatNum(pos.collateralAsset, 6)} {pos.asset} a {formatNum(pos.strike, 0)} + prime {formatNum(pos.premiumAsset, 6)} {pos.asset}</div>
                        ) : (
                          <div style={{ color: 'var(--text)' }}>Conversion ${formatNum(pos.collateralUsdc, 2)} en {formatNum(pos.collateralUsdc / pos.strike, 6)} {pos.asset} + prime ${formatNum(pos.premiumUsdc, 2)}</div>
                        )}
                      </div>

                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 8px' }}>
                        <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>Si non exerce</div>
                        {pos.side === 'sell-high' ? (
                          <div style={{ color: 'var(--text)' }}>Retour {formatNum(pos.collateralAsset + pos.premiumAsset, 6)} {pos.asset}</div>
                        ) : (
                          <div style={{ color: 'var(--text)' }}>Retour ${formatNum(pos.collateralUsdc + pos.premiumUsdc, 2)} USDC</div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: 7, fontSize: 10, color: exercisedIfNow ? 'var(--accent2)' : 'var(--call)' }}>
                      Etat au spot actuel: {exercisedIfNow ? 'Exerce' : 'Non exerce'}
                    </div>
                  </div>
                </div>
              )
            })
          )}

          {showTradeModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.56)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
              <div style={{ width: '100%', maxWidth: 440, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Transaction DI</div>
                  <button onClick={() => setShowTradeModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Fermer</button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button className={`asset-btn${tradeForm.asset === 'BTC' ? ' active-btc' : ''}`} onClick={() => setTradeForm((p) => ({ ...p, asset: 'BTC', quantityAsset: Math.max(Number(p.quantityAsset) || 0, MIN_LOT.BTC), iv: '', rlStateKey: null, rlAction: null, rlConfidence: null, trappedTrend: false }))}>BTC</button>
                  <button className={`asset-btn${tradeForm.asset === 'ETH' ? ' active-eth' : ''}`} onClick={() => setTradeForm((p) => ({ ...p, asset: 'ETH', quantityAsset: Math.max(Number(p.quantityAsset) || 0, MIN_LOT.ETH), iv: '', rlStateKey: null, rlAction: null, rlConfidence: null, trappedTrend: false }))}>ETH</button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button className={`asset-btn${tradeForm.side === 'buy-low' ? ' active-btc' : ''}`} onClick={() => setTradeForm((p) => ({ ...p, side: 'buy-low' }))}>Buy Low</button>
                  <button className={`asset-btn${tradeForm.side === 'sell-high' ? ' active-eth' : ''}`} onClick={() => setTradeForm((p) => ({ ...p, side: 'sell-high' }))}>Sell High</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input type="number" placeholder="Strike" value={tradeForm.strike}
                    onChange={(e) => setTradeForm((p) => ({ ...p, strike: e.target.value }))}
                    style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <input type="number" placeholder="APR %" value={tradeForm.apr}
                    onChange={(e) => setTradeForm((p) => ({ ...p, apr: e.target.value }))}
                    style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <input type="number" placeholder="Duree (jours)" value={tradeForm.days}
                    onChange={(e) => setTradeForm((p) => ({ ...p, days: e.target.value }))}
                    style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <input type="number" step="0.0001" placeholder={`Quantite ${tradeForm.asset}`} value={tradeForm.quantityAsset}
                    onChange={(e) => setTradeForm((p) => ({ ...p, quantityAsset: e.target.value }))}
                    style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                </div>

                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input type="number" step="0.01" placeholder="IV % (optionnel)" value={tradeForm.iv}
                    onChange={(e) => setTradeForm((p) => ({ ...p, iv: e.target.value, rlStateKey: null, rlAction: null, rlConfidence: null }))}
                    style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 10 }}>
                    IV marche ATM: {marketIvByAsset[tradeForm.asset]?.iv != null ? `${formatNum(marketIvByAsset[tradeForm.asset].iv, 2)}%` : 'indisponible'}
                  </div>
                </div>

                <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
                  RL state: {liveRlEval.stateKey}
                </div>

                <div style={{ marginTop: 8, background: liveRlEval.action === 'subscribe' ? 'rgba(0,229,160,.08)' : 'rgba(255,255,255,.04)', border: `1px solid ${liveRlEval.action === 'subscribe' ? 'rgba(0,229,160,.22)' : 'var(--border)'}`, borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: liveRlEval.action === 'subscribe' ? 'var(--call)' : 'var(--text)' }}>
                      RL {liveRlEval.action === 'subscribe' ? 'GO' : 'WAIT'} {liveRlEval.confidence}%
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      IV utilisee: {tradeIv != null ? `${formatNum(tradeIv, 2)}%` : 'manquante'}
                    </div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                    {liveRlEval.highIvCondition
                      ? `Filtre IV valide (seuil ${liveRlEval.ivFloor}%).`
                      : `Filtre IV non valide: seuil ${liveRlEval.ivFloor}%, IV actuelle ${tradeIv != null ? formatNum(tradeIv, 2) : '—'}%.`}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                    DCA {tradeForm.asset}: {tradeDca != null ? `${formatNum(tradeDca, 2)} USD` : 'non renseigne'} · protocole {liveRlEval.protocol}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                    Delta: <span style={{ color: liveRlEval.deltaFloorOk ? 'var(--call)' : 'var(--put)' }}>{liveRlEval.delta != null ? liveRlEval.delta.toFixed(3) : '—'}</span> · objectif {'>='} {liveRlEval.deltaTarget?.toFixed(2)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                    {liveRlEval.plusValueLocked
                      ? 'Si exerce: transaction en plus-value selon le DCA.'
                      : liveRlEval.trappedProtocolActive
                        ? `Marche piege: viser le strike le plus proche du DCA (${liveRlEval.dcaGapPct != null ? `${formatNum(Math.abs(liveRlEval.dcaGapPct), 2)}%` : '—'}).`
                        : 'Si exerce: strike defavorable vs DCA.'}
                  </div>
                </div>

                {tradeForm.expiryTs ? (
                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
                    Expiration contrat: {formatDate(Number(tradeForm.expiryTs))} {formatTime(Number(tradeForm.expiryTs))} UTC
                  </div>
                ) : null}

                {tradePreview && !tradePreview.invalidLot ? (
                  <div style={{ marginTop: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 5 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Relation APR/temps</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>taux periode = APR x jours / 365</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 8 }}>
                      {formatNum(tradePreview.apr, 2)}% x {formatNum(tradePreview.days, 2)} / 365 = {(tradePreview.periodRate * 100).toFixed(3)}%
                    </div>

                    {tradePreview.side === 'sell-high' ? (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Collateral requis: {formatNum(tradePreview.collateralAsset, 6)} {tradeForm.asset} (min {tradePreview.minLot})</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Prime estimee: {formatNum(tradePreview.premiumAsset, 6)} {tradeForm.asset}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Collateral requis: ${formatNum(tradePreview.collateralUsdc, 2)} USDC</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Prime estimee: ${formatNum(tradePreview.premiumUsdc, 2)} USDC</div>
                      </>
                    )}

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
                      <div style={{ border: '1px solid rgba(0,229,160,.25)', borderRadius: 8, padding: '7px 8px', background: 'rgba(0,229,160,.06)' }}>
                        <div style={{ color: 'var(--call)', marginBottom: 3, fontWeight: 700 }}>Non exerce</div>
                        <div style={{ color: 'var(--text)' }}>
                          {tradePreview.side === 'sell-high'
                            ? `Retour ${formatNum(tradePreview.collateralAsset + tradePreview.premiumAsset, 6)} ${tradeForm.asset}`
                            : `Retour ${formatNum(tradePreview.collateralUsdc + tradePreview.premiumUsdc, 2)} USDC`}
                        </div>
                      </div>
                      <div style={{ border: '1px solid rgba(255,107,53,.25)', borderRadius: 8, padding: '7px 8px', background: 'rgba(255,107,53,.06)' }}>
                        <div style={{ color: 'var(--accent2)', marginBottom: 3, fontWeight: 700 }}>Exerce</div>
                        <div style={{ color: 'var(--text)' }}>
                          {tradePreview.side === 'sell-high'
                            ? `Vente au strike + prime ${formatNum(tradePreview.premiumAsset, 6)} ${tradeForm.asset}`
                            : `USDC convertis en ${formatNum(tradePreview.collateralUsdc / tradePreview.strike, 6)} ${tradeForm.asset}`}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, color: 'var(--put)', fontSize: 11 }}>
                    {tradePreview?.invalidLot ? `Lot minimum ${tradeForm.asset}: ${tradePreview.minLot}` : 'Renseigne strike, APR, duree et quantite.'}
                  </div>
                )}

                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowTradeModal(false)} style={{ flex: 1, padding: 10, borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Annuler</button>
                  <button onClick={executeTrade} style={{ flex: 1, padding: 10, borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#001016', cursor: 'pointer', fontWeight: 700 }}>Executer</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
