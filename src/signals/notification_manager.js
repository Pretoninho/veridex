/**
 * data_processing/signals/notification_manager.js
 *
 * Gestion centrale des notifications push PWA Veridex.
 *
 * Responsabilités :
 *   1. Demande / vérification de permission
 *   2. Persistance et lecture des seuils configurables
 *   3. Envoi de notifications via Service Worker (+ fallback Notification API)
 *   4. Cooldown anti-spam par type
 *   5. Historique des notifications envoyées
 *
 * Compatibilité :
 *   - Android Chrome  : support complet (SW + Notification API)
 *   - iOS Safari 16.4+ : support partiel (SW notifications uniquement)
 *   - Desktop         : support complet
 */

import { fnv1a } from '../data/data_store/cache.js'
import { NOTIFICATION_DEFAULTS, NOTIFICATION_COOLDOWNS, STORAGE_LIMITS } from '../config/signal_calibration.js'

// ── Clés localStorage ─────────────────────────────────────────────────────────

const THRESHOLDS_KEY = STORAGE_LIMITS.THRESHOLDS_KEY
const HISTORY_KEY = STORAGE_LIMITS.HISTORY_KEY
const COOLDOWNS_KEY = STORAGE_LIMITS.COOLDOWNS_KEY
const MAX_HISTORY = STORAGE_LIMITS.MAX_NOTIFICATION_HISTORY

// ── Seuils par défaut ─────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = {
  ...NOTIFICATION_DEFAULTS,
  cooldown: NOTIFICATION_COOLDOWNS,
}

// ── Permission ────────────────────────────────────────────────────────────────

/**
 * Demande la permission de notification.
 * N'appeler qu'en réponse à une interaction utilisateur.
 * @returns {Promise<{ granted: boolean, reason: string }>}
 */
export async function requestPermission() {
  if (!('Notification' in window)) {
    return { granted: false, reason: 'not_supported' }
  }

  if (Notification.permission === 'granted') {
    return { granted: true, reason: 'granted' }
  }

  if (Notification.permission === 'denied') {
    return { granted: false, reason: 'denied' }
  }

  try {
    const result = await Notification.requestPermission()
    return { granted: result === 'granted', reason: result }
  } catch (err) {
    return { granted: false, reason: 'error' }
  }
}

/**
 * Retourne le statut de permission actuel.
 * @returns {'granted'|'denied'|'default'|'not_supported'}
 */
export function getPermissionStatus() {
  if (!('Notification' in window)) return 'not_supported'
  return Notification.permission
}

// ── Seuils ────────────────────────────────────────────────────────────────────

/**
 * Retourne les seuils fusionnés (défauts + overrides utilisateur).
 */
export function getThresholds() {
  try {
    const stored = JSON.parse(localStorage.getItem(THRESHOLDS_KEY) || '{}')
    // Deep merge du sous-objet cooldown
    return {
      ...DEFAULT_THRESHOLDS,
      ...stored,
      cooldown: { ...DEFAULT_THRESHOLDS.cooldown, ...(stored.cooldown ?? {}) },
    }
  } catch (_) {
    return { ...DEFAULT_THRESHOLDS }
  }
}

/**
 * Met à jour un seuil et persiste.
 * @param {string} key — clé de seuil (peut être 'cooldown.price_move')
 * @param {number} value
 */
export function updateThreshold(key, value) {
  try {
    const current = getThresholds()
    let updated

    if (key.startsWith('cooldown.')) {
      const subKey = key.slice('cooldown.'.length)
      updated = {
        ...current,
        cooldown: { ...current.cooldown, [subKey]: value },
      }
    } else {
      updated = { ...current, [key]: value }
    }

    localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(updated))
    return updated
  } catch (_) {
    return getThresholds()
  }
}

/**
 * Remet tous les seuils aux valeurs par défaut.
 */
export function resetThresholds() {
  localStorage.removeItem(THRESHOLDS_KEY)
  return { ...DEFAULT_THRESHOLDS }
}

// ── Cooldowns ─────────────────────────────────────────────────────────────────

function _getCooldowns() {
  try {
    return JSON.parse(localStorage.getItem(COOLDOWNS_KEY) || '{}')
  } catch (_) { return {} }
}

function _setCooldown(cooldownKey, typeKey) {
  const cooldowns  = _getCooldowns()
  const thresholds = getThresholds()
  const ms = thresholds.cooldown[typeKey] ?? 30 * 60_000

  cooldowns[cooldownKey] = Date.now() + ms
  try {
    localStorage.setItem(COOLDOWNS_KEY, JSON.stringify(cooldowns))
  } catch (_) {}
}

function _isOnCooldown(cooldownKey) {
  const cooldowns = _getCooldowns()
  const until = cooldowns[cooldownKey] ?? 0
  return Date.now() < until
}

// ── Historique ────────────────────────────────────────────────────────────────

function _getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch (_) { return [] }
}

function _addToHistory(entry) {
  try {
    const history = _getHistory()
    history.push(entry)
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY)
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch (_) {}
}

/**
 * Retourne les dernières notifications envoyées (du plus récent au plus ancien).
 * @param {number} [limit=50]
 * @returns {Array}
 */
export function getNotificationHistory(limit = 50) {
  return _getHistory().slice(-limit).reverse()
}

/**
 * Efface l'historique et les cooldowns.
 */
export function clearNotificationHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
    localStorage.removeItem(COOLDOWNS_KEY)
  } catch (_) {}
}

// ── Envoi de notification ─────────────────────────────────────────────────────

/**
 * Envoie une notification push locale.
 *
 * Utilise le Service Worker (showNotification via postMessage) en priorité,
 * avec fallback sur la Notification API directe.
 *
 * Gère : cooldown, déduplication par hash, historique.
 *
 * @param {{
 *   type: string,
 *   asset?: string,
 *   level: 'critical'|'alert'|'info',
 *   title: string,
 *   body: string,
 *   tag?: string,
 *   data?: object,
 * }} payload
 * @returns {Promise<boolean>} true si envoyé
 */
export async function sendNotification(payload) {
  if (Notification.permission !== 'granted') return false

  // Clé de cooldown = type + asset
  const cooldownKey = `${payload.type}_${payload.asset ?? 'all'}`
  // Clé de type sans asset pour lire le cooldown configuré
  const typeKey = payload.type.replace(/_BTC|_ETH|_ALL/g, '')

  // forceTest: true → bypass cooldown (mode test depuis Settings)
  if (!payload.forceTest && _isOnCooldown(cooldownKey)) return false

  // Hash unique sur fenêtre de 1 minute pour la déduplication
  const hash = fnv1a(
    `${payload.type}|${payload.asset ?? ''}|${Math.floor(Date.now() / 60_000)}`
  )

  const history = _getHistory()
  if (history.some(h => h.hash === hash)) return false

  try {
    // Priorité : Service Worker showNotification (meilleur support mobile)
    if ('serviceWorker' in navigator) {
      const sw = await navigator.serviceWorker.ready.catch(() => null)
      if (sw?.active) {
        sw.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          payload: {
            ...payload,
            hash,
            timestamp: Date.now(),
          },
        })
      } else {
        _sendDirect(payload)
      }
    } else {
      _sendDirect(payload)
    }

    // Persister dans l'historique
    _addToHistory({
      hash,
      type:      payload.type,
      asset:     payload.asset,
      title:     payload.title,
      body:      payload.body,
      level:     payload.level,
      timestamp: Date.now(),
    })

    // Appliquer le cooldown (sauf en mode test)
    if (!payload.forceTest) {
      _setCooldown(cooldownKey, typeKey)
    }

    return true
  } catch (err) {
    console.warn('[sendNotification] Error:', err?.message)
    return false
  }
}

/** Fallback : Notification API directe (desktop, iOS Safari partiel). */
function _sendDirect(payload) {
  try {
    const notif = new Notification(payload.title, {
      body:               payload.body,
      icon:               '/icon-192.png',
      badge:              '/icon-192.png',
      tag:                payload.tag ?? payload.type,
      requireInteraction: payload.level === 'critical',
      silent:             payload.level === 'info',
    })
    notif.onclick = () => { window.focus(); notif.close() }
  } catch (_) {}
}
