/**
 * hash_config.js — Configuration centralisée des fréquences et limites de stockage
 *
 * POLL documente les intervalles de polling utilisés dans les providers et les pages.
 * Ces constantes servent de référence canonique.
 * La migration des valeurs hardcodées peut se faire progressivement.
 *
 * HASH_CONFIG centralise les seuils de sensibilité et les limites de stockage
 * pour la détection d'anomalies et la gestion du cache.
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

  // Verrouillage du protocole (3 niveaux)
  // Niveau 1 — flag ici (maintenant)
  // Niveau 2 — hash cryptographique (avant beta publique)
  // Niveau 3 — ancrage Bitcoin OpenTimestamps (avant monétisation)
  LOCKED:      false,
  VERSION:     '1.0.0',
  LOCKED_AT:   null,
  LOCKED_HASH: null,
}
