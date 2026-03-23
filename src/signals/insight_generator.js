/**
 * insight_generator.js
 *
 * Génère des commentaires d'analyse courts (1 phrase) via Claude API.
 * Destiné aux traders expérimentés — pas de vulgarisation.
 *
 * Usage : await generateInsight({ metric: 'iv_rank', value: 82, context: { asset: 'BTC' } })
 * Returns : { text: string, bias: 'bullish' | 'bearish' | 'neutral' }
 *
 * Cache 5 min en mémoire. Fallback statique si API indisponible.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-haiku-4-5-20251001'
const CACHE_TTL_MS  = 5 * 60 * 1000
const MAX_TOKENS    = 60

const _cache = new Map()

// ── Prompts par métrique ──────────────────────────────────────────────────────

function _prompt(metric, value, ctx = {}) {
  const base = `Tu es un analyste crypto senior. Réponds en français en UNE seule phrase (15–25 mots maximum). Ton: direct, technique, sans fioriture. Pas de majuscule initiale, pas de point final. Pas d'introduction.`

  switch (metric) {
    case 'iv_rank':
      return `${base}\n\nIV Rank ${ctx.asset ?? 'BTC'} = ${value}%. Signal pour stratégie options ?`

    case 'funding':
      return `${base}\n\nFunding rate annualisé = ${value > 0 ? '+' : ''}${value?.toFixed(2)}%. Implication carry trade / positionnement ?`

    case 'basis':
      return `${base}\n\nBasis futures annualisé moyen = ${value > 0 ? '+' : ''}${value?.toFixed(2)}%. Signal cash-and-carry ?`

    case 'iv_rv_premium':
      return `${base}\n\nPremium IV/RV = ${value > 0 ? '+' : ''}${value?.toFixed(1)} pts. Opportunité de vol selling ou vol buying ?`

    case 'global_score':
      return `${base}\n\nScore composite marché = ${value}/100 (IV·Funding·Basis·IV/RV·OnChain·Positioning). Lecture synthétique ?`

    case 'positioning':
      return `${base}\n\nLong/Short Binance = ${ctx.lsRatio?.toFixed(2)}, Put/Call Deribit = ${ctx.pcRatio?.toFixed(2)}. Signal contrarian ou momentum ?`

    case 'fear_greed':
      return `${base}\n\nFear & Greed Index = ${value}/100 (${ctx.label ?? ''}). Implication contrarienne pour le marché spot ?`

    case 'onchain_score':
      return `${base}\n\nScore on-chain composite = ${value}/100. Lecture du sentiment blockchain ?`

    case 'mempool':
      return `${base}\n\nMempool = ${value} tx en attente, congestion: ${ctx.congestion ?? 'N/A'}. Signal d'activité réseau ?`

    case 'exchange_flow':
      return `${base}\n\nNetflow exchange = ${value > 0 ? '+' : ''}${value?.toFixed(0)} BTC. Accumulation ou distribution ?`

    case 'hash_rate':
      return `${base}\n\nHash rate = ${value?.toFixed(1)} EH/s, variation 7j = ${ctx.delta7d > 0 ? '+' : ''}${ctx.delta7d?.toFixed(1)}%. Signal miner sentiment ?`

    default:
      return `${base}\n\nMétrique ${metric} = ${value}. Analyse en une phrase ?`
  }
}

// ── Fallbacks statiques ───────────────────────────────────────────────────────

function _fallback(metric, value) {
  switch (metric) {
    case 'iv_rank':
      return {
        text: value >= 70 ? 'vol implicite élevée — contexte favorable à la vente de vol'
            : value <= 30 ? 'vol implicite comprimée — achat de vol moins risqué'
            : 'IV Rank neutre — pas de biais marqué pour les stratégies vol',
        bias: value >= 70 ? 'bullish' : value <= 30 ? 'bearish' : 'neutral',
      }
    case 'funding':
      return {
        text: value >= 20 ? 'funding élevé — les longs financent fortement, favorise le carry trade'
            : value <= 0  ? 'funding négatif — signal de pression vendeuse sur le perp'
            : 'funding modéré — coût de portage acceptable',
        bias: value >= 15 ? 'bullish' : value <= 0 ? 'bearish' : 'neutral',
      }
    case 'basis':
      return {
        text: value >= 8 ? 'basis élevé — cash-and-carry attractif, marché en contango fort'
            : value <= 0 ? 'backwardation — signal atypique, pression immédiate sur le spot'
            : 'basis en contango modéré',
        bias: value >= 5 ? 'bullish' : value < 0 ? 'bearish' : 'neutral',
      }
    case 'iv_rv_premium':
      return {
        text: value >= 15 ? 'prime IV/RV élevée — vol vendeuse statistiquement avantageuse'
            : value < 0   ? 'RV supérieure à l\'IV — éviter les ventes de vol nues'
            : 'prime IV/RV normale',
        bias: value >= 10 ? 'bullish' : value < 0 ? 'bearish' : 'neutral',
      }
    case 'global_score':
      return {
        text: value >= 70 ? 'conditions multi-factorielles favorables — bon timing pour agir'
            : value <= 35 ? 'score défavorable — réduire l\'exposition, attendre un meilleur contexte'
            : 'environnement mixte — sélectivité requise',
        bias: value >= 60 ? 'bullish' : value <= 40 ? 'bearish' : 'neutral',
      }
    case 'positioning':
      return {
        text: 'divergence retail/institutionnels détectée — signal contrarian à surveiller',
        bias: 'neutral',
      }
    case 'fear_greed':
      return {
        text: value >= 75 ? 'avidité extrême — historiquement zone de distribution'
            : value <= 25 ? 'peur extrême — zone de capitulation, opportunité contrarienne'
            : 'sentiment neutre à modéré',
        bias: value >= 75 ? 'bearish' : value <= 25 ? 'bullish' : 'neutral',
      }
    case 'onchain_score':
      return {
        text: value >= 65 ? 'on-chain constructif — accumulation et activité réseau soutenus'
            : value <= 35 ? 'on-chain faible — sortie de capitaux et réseau peu actif'
            : 'on-chain neutre',
        bias: value >= 60 ? 'bullish' : value <= 40 ? 'bearish' : 'neutral',
      }
    case 'hash_rate':
      return {
        text: 'hash rate stable — sécurité réseau maintenue, mineurs non-capitulants',
        bias: 'neutral',
      }
    default:
      return { text: 'données insuffisantes pour l\'analyse', bias: 'neutral' }
  }
}

// ── Inférer le biais depuis la réponse Claude ─────────────────────────────────

function _inferBias(text) {
  const t = text.toLowerCase()
  const bullishWords = ['haussier', 'bullish', 'achat', 'favorable', 'attractif', 'contrarienne haussière', 'opportunité', 'accumulation', 'offensif']
  const bearishWords = ['baissier', 'bearish', 'vente', 'défavorable', 'distribution', 'risque', 'capitulation', 'pression vendeuse', 'éviter']
  const bull = bullishWords.some(w => t.includes(w))
  const bear = bearishWords.some(w => t.includes(w))
  if (bull && !bear) return 'bullish'
  if (bear && !bull) return 'bearish'
  return 'neutral'
}

// ── Clé de cache ──────────────────────────────────────────────────────────────

function _cacheKey(metric, value) {
  // Arrondi pour éviter des appels redondants sur des micro-variations
  const rounded = typeof value === 'number' ? Math.round(value * 10) / 10 : value
  return `${metric}:${rounded}`
}

// ── Export principal ──────────────────────────────────────────────────────────

/**
 * Génère un insight court via Claude API avec cache et fallback.
 *
 * @param {{ metric: string, value: number|null, context?: object }} params
 * @returns {Promise<{ text: string, bias: 'bullish'|'bearish'|'neutral' }>}
 */
export async function generateInsight({ metric, value, context = {} }) {
  if (value == null) return _fallback(metric, value)

  const key    = _cacheKey(metric, value)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) return _fallback(metric, value)

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: _prompt(metric, value, context) }],
      }),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json()
    const raw  = json.content?.[0]?.text?.trim()
    if (!raw) throw new Error('empty response')

    const data = { text: raw, bias: _inferBias(raw) }
    _cache.set(key, { ts: Date.now(), data })
    return data

  } catch {
    const fb = _fallback(metric, value)
    _cache.set(key, { ts: Date.now(), data: fb })
    return fb
  }
}

/**
 * Vide le cache (utile lors du changement d'asset).
 */
export function clearInsightCache() {
  _cache.clear()
}
