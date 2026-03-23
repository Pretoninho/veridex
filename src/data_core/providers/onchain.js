/**
 * providers/onchain.js — Données on-chain Bitcoin/Ethereum
 *
 * Sources publiques gratuites, sans clé API :
 *   1. Blockchain.info  — statistiques réseau BTC
 *   2. Mempool.space    — mempool + fees recommandés
 *   3. Glassnode public — exchange flows (net)
 *   4. CryptoQuant      — netflow BTC exchanges
 *
 * Chaque fonction retourne null en cas d'erreur.
 * Promise.allSettled est utilisé pour que les autres sources continuent
 * même si l'une est hors ligne.
 */

const TIMEOUT_MS = 5_000

/**
 * Fetch avec timeout.
 * @param {string} url
 * @param {number} [ms]
 */
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

/**
 * Statistiques réseau Bitcoin depuis blockchain.info.
 * @returns {Promise<{
 *   n_tx: number,
 *   total_fees_btc: number,
 *   mempool_size: number,
 *   hash_rate: number,
 *   difficulty: number,
 *   timestamp: number
 * }|null>}
 */
export async function getBlockchainStats() {
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

/**
 * État du mempool Bitcoin depuis mempool.space.
 * @returns {Promise<{
 *   count: number,
 *   vsize: number,
 *   total_fee: number,
 *   fastestFee: number,
 *   halfHourFee: number,
 *   hourFee: number,
 *   minimumFee: number,
 *   timestamp: number
 * }|null>}
 */
export async function getMempoolData() {
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

// ── Source 3 : Glassnode public ───────────────────────────────────────────────

/**
 * Exchange net flow depuis Glassnode (endpoint public limité).
 * @param {'BTC'|'ETH'} [asset]
 * @returns {Promise<{ netflow: number|null, asset: string, timestamp: number }|null>}
 */
export async function getGlassnodeExchangeFlow(asset = 'BTC') {
  try {
    const url = `https://api.glassnode.com/v1/metrics/transactions/transfers_volume_exchanges_net?a=${asset}&api_key=anonymous`
    const data = await fetchWithTimeout(url)

    // Glassnode retourne un array [{t, v}], on prend la dernière valeur
    const latest = Array.isArray(data) ? data[data.length - 1] : null
    return {
      netflow:   latest?.v   ?? null,
      asset:     asset.toUpperCase(),
      timestamp: latest?.t ? latest.t * 1000 : Date.now(),
    }
  } catch {
    return null
  }
}

// ── Source 4 : CryptoQuant public ────────────────────────────────────────────

/**
 * Exchange netflow BTC depuis CryptoQuant.
 * @returns {Promise<{
 *   inflow: number|null,
 *   outflow: number|null,
 *   netflow: number|null,
 *   timestamp: number
 * }|null>}
 */
export async function getCryptoQuantFlow() {
  try {
    const url = 'https://api.cryptoquant.com/v1/btc/exchange-flows/netflow?window=day&limit=1'
    const data = await fetchWithTimeout(url)

    // CryptoQuant : { data: { result: [{ inflow_total, outflow_total, netflow_total, ... }] } }
    const row = data?.data?.result?.[0]
    return {
      inflow:    row?.inflow_total  ?? null,
      outflow:   row?.outflow_total ?? null,
      netflow:   row?.netflow_total ?? null,
      timestamp: Date.now(),
    }
  } catch {
    return null
  }
}

// ── Source 5 : Mempool.space — Hash Rate historique ───────────────────────────

const HR_CACHE_KEY    = 'veridex_hashrate_history'
const HR_CACHE_TTL_MS = 5 * 60 * 1000      // 5 min

/**
 * Historique du hash rate Bitcoin sur 1 mois depuis mempool.space.
 * Résultat mis en cache localStorage (TTL 5 min).
 * @returns {Promise<{
 *   hashrates: Array<{ timestamp: number, hashrate_ehs: number }>,
 *   difficulties: Array<{ timestamp: number, difficulty: number }>,
 *   currentHashrate: number,
 *   currentDifficulty: number,
 *   timestamp: number
 * }|null>}
 */
export async function getHashRateHistory() {
  try {
    const cached = JSON.parse(localStorage.getItem(HR_CACHE_KEY) || 'null')
    if (cached && Date.now() - cached.ts < HR_CACHE_TTL_MS) return cached.data
  } catch (_) {}

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

    try { localStorage.setItem(HR_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: result })) } catch (_) {}
    return result
  } catch (_) { return null }
}

// ── Source 6 : Fear & Greed Index (alternative.me) ────────────────────────────

const FG_CACHE_KEY    = 'veridex_fear_greed'
const FG_CACHE_TTL_MS = 60 * 60 * 1000     // 1 heure (màj quotidienne)

/**
 * Fear & Greed Index depuis alternative.me (2 derniers jours).
 * Résultat mis en cache localStorage (TTL 1 h).
 * @returns {Promise<{
 *   value: number,
 *   label: string,
 *   delta: number|null,
 *   deltaLabel: string|null,
 *   timestamp: number,
 *   timeUntilUpdate: string,
 *   source: string
 * }|null>}
 */
export async function getFearGreedIndex() {
  try {
    const cached = JSON.parse(localStorage.getItem(FG_CACHE_KEY) || 'null')
    if (cached && Date.now() - cached.ts < FG_CACHE_TTL_MS) return cached.data
  } catch (_) {}

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
      label:          today.value_classification,
      delta,
      deltaLabel:     delta != null ? `${delta > 0 ? '+' : ''}${delta} pts` : null,
      timestamp:      parseInt(today.timestamp, 10) * 1000,
      timeUntilUpdate: today.time_until_update,
      source:         'alternative.me',
    }

    try { localStorage.setItem(FG_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: result })) } catch (_) {}
    return result
  } catch (_) { return null }
}

// ── Source 7 : Mempool.space — Whale Transactions ─────────────────────────────

/**
 * Détecte la direction probable d'une transaction à partir du nombre d'outputs.
 * @param {Object} tx
 * @returns {'consolidation'|'transfer'|'distribution'|'unknown'}
 */
function _detectDirection(tx) {
  const outputCount = (tx.vout ?? []).length
  if (outputCount === 1)  return 'consolidation'
  if (outputCount === 2)  return 'transfer'
  if (outputCount > 10)   return 'distribution'
  return 'unknown'
}

/**
 * Interprète la direction d'une transaction whale.
 * @param {'consolidation'|'transfer'|'distribution'|'unknown'} direction
 * @param {number} btc
 */
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

/**
 * Transactions Bitcoin > minBTC en attente dans le mempool.
 * @param {number} [minBTC=100]
 * @returns {Promise<{
 *   transactions: Array,
 *   count: number,
 *   totalBTC: number,
 *   timestamp: number
 * }|null>}
 */
export async function getWhaleTransactions(minBTC = 100) {
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
        totalUSD:  null,    // enrichi côté UI avec le spot
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
  } catch (_) { return null }
}

// ── Snapshot combiné ──────────────────────────────────────────────────────────

/**
 * Récupère toutes les données on-chain en parallèle.
 * Une source hors ligne ne bloque pas les autres.
 * @param {'BTC'|'ETH'} [asset]
 * @returns {Promise<{ blockchain, mempool, glassnodeFlow, cryptoQuantFlow }>}
 */
export async function getOnChainSnapshot(asset = 'BTC') {
  const [blockchain, mempool, glassnodeFlow, cryptoQuantFlow] = await Promise.allSettled([
    getBlockchainStats(),
    getMempoolData(),
    getGlassnodeExchangeFlow(asset),
    getCryptoQuantFlow(),
  ])

  return {
    blockchain:     blockchain.status     === 'fulfilled' ? blockchain.value     : null,
    mempool:        mempool.status        === 'fulfilled' ? mempool.value        : null,
    glassnodeFlow:  glassnodeFlow.status  === 'fulfilled' ? glassnodeFlow.value  : null,
    cryptoQuantFlow: cryptoQuantFlow.status === 'fulfilled' ? cryptoQuantFlow.value : null,
  }
}
