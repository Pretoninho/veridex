/**
 * data_processing/signals/notification_engine.js
 *
 * Moteur de détection des événements déclencheurs de notifications.
 * Appelé à chaque cycle de polling depuis App.jsx.
 *
 * Types surveillés (N1–N8) :
 *   N1 — Mouvement de prix ±5% en 1h               (CRITICAL)
 *   N2 — Anomalie critique (5+ indicateurs)         (CRITICAL)
 *   N3 — Liquidations massives > $50M/1h            (CRITICAL)
 *   N4 — IV Rank spike (< 50 → > 70 en < 4h)       (ALERT)
 *   N5 — Variation Funding > 20%/an en 15min        (ALERT)
 *   N6 — Settlement quotidien Deribit               (ALERT/INFO)
 *   N7 — Changement de catégorie de signal          (ALERT)
 *   N8 — Expiration imminente 24h/1h                (INFO/ALERT)
 *   N8b — Funding fixing dans 30min                 (INFO)
 */

import { sendNotification, getThresholds } from './notification_manager.js'
import { getSettlementHistory }            from './settlement_tracker.js'
import { TIMING }                          from '../config/signal_calibration.js'

// ── État interne ──────────────────────────────────────────────────────────────
// Persisté en mémoire — réinitialisé au rechargement de l'app.

const _state = {
  priceHistory:   { BTC: [], ETH: [] },
  fundingHistory: { BTC: [], ETH: [] },
  lastIVRank:     { BTC: null, ETH: null },
  ivSpikeStart:   { BTC: null, ETH: null },
  lastSignalCat:  { BTC: null, ETH: null },
  lastScore:      { BTC: null, ETH: null },
  expiryNotified: new Set(),
  fixingNotified: new Set(),
}

// ── Point d'entrée principal ──────────────────────────────────────────────────

/**
 * Vérifie toutes les conditions de notification pour un asset.
 * À appeler à chaque cycle de polling.
 *
 * @param {string} asset — 'BTC' ou 'ETH'
 * @param {{
 *   spotPrice?:       number|null,
 *   ivRank?:          number|null,
 *   fundingAnn?:      number|null,
 *   signal?:          object|null,
 *   score?:           number|null,
 *   instruments?:     object[],
 * }} data
 */
export async function checkNotifications(asset, data) {
  const t = getThresholds()

  await Promise.allSettled([
    _checkPriceMove(asset, data.spotPrice, t),
    _checkIVSpike(asset, data.ivRank, t),
    _checkFundingChange(asset, data.fundingAnn, t),
    _checkSignalChange(asset, data.signal, data.score, t),
    _checkExpiry(asset, data.instruments, t),
    _checkFundingFixing(t),
    _checkSettlement(asset, t),
  ])
}

// ── N2 — Anomalie (export public — appelé par App.jsx) ────────────────────────

/**
 * Notifie une anomalie de marché détectée par signal_engine.js.
 * @param {string} asset
 * @param {{ anomaly: boolean, changedIndicators: string[] }} anomalyResult
 */
export async function notifyAnomaly(asset, anomalyResult) {
  if (!anomalyResult?.anomaly) return

  const count = anomalyResult.changedIndicators?.length ?? 0
  const level = count >= 5 ? 'critical' : 'alert'

  await sendNotification({
    type:  'anomaly',
    asset,
    level,
    title: `◈ Anomalie ${level === 'critical' ? 'critique' : 'détectée'} · ${asset}`,
    body:
      `${count} indicateurs simultanés : ` +
      (anomalyResult.changedIndicators?.slice(0, 3).join(', ') ?? '') +
      (count > 3 ? ` +${count - 3}` : ''),
    tag:  `anomaly_${asset}`,
    data: { page: 'signals', asset },
  })
}

// ── N1 — Mouvement de prix ────────────────────────────────────────────────────

async function _checkPriceMove(asset, price, t) {
  if (price == null) return

  const history = _state.priceHistory[asset]
  const now     = Date.now()

  history.push({ price, ts: now })

  // Garder uniquement la fenêtre configurée (1h par défaut)
  _state.priceHistory[asset] = history.filter(
    h => now - h.ts <= t.price_move_window_ms
  )

  const oldest = _state.priceHistory[asset][0]
  if (!oldest) return

  const changePct = ((price - oldest.price) / oldest.price) * 100

  if (Math.abs(changePct) >= t.price_move_pct) {
    const direction = changePct > 0 ? '↑' : '↓'
    const sign      = changePct > 0 ? '+' : ''

    await sendNotification({
      type:  'price_move',
      asset,
      level: 'critical',
      title: `◈ ${asset} ${direction} ${sign}${changePct.toFixed(1)}% en 1h`,
      body:
        `Prix actuel : $${price.toLocaleString('en-US')} · ` +
        `Il y a 1h : $${oldest.price.toLocaleString('en-US')}`,
      tag:  `price_move_${asset}`,
      data: { page: 'market', asset },
    })
  }
}

// ── N4 — IV Rank spike ────────────────────────────────────────────────────────

async function _checkIVSpike(asset, ivRank, t) {
  if (ivRank == null) return

  const now    = Date.now()
  const wasLow = (_state.lastIVRank[asset] ?? 0) < t.iv_spike_low

  // Démarrer le chrono si on était sous iv_spike_low
  if (wasLow && _state.ivSpikeStart[asset] == null) {
    _state.ivSpikeStart[asset] = now
  }

  const nowHigh = ivRank >= t.iv_spike_high

  if (nowHigh && _state.ivSpikeStart[asset] != null) {
    const elapsed = now - _state.ivSpikeStart[asset]

    if (elapsed <= t.iv_spike_window_ms) {
      const prevIV = _state.lastIVRank[asset]?.toFixed(0) ?? '—'
      await sendNotification({
        type:  'iv_spike',
        asset,
        level: 'alert',
        title: `◈ IV Rank spike · ${asset}`,
        body:
          `IV Rank : ${prevIV} → ${ivRank.toFixed(0)} ` +
          `en ${Math.round(elapsed / 3_600_000)}h`,
        tag:  `iv_spike_${asset}`,
        data: { page: 'options', asset },
      })
    }
    _state.ivSpikeStart[asset] = null
  }

  // Reset le chrono si on repasse sous le seuil bas
  if (ivRank < t.iv_spike_low) {
    _state.ivSpikeStart[asset] = now
  }

  _state.lastIVRank[asset] = ivRank
}

// ── N5 — Variation Funding ────────────────────────────────────────────────────

async function _checkFundingChange(asset, fundingAnn, t) {
  if (fundingAnn == null) return

  const history = _state.fundingHistory[asset]
  const now     = Date.now()

  history.push({ funding: fundingAnn, ts: now })

  _state.fundingHistory[asset] = history.filter(
    h => now - h.ts <= t.funding_change_window_ms
  )

  const oldest = _state.fundingHistory[asset][0]
  if (!oldest) return

  const change = Math.abs(fundingAnn - oldest.funding)

  if (change >= t.funding_change_ann) {
    const direction = fundingAnn > oldest.funding ? '↑' : '↓'
    const sign      = fundingAnn > 0 ? '+' : ''

    await sendNotification({
      type:  'funding_change',
      asset,
      level: 'alert',
      title: `◈ Funding ${direction} · ${asset}`,
      body:
        `${sign}${fundingAnn.toFixed(1)}%/an ` +
        `(variation +${change.toFixed(1)}% en 15min)`,
      tag:  `funding_${asset}`,
      data: { page: 'derivatives', asset },
    })
  }
}

// ── N6 — Settlement Deribit ───────────────────────────────────────────────────

async function _checkSettlement(asset, t) {
  try {
    const history = await getSettlementHistory(asset, 1)
    const latest  = history[0]
    if (!latest) return

    const todayKey = new Date().toISOString().slice(0, 10)
    const notifKey = `settlement_${asset}_${todayKey}`

    if (_state.expiryNotified.has(notifKey)) return
    if (!latest.dateKey || latest.dateKey !== todayKey) return

    // Détecter la priorité d'échéance
    const settlDate  = new Date(latest.settlementTimestamp ?? latest.capturedAt)
    const dayOfWeek  = settlDate.getUTCDay()     // 5 = vendredi
    const dayOfMonth = settlDate.getUTCDate()
    const month      = settlDate.getUTCMonth() + 1

    const sm = TIMING.settlementMarkers
    const isWeekly     = dayOfWeek === sm.weeklyDay
    const isMonthly    = isWeekly && dayOfMonth >= sm.monthlyDayMin
    const isQuarterly  = isMonthly && sm.quarterlyMonths.includes(month)

    let level    = 'info'
    let priority = 'Quotidien'

    if (isQuarterly) {
      level    = 'info'
      priority = 'Trimestriel'
    } else if (isMonthly) {
      level    = 'alert'
      priority = 'Mensuel'
    } else if (isWeekly) {
      level    = 'alert'
      priority = 'Hebdomadaire'
    }

    const deltaStr = latest.spotDeltaLabel ?? 'N/A'
    const absDelta = Math.abs(latest.spotDeltaPct ?? 0)

    // Upgrade si écart anormal vs spot
    if (absDelta > t.settlement_delta_pct) {
      level = level === 'info' ? 'alert' : 'critical'
    }

    await sendNotification({
      type:  'settlement',
      asset,
      level,
      title: `◈ Settlement ${priority} · ${asset}`,
      body:  `$${latest.settlementPrice.toLocaleString('en-US')} · ${deltaStr} vs spot`,
      tag:   `settlement_${asset}`,
      data:  { page: 'options', asset, dateKey: latest.dateKey },
    })

    _state.expiryNotified.add(notifKey)
  } catch (_) {}
}

// ── N7 — Changement de catégorie de signal ────────────────────────────────────

async function _checkSignalChange(asset, signal, score, t) {
  const category = signal?.label ?? null
  if (!category) return

  const prev = _state.lastSignalCat[asset]

  if (prev && prev !== category) {
    await sendNotification({
      type:  'signal_change',
      asset,
      level: 'alert',
      title: `◈ Signal ${asset} : ${category}`,
      body:  `${prev} → ${category} · Score ${score ?? '—'}/100`,
      tag:   `signal_${asset}`,
      data:  { page: 'signals', asset },
    })
  }

  _state.lastSignalCat[asset] = category
  _state.lastScore[asset]     = score
}

// ── N8a — Expiration imminente ────────────────────────────────────────────────

async function _checkExpiry(asset, instruments, t) {
  if (!instruments?.length) return

  const now = Date.now()

  const MONTHS = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  }

  const parsed = instruments
    .map(i => {
      const parts  = (i.name ?? i.instrument_name ?? '').split('-')
      const expStr = parts[1]
      if (!expStr || expStr.length < 7) return null
      const day = parseInt(expStr.slice(0, 2), 10)
      const mon = MONTHS[expStr.slice(2, 5)]
      const yr  = 2000 + parseInt(expStr.slice(5, 7), 10)
      if (isNaN(day) || mon == null || isNaN(yr)) return null
      const ts = Date.UTC(yr, mon, day, 8, 0, 0)
      return { expStr, ts }
    })
    .filter(Boolean)
    .filter(e => e.ts > now)
    .sort((a, b) => a.ts - b.ts)

  if (!parsed.length) return

  const next      = parsed[0]
  const remaining = next.ts - now

  // Alerte 1h
  const key1h = `expiry_1h_${asset}_${next.expStr}`
  if (remaining <= t.expiry_warning_1h && !_state.expiryNotified.has(key1h)) {
    await sendNotification({
      type:  'expiry_soon',
      asset,
      level: 'alert',
      title: `◈ Expiration dans 1h · ${asset}`,
      body:  `Échéance ${next.expStr} · ${Math.round(remaining / 60_000)}min restantes`,
      tag:   `expiry_1h_${asset}`,
      data:  { page: 'options', asset },
    })
    _state.expiryNotified.add(key1h)
    return
  }

  // Info 24h
  const key24h = `expiry_24h_${asset}_${next.expStr}`
  if (
    remaining <= t.expiry_warning_24h &&
    remaining > t.expiry_warning_1h &&
    !_state.expiryNotified.has(key24h)
  ) {
    await sendNotification({
      type:  'expiry_tomorrow',
      asset,
      level: 'info',
      title: `◈ Expiration demain · ${asset}`,
      body:  `Échéance ${next.expStr} dans ${Math.round(remaining / 3_600_000)}h`,
      tag:   `expiry_24h_${asset}`,
      data:  { page: 'options', asset },
    })
    _state.expiryNotified.add(key24h)
  }
}

// ── N8b — Funding fixing imminent ─────────────────────────────────────────────

async function _checkFundingFixing(t) {
  const now      = new Date()
  const utcH     = now.getUTCHours()
  const utcM     = now.getUTCMinutes()
  const totalMin = utcH * 60 + utcM

  const warningMin = t.funding_fixing_warning / 60_000

  for (const fixingTime of TIMING.FUNDING_FIXING_TIMES) {
    const fixing = fixingTime.hour * 60 + fixingTime.minute
    const diff = fixing - totalMin

    if (diff > 0 && diff <= warningMin) {
      const fixingHour = String(fixingTime.hour).padStart(2, '0')
      const key = `fixing_${fixing}_${now.toISOString().slice(0, 10)}`

      if (!_state.fixingNotified.has(key)) {
        await sendNotification({
          type:  'funding_fixing',
          asset: 'ALL',
          level: 'info',
          title: `◈ Funding fixing dans ${diff}min`,
          body:  `Prochain fixing Deribit à ${fixingHour}:00 UTC`,
          tag:   'funding_fixing',
          data:  { page: 'derivatives' },
        })
        _state.fixingNotified.add(key)
      }
    }
  }
}
