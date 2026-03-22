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

  const dataPrompt = `Voici le signal de marché du jour :

Actif : ${signal.asset}
Prix actuel : ${signal.spotPrice != null ? `$${Math.round(signal.spotPrice).toLocaleString('fr-FR')}` : 'N/A'}
Signal : ${signal.label}
Score : ${signal.score ?? 'N/A'}/100
IV Rank : ${signal.ivRank != null ? `${signal.ivRank.toFixed(1)}%` : 'N/A'}
Funding : ${signal.funding != null ? `${signal.funding.toFixed(2)}%/an` : 'N/A'}
Situation : ${signal.situation}

Action experte recommandée :
${signal.expertAction}

Strike cible haussier : ${signal.strikeCall != null ? `$${Math.round(signal.strikeCall).toLocaleString('fr-FR')}` : 'N/A'}
Strike cible baissier : ${signal.strikePut  != null ? `$${Math.round(signal.strikePut).toLocaleString('fr-FR')}`  : 'N/A'}
Durée : ${signal.duration}
Gain estimé sur 1000$ : ${signal.estimatedGain != null ? `${signal.estimatedGain}$` : 'N/A'}`

  const structurePrompt = `Génère une interprétation novice de ce signal.

CONTRAINTES OBLIGATOIRES :
1. Utilise une métaphore du monde réel DIFFÉRENTE à chaque génération (cuisine, sport, voyage, nature, cinéma, musique, construction, jardinage, cuisine, météo...)
2. Mentionne la plateforme Nexo ou Binance
3. Donne un montant concret (exemple sur 1000$)
4. Mentionne le risque honnêtement en 1 phrase — ne promets JAMAIS de gains garantis
5. Termine par un appel à l'action précis
6. Maximum 120 mots au total

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{
  "emoji": "un seul emoji représentatif",
  "headline": "titre accrocheur maximum 10 mots",
  "metaphor": "analogie monde réel 1-2 phrases",
  "situation": "ce qui se passe en ce moment 1 phrase simple",
  "steps": ["étape 1 courte", "étape 2 courte", "étape 3 courte"],
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
          'Ouvrir Nexo ou Binance',
          `Suivre l\'action : ${signal.expertAction?.slice(0, 50) ?? 'voir analyse expert'}`,
          'Ne pas dépasser ta limite habituelle',
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
