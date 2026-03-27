/**
 * backend/data_core/providers/onchain.js
 *
 * Données on-chain — adapté de src/data/providers/onchain.js.
 * localStorage remplacé par un cache in-memory (Map avec TTL).
 * import.meta.env remplacé par process.env.
 *
 * Sources :
 *   1. Blockchain.info  — statistiques réseau BTC
 *   2. Mempool.space    — mempool + fees recommandés
 *   3. CryptoQuant      — exchange netflow BTC/ETH (clé API optionnelle)
 *   4. Alternative.me   — Fear & Greed Index
 *   5. Mempool.space    — Hash Rate historique
 *   6. Mempool.space    — Whale Transactions
 */

'use strict'

const TIMEOUT_MS = 5_000

// ── Cache in-memory (TTL) — remplace localStorage ────────────────────────────

const _memCache = new Map()

function _cacheGet(key) {
  const entry = _memCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _memCache.delete(key)
    return null
  }
  return entry.data
}

function _cacheSet(key, data, ttlMs) {
  _memCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── Source 1 : Blockchain.info ────────────────────────────────────────────────

async function getBlockchainStats() {
  try {
    const data = await fetchWithTimeout('https://blockchain.info/stats?format=json')
    return {
      n_tx:           data.n_tx           ?? null,
      total_fees_btc: data.total_fees_btc ?? null,
      mempool_size:   data.mempool_size   ?? null,
      hash_rate:      data.hash_rate      ?? null,
      difficulty:     data.difficulty     ?? null,
      timestamp:      Date.now(),
    }
  } catch {
    return null
  }
}

// ── Source 2 : Mempool.space ──────────────────────────────────────────────────

async function getMempoolData() {
  try {
    const [mempool, fees] = await Promise.allSettled([
      fetchWithTimeout('https://mempool.space/api/mempool'),
      fetchWithTimeout('https://mempool.space/api/v1/fees/recommended'),
    ])

    const m = mempool.status === 'fulfilled' ? mempool.value : {}
    const f = fees.status    === 'fulfilled' ? fees.value    : {}

    return {
      count:       m.count       ?? null,
      vsize:       m.vsize       ?? null,
      total_fee:   m.total_fee   ?? null,
      fastestFee:  f.fastestFee  ?? null,
      halfHourFee: f.halfHourFee ?? null,
      hourFee:     f.hourFee     ?? null,
      minimumFee:  f.minimumFee  ?? null,
      timestamp:   Date.now(),
    }
  } catch {
    return null
  }
}

// ── Source 3 : CryptoQuant — Exchange Flows (optionnel) ──────────────────────

async function getExchangeFlows(asset = 'BTC') {
  const apiKey = process.env.CRYPTOQUANT_API_KEY
  if (!apiKey || apiKey.trim() === '') {
    return null
  }

  const currency = asset.toLowerCase()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const url =
      `https://api.cryptoquant.com/v1/` +
      `${currency}/exchange-flows/netflow` +
      `?window=hour&limit=24`
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
    })
    clearTimeout(timeout)

    if (res.status === 401) {
      console.error('[onchain] getExchangeFlows: clé API invalide — vérifier CRYPTOQUANT_API_KEY')
      return null
    }
    if (res.status === 429) {
      console.warn('[onchain] getExchangeFlows: rate limit atteint')
      return null
    }
    if (!res.ok) {
      console.warn(`[onchain] getExchangeFlows: HTTP ${res.status}`)
      return null
    }

    const json = await res.json()
    const data = json?.result?.data ?? []
    if (!data.length) return null

    const sorted = [...data].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    )
    const latest    = sorted[0]
    const netflow   = latest?.netflow_total ?? 0

    const netflow24h = sorted
      .slice(0, 24)
      .reduce((s, d) => s + (d.netflow_total ?? 0), 0)

    const threshold = asset.toUpperCase() === 'BTC' ? 1000 : 10000
    let signal = 'neutral'
    if (netflow24h < -threshold) signal = 'bullish'
    if (netflow24h >  threshold) signal = 'bearish'

    return {
      asset:     asset.toUpperCase(),
      netflow,
      netflow24h,
      direction: netflow < 0 ? 'outflow' : 'inflow',
      signal,
      label: netflow < 0
        ? `Outflow ${Math.abs(netflow).toFixed(0)} ${asset.toUpperCase()}`
        : `Inflow ${netflow.toFixed(0)} ${asset.toUpperCase()}`,
      history: sorted.slice(0, 24).map(d => ({
        date:    d.date,
        netflow: d.netflow_total ?? 0,
      })),
      source:    'cryptoquant',
      fetchedAt: Date.now(),
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[onchain] getExchangeFlows(${asset}) error:`, err.message)
    }
    return null
  }
}

// ── Source 5 : Mempool.space — Hash Rate historique ───────────────────────────

const HR_CACHE_KEY    = 'hashrate_history'
const HR_CACHE_TTL_MS = 5 * 60 * 1000  // 5 min

async function getHashRateHistory() {
  const cached = _cacheGet(HR_CACHE_KEY)
  if (cached) return cached

  try {
    const data = await fetchWithTimeout(
      'https://mempool.space/api/v1/mining/hashrate/1m',
      8_000,
    )

    const hashrates = (data.hashrates ?? []).map(h => ({
      timestamp:    h.timestamp * 1000,
      hashrate_ehs: h.avgHashrate / 1e18,
    }))
    const difficulties = (data.difficulty ?? []).map(d => ({
      timestamp:  d.timestamp * 1000,
      difficulty: d.difficulty,
    }))

    const result = {
      hashrates,
      difficulties,
      currentHashrate:   (data.currentHashrate ?? 0) / 1e18,
      currentDifficulty: data.currentDifficulty ?? 0,
      timestamp: Date.now(),
    }

    _cacheSet(HR_CACHE_KEY, result, HR_CACHE_TTL_MS)
    return result
  } catch {
    return null
  }
}

// ── Source 4 : Fear & Greed Index (alternative.me) ────────────────────────────

const FG_CACHE_KEY    = 'fear_greed'
const FG_CACHE_TTL_MS = 60 * 60 * 1000  // 1 heure

async function getFearGreedIndex() {
  const cached = _cacheGet(FG_CACHE_KEY)
  if (cached) return cached

  try {
    const data = await fetchWithTimeout(
      'https://api.alternative.me/fng/?limit=2&format=json',
      5_000,
    )
    const today     = data?.data?.[0]
    const yesterday = data?.data?.[1]
    if (!today) return null

    const value     = parseInt(today.value, 10)
    const valuePrev = yesterday ? parseInt(yesterday.value, 10) : null
    const delta     = valuePrev != null ? value - valuePrev : null

    const result = {
      value,
      label:           today.value_classification,
      delta,
      deltaLabel:      delta != null ? `${delta > 0 ? '+' : ''}${delta} pts` : null,
      timestamp:       parseInt(today.timestamp, 10) * 1000,
      timeUntilUpdate: today.time_until_update,
      source:          'alternative.me',
    }

    _cacheSet(FG_CACHE_KEY, result, FG_CACHE_TTL_MS)
    return result
  } catch {
    return null
  }
}

// ── Source 6 : Mempool.space — Whale Transactions ─────────────────────────────

function _detectDirection(tx) {
  const outputCount = (tx.vout ?? []).length
  if (outputCount === 1) return 'consolidation'
  if (outputCount === 2) return 'transfer'
  if (outputCount > 10)  return 'distribution'
  return 'unknown'
}

function _interpretWhaleDirection(direction, btc) {
  const size = btc >= 1000 ? 'massive' : btc >= 500 ? 'large' : 'significant'

  const signals = {
    consolidation: {
      label:  'Consolidation',
      bias:   'neutral',
      expert: `${size} consolidation ${btc.toFixed(0)} BTC — wallet management ou cold storage`,
    },
    distribution: {
      label:  'Distribution',
      bias:   'bearish',
      expert: `${size} distribution ${btc.toFixed(0)} BTC — fragmentation suspecte, possible préparation vente OTC`,
    },
    transfer: {
      label:  'Transfert',
      bias:   'neutral',
      expert: `Transfert ${btc.toFixed(0)} BTC — direction indéterminée`,
    },
    unknown: {
      label:  'Inconnu',
      bias:   'neutral',
      expert: `Transaction ${btc.toFixed(0)} BTC — pattern non identifié`,
    },
  }

  return signals[direction] ?? signals.unknown
}

async function getWhaleTransactions(minBTC = 100) {
  try {
    const txs = await fetchWithTimeout(
      'https://mempool.space/api/mempool/recent',
      8_000,
    )
    if (!Array.isArray(txs)) return null

    const minSats  = minBTC * 1e8
    const whaleTxs = txs.filter(tx => {
      const totalOut = (tx.vout ?? []).reduce((s, o) => s + (o.value ?? 0), 0)
      return totalOut >= minSats
    })

    const enriched = whaleTxs.slice(0, 20).map(tx => {
      const totalOut    = (tx.vout ?? []).reduce((s, o) => s + (o.value ?? 0), 0)
      const totalOutBTC = totalOut / 1e8
      const direction   = _detectDirection(tx)

      return {
        txid:      tx.txid,
        totalBTC:  totalOutBTC,
        totalUSD:  null,
        fee:       tx.fee ?? 0,
        feeSats:   tx.fee ?? 0,
        size:      tx.size ?? 0,
        outputs:   tx.vout?.length ?? 0,
        direction,
        signal:    _interpretWhaleDirection(direction, totalOutBTC),
        timestamp: Date.now(),
      }
    })

    enriched.sort((a, b) => b.totalBTC - a.totalBTC)

    return {
      transactions: enriched,
      count:        enriched.length,
      totalBTC:     enriched.reduce((s, t) => s + t.totalBTC, 0),
      timestamp:    Date.now(),
    }
  } catch {
    return null
  }
}

// ── Snapshot combiné ──────────────────────────────────────────────────────────

async function getOnChainSnapshot(asset = 'BTC') {
  const [blockchain, mempool] = await Promise.allSettled([
    getBlockchainStats(),
    getMempoolData(),
  ])

  return {
    blockchain: blockchain.status === 'fulfilled' ? blockchain.value : null,
    mempool:    mempool.status    === 'fulfilled' ? mempool.value    : null,
  }
}

module.exports = {
  getBlockchainStats,
  getMempoolData,
  getExchangeFlows,
  getHashRateHistory,
  getFearGreedIndex,
  getWhaleTransactions,
  getOnChainSnapshot,
}
