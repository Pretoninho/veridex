/**
 * data_processing/signals/novice_generator.js
 *
 * Génère la couche novice d'un signal via Claude API.
 * La clé API est gérée par l'infrastructure (VITE_ANTHROPIC_API_KEY).
 *
 * La métaphore est différente à chaque génération (contrainte dans le prompt).
 * En cas d'erreur/timeout → fallback statique affiché discrètement.
 */

import { TONES } from './tone_config.js'

const API_URL    = 'https://api.anthropic.com/v1/messages'
const MODEL      = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 500
const TIMEOUT_MS = 10_000

// ── Appel Claude ──────────────────────────────────────────────────────────────

/**
 * Génère le contenu novice d'un signal via Claude API.
 *
 * @param {{
 *   asset: string,
 *   spotPrice: number|null,
 *   label: string,
 *   score: number|null,
 *   ivRank: number|null,
 *   funding: number|null,
 *   situation: string,
 *   estimatedGain: number|null,
 *   strikeCall: number|null,
 *   strikePut: number|null,
 *   expertAction: string,
 *   duration: string,
 * }} signal
 * @param {string} toneId
 * @returns {Promise<{
 *   emoji: string,
 *   headline: string,
 *   metaphor: string,
 *   situation: string,
 *   steps: string[],
 *   gain: string,
 *   risk: string,
 *   action: string,
 *   tone_used: string,
 *   is_fallback?: boolean
 * }>}
 */
export async function generateNoviceContent(signal, toneId) {
  const tone = TONES[toneId] ?? TONES['serious']
  // Nonce aléatoire pour forcer une métaphore différente à chaque appel
  const nonce = Math.floor(Math.random() * 10000)

  const dataPrompt = `Voici le signal de marché (nonce: ${nonce}) :

Actif : ${signal.asset}
Prix actuel : ${signal.spotPrice != null ? `$${Math.round(signal.spotPrice).toLocaleString('fr-FR')}` : 'N/A'}
Signal global : ${signal.label} (${signal.score ?? 'N/A'}/100)
IV Rank : ${signal.ivRank != null ? `${Number(signal.ivRank).toFixed(1)}%` : 'N/A'}
Funding : ${signal.funding != null ? `${Number(signal.funding).toFixed(2)}%/an` : 'N/A'}
Situation : ${signal.situation}

Recommandation Spot : [${signal.spotSignal ?? '—'}] ${signal.spotAction ?? 'N/A'}
Recommandation Futures : [${signal.futuresSignal ?? '—'}] ${signal.futuresAction ?? 'N/A'}
Recommandation Options : [${signal.optionsSignal ?? '—'}] ${signal.optionsAction ?? 'N/A'}

Gain estimé sur 1000$ : ${signal.estimatedGain != null ? `${signal.estimatedGain}$` : 'N/A'}
Durée cible : ${signal.duration ?? 'N/A'}`

  const structurePrompt = `Génère une interprétation novice de ce signal de marché crypto.

CONTRAINTES OBLIGATOIRES :
1. Utilise une métaphore du monde réel UNIQUE et INATTENDUE — JAMAIS la même que d'habitude (varie entre : cuisine, sport, voyage, musique, construction, jardinage, météo, cinéma, cuisine, bricolage, pêche, danse, astronomie...)
2. Mentionne Binance ou Deribit pour l'action concrète
3. Donne un montant concret (exemple sur 1000$)
4. Mentionne le risque honnêtement en 1 phrase — ne promets JAMAIS de gains garantis
5. Résume les 3 opportunités (spot, futures, options) en langage simple
6. Maximum 130 mots au total

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{
  "emoji": "un seul emoji représentatif",
  "headline": "titre accrocheur maximum 10 mots",
  "metaphor": "analogie monde réel 1-2 phrases (DIFFÉRENTE à chaque fois)",
  "situation": "ce qui se passe en ce moment 1 phrase simple",
  "steps": ["opportunité spot en 1 phrase", "opportunité futures en 1 phrase", "opportunité options en 1 phrase"],
  "gain": "estimation sur 1000$ exemple non garanti",
  "risk": "risque en 1 phrase honnête",
  "action": "appel à l'action final 1 phrase",
  "tone_used": "${toneId}"
}

Ne réponds qu'avec le JSON, aucun texte avant ou après.`

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

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
        system:     tone.systemPrompt,
        messages:   [{ role: 'user', content: dataPrompt + '\n\n' + structurePrompt }],
      }),
    })

    clearTimeout(timer)

    if (!response.ok) throw new Error(`API ${response.status}`)

    const data = await response.json()
    const text = data.content?.[0]?.text ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    // Validation minimale du JSON retourné
    if (!parsed.headline || !Array.isArray(parsed.steps)) throw new Error('JSON incomplet')

    return parsed

  } catch (err) {
    const isFallback = true
    console.warn('[novice_generator] fallback:', err.message)
    return _fallback(signal, toneId, isFallback)
  }
}

// ── Fallback statique ─────────────────────────────────────────────────────────

function _fallback(signal, toneId, isFallback = true) {
  const score = signal.score ?? 50
  const isPositive = score >= 60

  return {
    emoji:    isPositive ? '📈' : score >= 40 ? '⚖️' : '⚠️',
    headline: isPositive
      ? 'Le marché offre une fenêtre d\'action'
      : score >= 40 ? 'Marché en observation' : 'Prudence recommandée',
    metaphor: isPositive
      ? 'Comme un soleil qui perce les nuages après la pluie — l\'opportunité est là pour qui la voit.'
      : 'Comme un ciel couvert sans certitude de pluie — attente et vigilance sont de mise.',
    situation: signal.situation,
    steps: isPositive
      ? [
          `Spot [${signal.spotSignal ?? '—'}] : ${signal.spotAction?.slice(0, 60) ?? 'voir analyse expert'}`,
          `Futures [${signal.futuresSignal ?? '—'}] : ${signal.futuresAction?.slice(0, 60) ?? 'voir analyse expert'}`,
          `Options [${signal.optionsSignal ?? '—'}] : ${signal.optionsAction?.slice(0, 60) ?? 'voir analyse expert'}`,
        ]
      : [
          'Surveiller l\'évolution du marché',
          'Attendre confirmation du signal',
          'Ne rien faire si incertain(e)',
        ],
    gain:   signal.estimatedGain != null
      ? `Estimation ~${signal.estimatedGain}$ sur 1000$ (non garanti, à titre indicatif)`
      : 'Estimation indisponible — consulter l\'analyse expert',
    risk:   'Ne jamais investir plus que ce que tu peux te permettre de perdre. Les performances passées ne garantissent pas les résultats futurs.',
    action: isPositive
      ? 'Agis avec méthode — ouvre une position calculée sur Binance.'
      : 'Reste en veille et reviens quand le signal se clarifie.',
    tone_used:   toneId,
    is_fallback: isFallback,
  }
}
