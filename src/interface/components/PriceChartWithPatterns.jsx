/**
 * PriceChartWithPatterns.jsx
 *
 * Graphique de prix (bougies japonaises) avec superposition des patterns
 * détectés, des fenêtres d'annonces macro, et des trades actifs.
 *
 * Lib : TradingView Lightweight Charts v5 (lightweight-charts)
 *
 * Props :
 *   candles      — [{time (s), open, high, low, close, volume}]  trié ASC
 *   auditLog     — [{timestamp (ms), asset, spot, newsWindow, ...}]
 *   econEvents   — [{ts (ms), currency, event, importance}]
 *   asset        — 'BTC' | 'ETH'
 *   height       — hauteur en px (défaut 320)
 *   activeTrades — [{entry, direction, tp?, sl?, timestamp?, id?}] (optionnel)
 *   showTradeLines — afficher TP/SL lines (défaut true)
 */

import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  CrosshairMode,
} from 'lightweight-charts'

// ── Couleurs ──────────────────────────────────────────────────────────────────

const COLORS = {
  bg:         '#0e1117',
  grid:       '#1e2230',
  border:     '#2a2f3d',
  text:       '#8892a4',
  up:         '#26a69a',
  down:       '#ef5350',
  upWick:     '#26a69a',
  downWick:   '#ef5350',
  // Markers patterns
  inWindow:   '#f0476b',   // rouge : détection en fenêtre news
  neutral:    '#4fc3f7',   // cyan  : détection normale
  preWindow:  '#ffb74d',   // orange: proche d'une annonce
  // Éco events
  econHigh:   '#f0476b88',
  econBg:     '#f0476b14',
  // Trades
  tradeLong:  '#00c896',   // vert  : position LONG
  tradeShort: '#f0476b',   // rouge : position SHORT
  tradeTP:    '#00c896',   // vert  : take profit
  tradeSL:    '#f0476b',   // rouge : stop loss
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convertit un timestamp ms en secondes Unix (attendu par LW-charts).
 */
const toSec = (ms) => Math.floor(ms / 1000)

/**
 * Déduit la couleur et la forme d'un marker à partir d'une entrée d'audit.
 */
function markerFromAudit(entry) {
  const nw = entry.newsWindow ?? {}
  const tSec = toSec(entry.timestamp)

  let color    = COLORS.neutral
  let shape    = 'circle'
  let position = 'belowBar'
  let text     = '●'

  if (nw.inWindow) {
    color = COLORS.inWindow
    shape = 'arrowUp'
    text  = `⚡${nw.event?.currency ?? ''}`
  } else if (nw.minutesAway != null && Math.abs(nw.minutesAway) <= 60) {
    color = COLORS.preWindow
    text  = `~${Math.round(Math.abs(nw.minutesAway))}m`
  }

  return { time: tSec, position, color, shape, text, size: 1 }
}

// ── Composant ─────────────────────────────────────────────────────────────────

export default function PriceChartWithPatterns({
  candles      = [],
  auditLog     = [],
  econEvents   = [],
  asset        = 'BTC',
  height       = 320,
  activeTrades = [],
  showTradeLines = true,
}) {
  const containerRef   = useRef(null)
  const chartRef       = useRef(null)
  const seriesRef      = useRef(null)
  const markersRef     = useRef(null)
  const econSeriesRef  = useRef([])
  const tradeSeriesRef = useRef([])
  const tradeMarkersRef = useRef(null)

  // ── Initialisation du chart ──────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { color: COLORS.bg },
        textColor:   COLORS.text,
        fontFamily:  "'Roboto Mono', monospace",
        fontSize:    10,
      },
      grid: {
        vertLines:   { color: COLORS.grid },
        horzLines:   { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine:  { color: COLORS.border, labelBackgroundColor: '#1e2230' },
        horzLine:  { color: COLORS.border, labelBackgroundColor: '#1e2230' },
      },
      rightPriceScale: {
        borderColor:   COLORS.border,
        scaleMargins:  { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:       COLORS.border,
        timeVisible:       true,
        secondsVisible:    false,
        tickMarkFormatter: (time) => {
          const d = new Date(time * 1000)
          const h = d.getUTCHours().toString().padStart(2, '0')
          const m = d.getUTCMinutes().toString().padStart(2, '0')
          const dd = d.getUTCDate().toString().padStart(2, '0')
          const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
          return `${dd}/${mm} ${h}:${m}`
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true },
      width:  containerRef.current.clientWidth,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor:          COLORS.up,
      downColor:        COLORS.down,
      borderUpColor:    COLORS.up,
      borderDownColor:  COLORS.down,
      wickUpColor:      COLORS.upWick,
      wickDownColor:    COLORS.downWick,
    })

    chartRef.current  = chart
    seriesRef.current = series

    // Responsive resize
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      // Supprimer les séries éco avant de remove le chart
      econSeriesRef.current.forEach(s => { try { chart.removeSeries(s) } catch (_) {} })
      econSeriesRef.current = []
      // Supprimer les séries trades (TP/SL lines)
      tradeSeriesRef.current.forEach(s => { try { chart.removeSeries(s) } catch (_) {} })
      tradeSeriesRef.current = []
      markersRef.current = null
      tradeMarkersRef.current = null
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  // ── Mise à jour des bougies ──────────────────────────────────────────────────

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return
    seriesRef.current.setData(candles)
    // Fit au contenu après le premier chargement
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  // ── Markers patterns (audit log) ──────────────────────────────────────────────

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return

    const candleStart = candles[0]?.time ?? 0
    const candleEnd   = candles[candles.length - 1]?.time ?? Infinity

    // Filtrer par asset et par plage temporelle visible
    const markers = auditLog
      .filter(e =>
        (!e.asset || e.asset === asset) &&
        toSec(e.timestamp) >= candleStart &&
        toSec(e.timestamp) <= candleEnd
      )
      .map(markerFromAudit)
      .sort((a, b) => a.time - b.time)

    if (markers.length === 0) {
      if (markersRef.current) {
        markersRef.current.setMarkers([])
      }
      return
    }

    if (markersRef.current) {
      markersRef.current.setMarkers(markers)
    } else {
      markersRef.current = createSeriesMarkers(seriesRef.current, markers)
    }
  }, [auditLog, candles, asset])

  // ── Lignes événements macro ───────────────────────────────────────────────────

  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return

    // Supprimer les anciennes séries éco
    econSeriesRef.current.forEach(s => {
      try { chartRef.current.removeSeries(s) } catch (_) {}
    })
    econSeriesRef.current = []

    const candleStart = candles[0]?.time ?? 0
    const candleEnd   = candles[candles.length - 1]?.time ?? Infinity

    const relevant = econEvents.filter(ev =>
      ev.importance >= 3 &&
      toSec(ev.ts) >= candleStart &&
      toSec(ev.ts) <= candleEnd
    )

    // Une ligne verticale par événement = série line avec 2 points (min, max)
    // Lightweight-charts v5 n'a pas de primitives verticales natives →
    // on utilise une ligne courte à prix courant (overlay symbolique)
    relevant.forEach(ev => {
      try {
        const tSec = toSec(ev.ts)
        const lineSeries = chartRef.current.addSeries(LineSeries, {
          color:       COLORS.econHigh,
          lineWidth:   1,
          lineStyle:   2,   // dashed
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        // 2 points autour du timestamp avec prix arbitraire (invisible sans données)
        lineSeries.setData([
          { time: tSec - 1, value: 0 },
          { time: tSec,     value: 0 },
          { time: tSec + 1, value: 0 },
        ])
        // Ajouter un marker texte au-dessus
        const m = createSeriesMarkers(lineSeries, [{
          time:     tSec,
          position: 'aboveBar',
          color:    COLORS.econHigh,
          shape:    'square',
          text:     `${ev.currency} ${ev.event?.slice(0, 12) ?? ''}`,
          size:     0,
        }])
        econSeriesRef.current.push(lineSeries)
      } catch (_) {}
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [econEvents, candles])

  // ── Trades actifs (entry markers + TP/SL lines) ────────────────────────────────

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || candles.length === 0 || activeTrades.length === 0) {
      // Nettoyer les séries trades si aucun trade actif
      tradeSeriesRef.current.forEach(s => {
        try { chartRef.current?.removeSeries(s) } catch (_) {}
      })
      tradeSeriesRef.current = []
      if (tradeMarkersRef.current) {
        tradeMarkersRef.current.setMarkers([])
      }
      return
    }

    const candleStart = candles[0]?.time ?? 0
    const candleEnd   = candles[candles.length - 1]?.time ?? Infinity

    // 1. Créer les markers d'entrée
    const entryMarkers = activeTrades.map((trade, idx) => {
      const color = trade.direction === 'LONG' ? COLORS.tradeLong : COLORS.tradeShort
      const shape = trade.direction === 'LONG' ? 'arrowUp' : 'arrowDown'
      const time = trade.timestamp ? toSec(trade.timestamp) : candleEnd
      return {
        time,
        position: 'belowBar',
        color,
        shape,
        text: 'E',
        size: 1.2,
      }
    })

    // Ajouter ou mettre à jour les markers
    if (tradeMarkersRef.current) {
      tradeMarkersRef.current.setMarkers(entryMarkers)
    } else {
      tradeMarkersRef.current = createSeriesMarkers(seriesRef.current, entryMarkers)
    }

    // 2. Créer les lignes TP/SL
    tradeSeriesRef.current.forEach(s => {
      try { chartRef.current.removeSeries(s) } catch (_) {}
    })
    tradeSeriesRef.current = []

    if (showTradeLines) {
      activeTrades.forEach((trade, idx) => {
        // Ligne TP
        if (trade.tp != null && Number.isFinite(trade.tp)) {
          try {
            const tpSeries = chartRef.current.addSeries(LineSeries, {
              color: COLORS.tradeTP,
              lineWidth: 1,
              lineStyle: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            })
            tpSeries.setData([
              { time: candleStart, value: trade.tp },
              { time: candleEnd, value: trade.tp },
            ])
            tradeSeriesRef.current.push(tpSeries)
          } catch (_) {}
        }

        // Ligne SL
        if (trade.sl != null && Number.isFinite(trade.sl)) {
          try {
            const slSeries = chartRef.current.addSeries(LineSeries, {
              color: COLORS.tradeSL,
              lineWidth: 1,
              lineStyle: 3,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            })
            slSeries.setData([
              { time: candleStart, value: trade.sl },
              { time: candleEnd, value: trade.sl },
            ])
            tradeSeriesRef.current.push(slSeries)
          } catch (_) {}
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrades, candles, showTradeLines])

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* Légende */}
      <div style={{
        position: 'absolute', bottom: 6, left: 8,
        display: 'flex', gap: 10, alignItems: 'center',
        fontFamily: 'var(--font-mono, monospace)', fontSize: 9,
        color: 'var(--text-ghost, #4a5260)',
        pointerEvents: 'none',
        flexWrap: 'wrap',
      }}>
        <span style={{ color: COLORS.neutral }}>● Pattern</span>
        <span style={{ color: COLORS.inWindow }}>⚡ News window</span>
        <span style={{ color: COLORS.preWindow }}>◆ &lt;60min</span>
        <span style={{ color: COLORS.econHigh }}>— Macro event</span>
        {activeTrades.length > 0 && (
          <>
            <span style={{ color: COLORS.tradeLong }}>▲ Entry LONG</span>
            <span style={{ color: COLORS.tradeShort }}>▼ Entry SHORT</span>
          </>
        )}
      </div>
    </div>
  )
}
