/**
 * LandingPage — Écran d'accueil Veridex
 *
 * Fond animé double-canvas (réseau signaux + radar hexagonal),
 * données live depuis SmartCache avec fallback statique,
 * sélecteur BTC/ETH, prix animé, score ring, metrics grid, ticker.
 *
 * Props :
 *   onEnter       : () => void
 *   asset         : 'BTC' | 'ETH'
 *   onAssetChange : (a: string) => void
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import VLogo from '../components/VLogo.jsx'
import { dataStore, CacheKey } from '../../data/data_store/cache.js'
import { getSignalHistory } from '../../signals/signal_engine.js'

// ── Couleurs hardcodées (thème sombre indépendant) ────────────────────────────
const C = {
  bg:          '#0a0e14',
  text:        '#f0f2f5',
  muted:       'rgba(255,255,255,0.28)',
  ghost:       'rgba(255,255,255,0.18)',
  surface:     'rgba(255,255,255,0.04)',
  border:      'rgba(255,255,255,0.07)',
  accent:      '#1D9E75',
  accentLight: '#5DCAA5',
  accentDim:   'rgba(29,158,117,0.12)',
  accentBrd:   'rgba(29,158,117,0.25)',
  warning:     '#EF9F27',
  danger:      '#E24B4A',
  dangerLight: '#F09595',
}

// ── Données statiques fallback ────────────────────────────────────────────────
const ASSET_DATA = {
  BTC: {
    name:      'Bitcoin · Deribit index',
    price:     68212,
    change:    '+2.4% aujourd\'hui',
    changeDir: 'up',
    vwap:      'VWAP $68,198',
    score:     75,
    label:     '✓ Favorable',
    ivRank:    { val: '74',    sub: 'Élevé',    color: 'accent'  },
    funding:   { val: '+38%',  sub: 'Haussier',  color: 'warning' },
    fearGreed: { val: '72',    sub: 'Greed',     color: 'warning' },
    maxPain:   { val: '$67k',  sub: '-1.8%',     color: 'ghost'   },
  },
  ETH: {
    name:      'Ethereum · Deribit index',
    price:     2043,
    change:    '-1.2% aujourd\'hui',
    changeDir: 'down',
    vwap:      'VWAP $2,039',
    score:     52,
    label:     '~ Neutre',
    ivRank:    { val: '58',    sub: 'Modéré',    color: 'muted'   },
    funding:   { val: '+12%',  sub: 'Modéré',    color: 'muted'   },
    fearGreed: { val: '61',    sub: 'Greed',     color: 'warning' },
    maxPain:   { val: '$2.0k', sub: '-0.8%',     color: 'ghost'   },
  },
}

function metricColor(colorKey) {
  if (colorKey === 'accent')  return C.accentLight
  if (colorKey === 'warning') return C.warning
  if (colorKey === 'danger')  return C.danger
  return C.muted
}

// ── Canvas Net : réseau de signaux ────────────────────────────────────────────
const NET_NODES_DEF = [
  { label: 'IV',    color: C.accent      },
  { label: 'Fund',  color: C.accent      },
  { label: 'Basis', color: C.warning     },
  { label: 'OI',    color: C.accent      },
  { label: 'P/C',   color: C.warning     },
  { label: 'L/S',   color: C.danger      },
  { label: 'F&G',   color: C.accent      },
  { label: 'Hash',  color: C.accentLight },
]

function initNodes(w, h) {
  return NET_NODES_DEF.map(n => ({
    ...n,
    x:     20 + Math.random() * (w - 40),
    y:     20 + Math.random() * (h - 40),
    vx:    (Math.random() - 0.5) * 0.7,
    vy:    (Math.random() - 0.5) * 0.7,
    r:     2.5 + Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
  }))
}

function useCanvasNet(ref) {
  const nodesRef = useRef(null)
  const rafRef   = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let dpr   = window.devicePixelRatio || 1

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = rect.width, h = rect.height
      const prevW = canvas.width / dpr
      const prevH = canvas.height / dpr
      canvas.width  = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      if (nodesRef.current && prevW > 0 && prevH > 0) {
        nodesRef.current.forEach(n => {
          n.x = Math.min(Math.max(n.x * (w / prevW), 20), w - 20)
          n.y = Math.min(Math.max(n.y * (h / prevH), 20), h - 20)
        })
      } else {
        nodesRef.current = initNodes(w, h)
      }
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const draw = () => {
      if (document.hidden) { rafRef.current = requestAnimationFrame(draw); return }
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.clearRect(0, 0, w, h)
      const nodes = nodesRef.current
      if (!nodes) { rafRef.current = requestAnimationFrame(draw); return }

      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy; n.phase += 0.025
        if (n.x < 20 || n.x > w - 20) { n.vx *= -1; n.x = Math.min(Math.max(n.x, 20), w - 20) }
        if (n.y < 20 || n.y > h - 20) { n.vy *= -1; n.y = Math.min(Math.max(n.y, 20), h - 20) }
      })

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 110) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(29,158,117,${(1 - dist / 110) * 0.3})`
            ctx.lineWidth   = 0.7
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      nodes.forEach(n => {
        const glow = 0.7 + 0.3 * Math.sin(n.phase)
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * 2.2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(29,158,117,${0.1 * glow})`
        ctx.fill()
        ctx.globalAlpha = glow
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle  = 'rgba(255,255,255,0.45)'
        ctx.font       = '7px monospace'
        ctx.textAlign  = 'center'
        ctx.fillText(n.label, n.x, n.y - n.r - 3)
      })

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [ref])
}

// ── Canvas Rad : radar hexagonal ──────────────────────────────────────────────
const RAD_AXES = ['IV', 'Fund', 'Basis', 'IV/RV', 'OnCh', 'Pos']

function useCanvasRad(ref) {
  const stateRef = useRef({
    current: [0.75, 0.50, 0.70, 0.60, 0.80, 0.45],
    targets: [0.75, 0.50, 0.70, 0.60, 0.80, 0.45],
    angle:   0,
  })
  const rafRef   = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let dpr   = window.devicePixelRatio || 1

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    timerRef.current = setInterval(() => {
      stateRef.current.targets = stateRef.current.targets.map(() => 0.30 + Math.random() * 0.65)
    }, 2800)

    const hex = (cx, cy, R, idx, val) => {
      const a = (Math.PI / 3) * idx - Math.PI / 2
      return { x: cx + Math.cos(a) * R * val, y: cy + Math.sin(a) * R * val }
    }

    const draw = () => {
      if (document.hidden) { rafRef.current = requestAnimationFrame(draw); return }
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.clearRect(0, 0, w, h)

      const s  = stateRef.current
      const cx = w / 2, cy = h / 2
      const R  = Math.min(w, h) * 0.38

      s.current = s.current.map((v, i) => v + (s.targets[i] - v) * 0.015)
      s.angle  += 0.006

      // Grille
      ;[0.33, 0.66, 1.0].forEach(f => {
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const p = hex(cx, cy, R, i, f)
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
        }
        ctx.closePath()
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth   = 0.5
        ctx.stroke()
      })

      // Axes
      for (let i = 0; i < 6; i++) {
        const p = hex(cx, cy, R, i, 1)
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(p.x, p.y)
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth   = 0.5
        ctx.stroke()
      }

      // Scan
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(s.angle) * R, cy + Math.sin(s.angle) * R)
      ctx.strokeStyle = 'rgba(29,158,117,0.35)'
      ctx.lineWidth   = 1
      ctx.stroke()

      // Forme
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const p = hex(cx, cy, R, i, s.current[i])
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.fillStyle   = 'rgba(29,158,117,0.08)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(29,158,117,0.5)'
      ctx.lineWidth   = 1.2
      ctx.stroke()

      // Points sommets
      for (let i = 0; i < 6; i++) {
        const p = hex(cx, cy, R, i, s.current[i])
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fillStyle = C.accent
        ctx.fill()
      }

      // Labels
      for (let i = 0; i < 6; i++) {
        const p = hex(cx, cy, R, i, 1.22)
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font      = '7px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(RAD_AXES[i], p.x, p.y + 3)
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      clearInterval(timerRef.current)
      ro.disconnect()
    }
  }, [ref])
}

// ── Composants locaux ─────────────────────────────────────────────────────────

function LivePill() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 12px',
      background: C.accentDim,
      border: `1px solid ${C.accentBrd}`,
      borderRadius: 20,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: C.accentLight,
        animation: 'pulse 2s ease-in-out infinite',
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 11,
        fontWeight: 500, color: C.accentLight,
      }}>
        Live
      </span>
    </div>
  )
}

function AssetPill({ asset, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 3,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
    }}>
      {['BTC', 'ETH'].map(a => (
        <button
          key={a}
          onClick={() => onChange(a)}
          style={{
            padding: '5px 12px',
            border: asset === a ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
            borderRadius: 7,
            background: asset === a ? 'rgba(255,255,255,0.10)' : 'transparent',
            color: asset === a ? C.text : C.muted,
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12,
            cursor: 'pointer', transition: 'all 150ms ease',
          }}
        >
          {a}
        </button>
      ))}
    </div>
  )
}

function PriceBlock({ asset, data, flashColor }) {
  const changeColor = data.changeDir === 'up' ? C.accentLight : C.dangerLight
  return (
    <div style={{ textAlign: 'center', marginBottom: 20 }}>
      <div style={{
        fontSize: 11, color: C.muted,
        fontFamily: 'var(--font-body)', marginBottom: 6,
      }}>
        {data.name}
      </div>
      <div
        key={asset + data.price}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 52, fontWeight: 700, lineHeight: 1,
          color: flashColor || C.text,
          transition: 'color 500ms ease',
          animation: 'priceIn 400ms ease both',
          letterSpacing: '-0.02em',
        }}
      >
        ${Math.round(data.price).toLocaleString('en-US')}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 8, marginTop: 8,
      }}>
        <span style={{
          padding: '3px 9px', borderRadius: 6,
          fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 600,
          background: data.changeDir === 'up'
            ? 'rgba(29,158,117,0.15)' : 'rgba(226,75,74,0.15)',
          color: changeColor,
        }}>
          {data.change}
        </span>
        <span style={{ fontSize: 10, color: C.ghost, fontFamily: 'var(--font-mono)' }}>
          {data.vwap}
        </span>
      </div>
    </div>
  )
}

function ScoreRing({ score, label }) {
  const [displayed, setDisplayed] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    setDisplayed(0)
    const start  = performance.now()
    const dur    = 1400
    const target = score ?? 0
    const animate = (now) => {
      const t    = Math.min((now - start) / dur, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(ease * target))
      if (t < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [score])

  const r      = 28
  const circ   = 2 * Math.PI * r
  const offset = circ - ((score ?? 0) / 100) * circ
  const color  = (score ?? 0) >= 70 ? C.accent
    : (score ?? 0) >= 50 ? C.warning : C.danger

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', marginBottom: 20,
    }}>
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle cx={36} cy={36} r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth={6} />
        <circle cx={36} cy={36} r={r} fill="none"
          stroke={color} strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.34,1.56,0.64,1), stroke 0.5s ease' }}
        />
        <text x={36} y={37} textAnchor="middle" dominantBaseline="middle"
          fill={color}
          style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15 }}>
          {displayed}
        </text>
      </svg>
      <div style={{
        fontSize: 12, color: C.muted,
        fontFamily: 'var(--font-body)', marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  )
}

function MetricsGrid({ data }) {
  const items = [
    { key: 'ivRank',    label: 'IV Rank'     },
    { key: 'funding',   label: 'Funding'     },
    { key: 'fearGreed', label: 'Fear & Greed' },
    { key: 'maxPain',   label: 'Max Pain'    },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: 8, width: '100%', marginBottom: 20,
    }}>
      {items.map(m => {
        const item = data[m.key]
        return (
          <div key={m.key} style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 12px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 9, color: C.muted,
              fontFamily: 'var(--font-body)', fontWeight: 600,
              letterSpacing: '0.07em', textTransform: 'uppercase',
              marginBottom: 4,
            }}>
              {m.label}
            </div>
            <div style={{
              fontSize: 18, fontFamily: 'var(--font-mono)',
              fontWeight: 700, color: metricColor(item.color), lineHeight: 1,
            }}>
              {item.val}
            </div>
            <div style={{
              fontSize: 10, color: C.ghost,
              fontFamily: 'var(--font-body)', marginTop: 2,
            }}>
              {item.sub}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TickerStrip({ data }) {
  const [flashIdx, setFlashIdx] = useState(-1)

  useEffect(() => {
    const timer = setInterval(() => {
      const idx = Math.floor(Math.random() * 8)
      setFlashIdx(idx)
      setTimeout(() => setFlashIdx(-1), 500)
    }, 1600)
    return () => clearInterval(timer)
  }, [])

  const items = [
    { name: 'BTC/USD',    val: `$${Math.round(data.price ?? 68212).toLocaleString('en-US')}`, dir: data.changeDir ?? 'up' },
    { name: 'ETH/USD',    val: '$2,043',  dir: 'down'  },
    { name: 'DVOL',       val: '74.2',    dir: 'up'    },
    { name: 'Funding',    val: data.funding?.val   ?? '+38%', dir: 'up'   },
    { name: 'Fear&Greed', val: data.fearGreed?.val ?? '72',   dir: 'up'   },
    { name: 'Basis',      val: '+8.4%',   dir: 'up'    },
    { name: 'P/C OI',     val: '0.72',    dir: 'down'  },
    { name: 'L/S',        val: '1.18',    dir: 'up'    },
  ]
  const doubled = [...items, ...items]

  return (
    <div className="ticker-strip">
      <div className="ticker-track">
        {doubled.map((item, i) => {
          const isFlash  = flashIdx === (i % 8)
          const dirColor = item.dir === 'up' ? C.accentLight : C.dangerLight
          return (
            <div key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 16px', flexShrink: 0,
              borderRight: '1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{
                fontSize: 10, color: C.muted,
                fontFamily: 'var(--font-body)', fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                {item.name}
              </span>
              <span style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: isFlash ? dirColor : C.text,
                transition: 'color 200ms ease',
                whiteSpace: 'nowrap',
              }}>
                {item.val}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExchangeBadges() {
  return (
    <>
      {['Deribit', 'Binance', 'Coinbase'].map((b, i, arr) => (
        <span key={b} style={{ fontSize: 10, color: C.ghost, fontFamily: 'var(--font-body)' }}>
          {b}{i < arr.length - 1 ? ' ·' : ''}
        </span>
      ))}
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.10)', margin: '0 4px' }}>|</span>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', fontFamily: 'var(--font-body)' }}>
        3 sources · temps réel · v1.1.0
      </span>
    </>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function LandingPage({ onEnter, asset = 'BTC', onAssetChange }) {
  const [data,       setData]       = useState(() => ({ ...ASSET_DATA[asset] }))
  const [flashColor, setFlashColor] = useState(null)
  const netRef = useRef(null)
  const radRef = useRef(null)

  useCanvasNet(netRef)
  useCanvasRad(radRef)

  // Lire les données depuis SmartCache
  const readCache = useCallback(() => {
    const fallback = ASSET_DATA[asset]
    try {
      const spot    = dataStore.get(CacheKey.spot('deribit', asset), true)
      const dvol    = dataStore.get(CacheKey.dvol('deribit', asset), true)
      const funding = dataStore.get(CacheKey.funding('deribit', asset), true)
      const fgRaw   = (() => {
        try { return JSON.parse(localStorage.getItem('veridex_fear_greed_cache') || 'null') }
        catch { return null }
      })()

      const price   = spot?.price ?? fallback.price

      const range  = dvol ? ((dvol.monthMax ?? 0) - (dvol.monthMin ?? 0)) : 0
      const ivNum  = dvol && range > 0
        ? Math.round(((dvol.current - dvol.monthMin) / range) * 100) : null
      const ivVal  = ivNum != null ? String(Math.max(0, Math.min(100, ivNum))) : fallback.ivRank.val
      const ivSub  = ivNum != null
        ? ivNum >= 70 ? 'Élevé' : ivNum >= 40 ? 'Modéré' : 'Faible'
        : fallback.ivRank.sub
      const ivColor = ivNum != null
        ? ivNum >= 70 ? 'accent' : ivNum >= 40 ? 'warning' : 'muted'
        : fallback.ivRank.color

      const fundR   = funding?.rateAnn ?? funding?.avgAnn7d ?? null
      const fundVal = fundR != null
        ? (fundR >= 0 ? '+' : '') + fundR.toFixed(0) + '%'
        : fallback.funding.val

      const fgVal = fgRaw?.value != null ? String(fgRaw.value) : fallback.fearGreed.val
      const fgSub = fgRaw?.value != null
        ? fgRaw.value >= 75 ? 'Extreme Greed'
        : fgRaw.value >= 55 ? 'Greed'
        : fgRaw.value >= 45 ? 'Neutre'
        : fgRaw.value >= 25 ? 'Fear' : 'Extreme Fear'
        : fallback.fearGreed.sub

      setData(prev => ({
        ...fallback,
        price,
        ivRank:    { val: ivVal,  sub: ivSub,  color: ivColor            },
        funding:   { val: fundVal, sub: fallback.funding.sub, color: fallback.funding.color },
        fearGreed: { val: fgVal,  sub: fgSub,  color: fallback.fearGreed.color },
        score:     prev.score,  // conservé jusqu'au useEffect async
      }))
    } catch (_) {
      setData({ ...fallback })
    }
  }, [asset])

  // Score depuis IndexedDB (async)
  useEffect(() => {
    getSignalHistory(asset, 5)
      .then(history => {
        const last = history[history.length - 1]
        if (last?.score != null) {
          setData(prev => ({ ...prev, score: last.score }))
        }
      })
      .catch(() => {})
  }, [asset])

  // Reset + lecture cache au changement d'asset
  useEffect(() => {
    setData({ ...ASSET_DATA[asset] })
    readCache()
  }, [asset, readCache])

  // Simulation prix toutes les 3s
  useEffect(() => {
    const variation = asset === 'BTC' ? 20 : 5
    const timer = setInterval(() => {
      setData(prev => {
        const delta    = (Math.random() - 0.5) * 2 * variation
        const newPrice = Math.max(prev.price + delta, 1)
        const dir      = delta >= 0 ? 'up' : 'down'
        setFlashColor(dir === 'up' ? C.accentLight : C.dangerLight)
        setTimeout(() => setFlashColor(null), 500)
        return { ...prev, price: newPrice, changeDir: dir }
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [asset])

  return (
    <div className="landing-wrap">

      {/* Fond animé */}
      <div className="landing-bg">
        <div className="orb-1" aria-hidden="true" />
        <div className="orb-2" aria-hidden="true" />
        <canvas ref={netRef} className="canvas-net" aria-hidden="true" />
        <canvas ref={radRef} className="canvas-rad" aria-hidden="true" />
        <div className="scan-line" aria-hidden="true" />
      </div>

      {/* Header */}
      <header className="landing-header">
        <VLogo size={26} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LivePill />
          <AssetPill asset={asset} onChange={onAssetChange ?? (() => {})} />
        </div>
      </header>

      {/* Hero */}
      <main className="landing-hero">

        <div style={{ animation: 'fadeUp 0.7s ease both 0.1s', opacity: 0, width: '100%', textAlign: 'center' }}>
          <PriceBlock asset={asset} data={data} flashColor={flashColor} />
        </div>

        <div style={{ animation: 'fadeUp 0.7s ease both 0.3s', opacity: 0 }}>
          <ScoreRing score={data.score} label={data.label} />
        </div>

        <div style={{ animation: 'fadeUp 0.7s ease both 0.5s', opacity: 0, width: '100%' }}>
          <MetricsGrid data={data} />
        </div>

        <div style={{ animation: 'fadeUp 0.7s ease both 0.65s', opacity: 0, width: '100%' }}>
          <button
            onClick={onEnter}
            style={{
              width: '100%', height: 52,
              background: C.accent, color: C.bg,
              border: 'none', borderRadius: 10,
              fontFamily: 'var(--font-display)',
              fontWeight: 700, fontSize: 16,
              cursor: 'pointer',
              letterSpacing: '-0.01em',
              transition: 'opacity 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            Accéder à l'analyse →
          </button>
        </div>

      </main>

      {/* Ticker */}
      <div style={{ animation: 'fadeIn 0.4s ease both 0.8s', opacity: 0 }}>
        <TickerStrip data={data} />
      </div>

      {/* Footer */}
      <footer className="landing-footer">
        <ExchangeBadges />
      </footer>

    </div>
  )
}
