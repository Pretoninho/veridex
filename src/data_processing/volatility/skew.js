/**
 * data_processing/volatility/skew.js
 *
 * Calcul du skew de volatilité implicite.
 *
 * Skew 25-delta : IV(call 25D) - IV(put 25D)
 *   > 0 → Put skew (marché craint la baisse — typique BTC/ETH)
 *   < 0 → Call skew (FOMO, marché haussier fort)
 *   ~ 0 → Symétrique
 *
 * Risk Reversal : prix d'un 25D call - prix d'un 25D put (même échéance)
 */

/**
 * Calcule le skew 25-delta simple.
 *
 * @param {number} callIV25d  — IV du call 25-delta (en %)
 * @param {number} putIV25d   — IV du put 25-delta (en %)
 * @returns {{ skew: number, direction: string, label: string } | null}
 */
export function calcSkew25d(callIV25d, putIV25d) {
  if (!Number.isFinite(callIV25d) || !Number.isFinite(putIV25d)) return null
  const skew = callIV25d - putIV25d

  let direction, label
  if (skew > 3)       { direction = 'call';     label = 'Call skew — FOMO / marché haussier' }
  else if (skew > 0)  { direction = 'symmetric'; label = 'Légèrement call skew' }
  else if (skew > -3) { direction = 'symmetric'; label = 'Légèrement put skew (normal)' }
  else                { direction = 'put';       label = 'Put skew — protection à la baisse élevée' }

  return { skew, direction, label }
}

/**
 * Calcule le skew ATM vs wings (smile de vol).
 * Mesure la courbure : IV(OTM) - IV(ATM)
 *
 * @param {number} atmIV     — IV ATM (en %)
 * @param {number} wingIV    — IV d'une option OTM (même échéance)
 * @returns {number|null}    — smile > 0 = wings chères par rapport à ATM
 */
export function calcSmile(atmIV, wingIV) {
  if (!Number.isFinite(atmIV) || !Number.isFinite(wingIV)) return null
  return wingIV - atmIV
}

/**
 * Interprétation du skew pour l'affichage.
 *
 * @param {number|null} skew
 * @returns {{ color: string, sentiment: string }}
 */
export function interpretSkew(skew) {
  if (skew == null) return { color: 'var(--text-muted)', sentiment: 'Inconnu' }
  if (skew > 5)   return { color: 'var(--call)',   sentiment: 'FOMO fort — vol calls premium' }
  if (skew > 2)   return { color: 'var(--atm)',    sentiment: 'Léger call bias' }
  if (skew > -2)  return { color: 'var(--accent2)', sentiment: 'Marché équilibré' }
  if (skew > -5)  return { color: 'var(--text-dim)', sentiment: 'Protection modérée' }
  return               { color: 'var(--put)',    sentiment: 'Protection élevée — stress' }
}
