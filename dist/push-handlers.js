/**
 * push-handlers.js — Extension du Service Worker Veridex
 *
 * Chargé via importScripts() dans le SW généré par vite-plugin-pwa.
 * Gère :
 *   - Push events (notifications depuis serveur VAPID)
 *   - Notification click → focus ou ouverture de l'app
 *   - Messages depuis l'app (TEST_NOTIFICATION, SHOW_NOTIFICATION, SKIP_WAITING)
 *
 * NOTE : Les notifications locales (app ouverte / background) utilisent
 * SHOW_NOTIFICATION via postMessage. Le push event requiert un backend
 * VAPID pour les notifications app fermée.
 *
 * TODO: Backend VAPID requis pour push complet app fermée.
 */

// ── Push event (notifications serveur VAPID) ──────────────────────────────────

self.addEventListener('push', function(event) {
  if (!event.data) return

  var payload
  try {
    payload = event.data.json()
  } catch(_) {
    payload = {
      title: 'Veridex',
      body:  event.data.text(),
      level: 'info',
    }
  }

  var options = _buildNotificationOptions(payload)

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  )
})

// ── Clic sur une notification ─────────────────────────────────────────────────

self.addEventListener('notificationclick', function(event) {
  event.notification.close()

  var data = event.notification.data || {}
  var url  = data.url || '/'

  if (event.action === 'dismiss') return

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      // Si l'app est déjà ouverte → focus + message
      for (var i = 0; i < list.length; i++) {
        var client = list[i]
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.postMessage({ type: 'NOTIFICATION_CLICK', data: data })
          return
        }
      }
      // Sinon → ouvrir l'app
      return clients.openWindow(url)
    })
  )
})

// ── Messages depuis l'app → SW ────────────────────────────────────────────────

self.addEventListener('message', function(event) {
  if (!event.data) return

  // Mise à jour du SW sans attendre la fermeture des onglets
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  // Test de notification depuis les Settings
  if (event.data.type === 'TEST_NOTIFICATION') {
    self.registration.showNotification('◈ Veridex — Test', {
      body:    'Les notifications fonctionnent ✓',
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      silent:  false,
      vibrate: [200, 100, 200],
      tag:     'test',
    })
    return
  }

  // Notification locale depuis notification_manager.js
  if (event.data.type === 'SHOW_NOTIFICATION') {
    var p = event.data.payload
    if (!p) return
    var opts = _buildNotificationOptions(p)
    self.registration.showNotification(p.title || 'Veridex', opts)
    return
  }
})

// ── Builder d'options de notification ────────────────────────────────────────

function _buildNotificationOptions(payload) {
  var base = {
    body:               payload.body || '',
    icon:               '/icon-192.png',
    badge:              '/icon-192.png',
    tag:                payload.tag  || payload.type || 'veridex',
    data:               payload.data || {},
    timestamp:          payload.timestamp || Date.now(),
    requireInteraction: payload.level === 'critical',
  }

  if (payload.level === 'critical') {
    return Object.assign({}, base, {
      vibrate:  [200, 100, 200, 100, 400],
      silent:   false,
      renotify: true,
      actions: [
        { action: 'open',    title: 'Voir →' },
        { action: 'dismiss', title: 'Ignorer' },
      ],
    })
  }

  if (payload.level === 'alert') {
    return Object.assign({}, base, {
      vibrate: [200, 100, 200],
      silent:  false,
      actions: [
        { action: 'open', title: 'Voir →' },
      ],
    })
  }

  // level === 'info' → silencieux, badge uniquement
  return Object.assign({}, base, {
    silent: true,
  })
}
