/**
 * data_processing/signals/twitter_generator.js
 *
 * Génère un thread Twitter (5 tweets) via Claude API.
 * Modèle : claude-haiku-4-5-20251001
 * Format : JSON strict, 5 tweets, chacun ≤ 280 caractères.
 *
 * Règles éditoriales :
 *   - Style affirmatif (jamais conditionnel)
 *   - Une seule action par tweet
 *   - Chiffres exacts uniquement (pas d'approximations)
 *   - Zéro promesse de gains garantis
 */

const API_URL    = 'https://api.anthropic.com/v1/messages'
const MODEL      = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 800
const TIMEOUT_MS = 15_000

const EXPERT_SYSTEM_PROMPT = `Tu es un analyste crypto expert qui rédige des threads Twitter analytiques percutants pour des traders expérimentés.

RÈGLES ABSOLUES :
1. Style affirmatif uniquement — jamais de conditionnel ("serait", "pourrait", "peut-être")
2. Une seule action concrète par tweet — pas de listes ni de tirets
3. Chiffres exacts uniquement — jamais "$X environ" ou "~$X"
4. Zéro promesse de gains garantis — mentionner le risque au tweet 5
5. Chaque tweet ≤ 280 caractères, espaces et hashtags compris
6. Thread en français, ton expert mais direct
7. Maximum 1-2 emojis par tweet, pertinents uniquement`

const TWEET_STRUCTURE = [
  'Tweet 1 — Hook : chiffre clé le plus marquant du contexte (score, IV Rank, prix settlement…)',
  'Tweet 2 — Contexte : situation de marché synthétique (IV Rank, funding, basis) en 1 phrase',
  'Tweet 3 — Action Spot/Futures : recommandation directionnelle précise avec signal et durée',
  'Tweet 4 — Action Options : stratégie avec strikes exacts si disponibles',
  'Tweet 5 — Synthèse : conclusion + rappel du risque + 2 hashtags max ($ASSET et #Options ou #Crypto)',
]

// ── Générateur principal ───────────────────────────────────────────────────────

/**
 * Génère un thread Twitter de 5 tweets à partir d'un trigger et de son contexte.
 *
 * @param {object} trigger         — trigger tel que retourné par detectTrigger
 * @param {object} marketContext   — contexte marché du trigger
 * @returns {Promise<string[]>}    — tableau de 5 tweets
 */
export async function generateTwitterThread(trigger, marketContext) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

  const contextPrompt   = _buildContextPrompt(trigger, marketContext)
  const structurePrompt = _buildStructurePrompt()

  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    const response = await fetch(API_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type':         'application/json',
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-request-origin': 'user-initiated',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     EXPERT_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: contextPrompt + '\n\n' + structurePrompt }],
      }),
    })

    clearTimeout(timer)

    if (!response.ok) throw new Error(`API ${response.status}`)

    const data  = await response.json()
    const text  = data.content?.[0]?.text ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    if (!Array.isArray(parsed.tweets) || parsed.tweets.length !== 5) {
      throw new Error('Structure JSON invalide')
    }

    return parsed.tweets.map(t => String(t).slice(0, 280))

  } catch (err) {
    console.warn('[twitter_generator] fallback:', err.message)
    return _fallbackThread(trigger, marketContext)
  }
}

// ── Construction du prompt ────────────────────────────────────────────────────

function _buildContextPrompt(trigger, ctx) {
  const lines = [
    `Événement : ${trigger.label} (${trigger.type})`,
    `Actif : ${ctx.asset ?? trigger.asset}`,
  ]

  if (ctx.score != null)    lines.push(`Score signal : ${ctx.score}/100`)
  if (ctx.ivRank != null)   lines.push(`IV Rank : ${ctx.ivRank}%`)
  if (ctx.funding != null)  lines.push(`Funding annualisé : ${ctx.funding.toFixed(2)}%/an`)
  if (ctx.basisAvg != null) lines.push(`Basis futures moyen : ${ctx.basisAvg.toFixed(2)}%/an`)
  if (ctx.situation)        lines.push(`Situation : ${ctx.situation}`)
  if (ctx.spotPrice != null) lines.push(`Prix spot : $${Math.round(ctx.spotPrice).toLocaleString('en-US')}`)

  if (ctx.recos?.spot)    lines.push(`Reco Spot [${ctx.recos.spot.signal}] : ${ctx.recos.spot.action?.slice(0, 120) ?? '—'}`)
  if (ctx.recos?.futures) lines.push(`Reco Futures [${ctx.recos.futures.signal}] : ${ctx.recos.futures.action?.slice(0, 120) ?? '—'}`)
  if (ctx.recos?.options) lines.push(`Reco Options [${ctx.recos.options.signal}] : ${ctx.recos.options.action?.slice(0, 120) ?? '—'}`)

  if (ctx.strikeCall != null) lines.push(`Strike Call cible : $${ctx.strikeCall.toLocaleString('en-US')}`)
  if (ctx.strikePut  != null) lines.push(`Strike Put cible : $${ctx.strikePut.toLocaleString('en-US')}`)

  // Spécifique Settlement
  if (ctx.settlementPrice != null) {
    lines.push(`Settlement Deribit : $${ctx.settlementPrice.toLocaleString('en-US')}`)
    if (ctx.spotDeltaLabel)    lines.push(`Vs spot : ${ctx.spotDeltaLabel}`)
    if (ctx.maxPainDeltaLabel) lines.push(`Vs Max Pain ($${ctx.maxPainStrike?.toLocaleString('en-US')}) : ${ctx.maxPainDeltaLabel}`)
    if (ctx.dateKey)           lines.push(`Date : ${ctx.dateKey}`)
  }

  return lines.join('\n')
}

function _buildStructurePrompt() {
  return `Génère un thread Twitter analytique de 5 tweets.

Structure imposée (1 tweet = 1 rôle) :
${TWEET_STRUCTURE.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Réponds UNIQUEMENT en JSON valide :
{
  "tweets": [
    "tweet 1 texte (≤ 280 caractères)",
    "tweet 2 texte (≤ 280 caractères)",
    "tweet 3 texte (≤ 280 caractères)",
    "tweet 4 texte (≤ 280 caractères)",
    "tweet 5 texte (≤ 280 caractères)"
  ]
}

Ne réponds qu'avec le JSON, aucun texte avant ou après.`
}

// ── Fallback statique ─────────────────────────────────────────────────────────

function _fallbackThread(trigger, ctx) {
  const asset = ctx.asset ?? trigger.asset ?? 'BTC'
  const spot  = ctx.spotPrice != null
    ? `$${Math.round(ctx.spotPrice).toLocaleString('en-US')}`
    : null

  if (trigger.type === 'SETTLEMENT') {
    const price = ctx.settlementPrice != null
      ? `$${ctx.settlementPrice.toLocaleString('en-US')}`
      : '—'
    return [
      `🔔 Settlement Deribit ${asset} ${ctx.dateKey ?? ''} : ${price}${ctx.spotDeltaLabel ? ` (${ctx.spotDeltaLabel} vs spot)` : ''}`.slice(0, 280),
      `Le fixing quotidien ${asset} à 08:00 UTC sert de référence pour l'expiration de toutes les options Deribit.`.slice(0, 280),
      `Écart vs Max Pain${ctx.maxPainDeltaLabel ? ` : ${ctx.maxPainDeltaLabel}` : ' : données indisponibles'}. Prochain fixing demain 08:00 UTC.`.slice(0, 280),
      `IV Rank au fixing${ctx.ivRank != null ? ` : ${ctx.ivRank}%` : ' : indisponible'}. Un IV Rank élevé au fixing valide les ventes de volatilité.`.slice(0, 280),
      `Synthèse settlement ${asset} — vérifier les données officielles Deribit avant tout trade. #${asset} #Options`.slice(0, 280),
    ]
  }

  const score = ctx.score != null ? `${ctx.score}/100` : '—'
  return [
    `📊 ${trigger.label} ${asset}${spot ? ` · ${spot}` : ''} — Score Veridex : ${score}`.slice(0, 280),
    (ctx.situation ?? `Contexte ${asset} : analyse multi-indicateurs.`).slice(0, 280),
    (ctx.recos?.spot
      ? `Spot [${ctx.recos.spot.signal}] — ${ctx.recos.spot.action?.slice(0, 200) ?? '—'}`
      : `Spot ${asset} : attente de confirmation directionnelle.`
    ).slice(0, 280),
    (ctx.recos?.options
      ? `Options [${ctx.recos.options.signal}] — ${ctx.recos.options.action?.slice(0, 200) ?? '—'}`
      : `Options ${asset} : surveiller l'IV Rank pour confirmer le setup.`
    ).slice(0, 280),
    `Les marchés comportent un risque de perte en capital. #${asset} #Options`.slice(0, 280),
  ]
}
