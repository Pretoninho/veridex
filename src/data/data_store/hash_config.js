/**
 * hash_config.js — Configuration centralisée des fréquences et limites de stockage
 *
 * POLL documente les intervalles de polling utilisés dans les providers et les pages.
 * Ces constantes servent de référence canonique.
 * La migration des valeurs hardcodées peut se faire progressivement.
 *
 * HASH_CONFIG centralise les seuils de sensibilité et les limites de stockage
 * pour la détection d'anomalies et la gestion du cache.
 *
 * Fonctions dynamiques :
 *   getPollInterval(type, marketState)  — fréquence adaptée à la volatilité et au mode
 *   getSensitivity(marketState)         — seuils adaptatifs selon le régime de marché
 *   getStorageLimits(activityLevel)     — limites de stockage selon l'activité et le mode
 *   computeConfigHash(config)           — empreinte SHA-256 d'un objet config (async)
 *   verifyConfigIntegrity()             — vérifie que HASH_CONFIG n'a pas été altéré (async)
 *   isBreakingChange(oldVer, newVer)    — détecte un changement de version majeur
 */

// ── Intervalles de polling ────────────────────────────────────────────────────

export const POLL = {
  REALTIME:    5_000,   // Spot Deribit, Spot Binance
  FAST:       15_000,   // OI, Funding, Liquidations, Trades
  NORMAL:     30_000,   // Sentiment, Taker volume, Options chain
  SLOW:       60_000,   // Funding history, Delivery prices
  ONCHAIN:    60_000,   // On-chain — même vitesse que SLOW
  FINGERPRINT: 30_000,  // Fingerprint patterns
  CLOCK_SYNC: 300_000,  // Synchronisation horloges — 5 min
}

// ── Configuration du hashing et des limites de stockage ──────────────────────

export const HASH_CONFIG = {
  // Seuils de sensibilité pour la détection d'anomalies
  sensitivity: {
    price_change_pct: 0.1,  // ignorer si < 0.1%
    iv_change_pts:    0.5,  // ignorer si < 0.5 points
    funding_change:   0.5,  // ignorer si < 0.5%/an
  },

  // Limites de stockage
  storage: {
    changeLog_max:       500,  // entrées max SmartCache
    signal_history:      500,  // signaux IndexedDB max
    clock_sync_history:   10,  // syncs horloges localStorage max
    fingerprint_max:    1000,  // patterns IndexedDB max
  },

  // Mode d'exécution — adapte le polling, le stockage et les logs
  // 'production' : comportement nominal
  // 'debug'      : polling accéléré, logs activés
  // 'simulation' : polling ultra-rapide, données simulées, pas d'appels API réels
  MODE: 'production',

  // Verrouillage du protocole (3 niveaux)
  // Niveau 1 — flag ici (maintenant)
  // Niveau 2 — hash cryptographique (avant beta publique)
  // Niveau 3 — ancrage Bitcoin OpenTimestamps (avant monétisation)
  LOCKED:      false,
  VERSION:     '1.0.0',
  LOCKED_AT:   null,
  LOCKED_HASH: null,
}

// ── Upgrade 1 — Polling dynamique ────────────────────────────────────────────

/**
 * Retourne l'intervalle de polling adapté au régime de marché et au mode d'exécution.
 *
 * Règles volatilité :
 *   > 70  → accélère (× 0.5)   — capter les mouvements importants
 *   < 30  → ralentit (× 1.5)   — réduire le bruit et économiser les appels API
 *   sinon → intervalle de base
 *
 * Règles MODE :
 *   'debug'      → × 0.25  (polling ultra-rapide)
 *   'simulation' → × 0.1   (cycles de test ultra-rapides)
 *
 * @param {string} type          — clé de POLL (ex. 'REALTIME', 'FAST', …)
 * @param {object} [marketState] — état de marché optionnel { volatility: 0–100 }
 * @returns {number}             — intervalle en millisecondes
 */
export function getPollInterval(type, marketState) {
  const base = POLL[type]
  if (base === undefined) return undefined

  if (HASH_CONFIG.MODE === 'debug')      return Math.round(base * 0.25)
  if (HASH_CONFIG.MODE === 'simulation') return Math.round(base * 0.1)

  if (!marketState) return base

  if (marketState.volatility > 70) return Math.round(base * 0.5)
  if (marketState.volatility < 30) return Math.round(base * 1.5)

  return base
}

// ── Upgrade 2 — Sensibilité adaptative ───────────────────────────────────────

/**
 * Retourne les seuils de sensibilité adaptés au régime de marché actuel.
 *
 * Règles :
 *   volatilité > 60  → price_change_pct plus large (0.3) pour ignorer le bruit
 *   IV > 70          → iv_change_pts plus large (1.0) pour ignorer le bruit
 *   fundingVol > 50  → funding_change plus large (1.0)
 *
 * Si aucun état de marché n'est fourni, retourne les valeurs de référence de HASH_CONFIG.
 *
 * @param {object} [marketState] — { volatility: 0–100, iv: 0–100, fundingVol: 0–100 }
 * @returns {{ price_change_pct: number, iv_change_pts: number, funding_change: number }}
 */
export function getSensitivity(marketState) {
  if (!marketState) return { ...HASH_CONFIG.sensitivity }

  return {
    price_change_pct: marketState.volatility > 60 ? 0.3 : 0.1,
    iv_change_pts:    marketState.iv          > 70 ? 1.0 : 0.5,
    funding_change:   marketState.fundingVol  > 50 ? 1.0 : 0.5,
  }
}

// ── Upgrade 3 — Stockage intelligent ─────────────────────────────────────────

/**
 * Retourne les limites de stockage adaptées au niveau d'activité du marché.
 *
 * Règles activité :
 *   > 70  → limites doublées (marché actif, plus de signaux à conserver)
 *   sinon → limites de référence
 *
 * En mode 'production' avec faible activité, les limites sont réduites de moitié
 * pour économiser de la mémoire sur les appareils à ressources limitées.
 *
 * @param {number} activityLevel — niveau d'activité marché de 0 à 100
 * @returns {{ changeLog_max: number, signal_history: number, fingerprint_max: number, clock_sync_history: number }}
 */
export function getStorageLimits(activityLevel) {
  const { storage } = HASH_CONFIG

  if (activityLevel > 70) {
    return {
      changeLog_max:      1000,
      signal_history:     1000,
      fingerprint_max:    2000,
      clock_sync_history: storage.clock_sync_history,
    }
  }

  if (HASH_CONFIG.MODE === 'production' && activityLevel < 30) {
    return {
      changeLog_max:      Math.round(storage.changeLog_max  / 2),
      signal_history:     Math.round(storage.signal_history / 2),
      fingerprint_max:    Math.round(storage.fingerprint_max / 2),
      clock_sync_history: storage.clock_sync_history,
    }
  }

  return {
    changeLog_max:      storage.changeLog_max,
    signal_history:     storage.signal_history,
    fingerprint_max:    storage.fingerprint_max,
    clock_sync_history: storage.clock_sync_history,
  }
}

// ── Upgrade 4 — Intégrité cryptographique de la config ───────────────────────

/**
 * Calcule l'empreinte SHA-256 d'un objet config sérialisé en JSON.
 * Utilise l'API Web Crypto (navigateur + Node.js 18+).
 *
 * @param {object} config — objet de configuration à hacher
 * @returns {Promise<string>} chaîne hexadécimale de 64 caractères
 */
export async function computeConfigHash(config) {
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(config))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Vérifie que HASH_CONFIG n'a pas été altéré depuis son verrouillage.
 * N'effectue aucune vérification si HASH_CONFIG.LOCKED est false ou si LOCKED_HASH est absent.
 *
 * Seules les parties stables de HASH_CONFIG sont hashées (sensitivity, storage, VERSION, MODE)
 * afin d'éviter la circularité avec les champs de verrouillage eux-mêmes (LOCKED_HASH, LOCKED_AT).
 *
 * @throws {Error} 'CONFIG TAMPERED' si le hash courant ne correspond pas au hash verrouillé
 * @returns {Promise<void>}
 */
export async function verifyConfigIntegrity() {
  if (!HASH_CONFIG.LOCKED || !HASH_CONFIG.LOCKED_HASH) return

  const stableConfig = {
    VERSION:     HASH_CONFIG.VERSION,
    MODE:        HASH_CONFIG.MODE,
    sensitivity: HASH_CONFIG.sensitivity,
    storage:     HASH_CONFIG.storage,
  }
  const currentHash = await computeConfigHash(stableConfig)
  if (currentHash !== HASH_CONFIG.LOCKED_HASH) {
    throw new Error('CONFIG TAMPERED')
  }
}

// ── Upgrade 5 — Versioning intelligent ───────────────────────────────────────

/**
 * Détermine si deux versions impliquent un changement cassant (major bump).
 * Utile pour déclencher des migrations IndexedDB, resets de cache, ou vérifications
 * de compatibilité backend lors d'une mise à jour.
 *
 * @param {string} oldVersion — version précédente, ex. '1.2.3'
 * @param {string} newVersion — nouvelle version, ex. '2.0.0'
 * @returns {boolean} true si le numéro de version majeur a changé
 */
export function isBreakingChange(oldVersion, newVersion) {
  return oldVersion.split('.')[0] !== newVersion.split('.')[0]
}
