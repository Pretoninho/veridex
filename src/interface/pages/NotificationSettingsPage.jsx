/**
 * pages/NotificationSettingsPage.jsx
 *
 * Page de configuration des notifications push Veridex.
 *
 * Sections :
 *   1. Permission — statut + bouton demande + test panel complet
 *   2. Seuils     — 5 seuils configurables avec reset individuel
 *   3. Cooldowns  — anti-spam par type
 *   4. Historique — dernières notifications envoyées
 */

import { useState, useEffect } from 'react'
import {
  requestPermission,
  getPermissionStatus,
  getThresholds,
  updateThreshold,
  resetThresholds,
  getNotificationHistory,
  clearNotificationHistory,
} from '../../signals/notification_manager.js'
import NotificationTestPanel from '../components/NotificationTestPanel.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
  })
}

function levelDot(level) {
  if (level === 'critical') return { dot: '●', color: '#FF4D6D' }
  if (level === 'alert')    return { dot: '●', color: '#FFD700' }
  return                           { dot: '●', color: 'var(--text-muted)' }
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 14,
    }}>
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
          fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        }}>
          {title}
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {children}
      </div>
    </div>
  )
}

// ── ThresholdRow ──────────────────────────────────────────────────────────────

function ThresholdRow({ label, thresholdKey, value, defaultValue, unit, step, min, max, onChange, onReset }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 12, marginBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,.04)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={value}
          step={step ?? 0.1}
          min={min ?? 0}
          max={max ?? 1000}
          onChange={e => onChange(thresholdKey, parseFloat(e.target.value))}
          style={{
            width: 72, textAlign: 'right',
            background: 'rgba(255,255,255,.05)',
            border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)',
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
            padding: '5px 8px', outline: 'none',
          }}
        />
        {unit && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30 }}>
            {unit}
          </span>
        )}
        <button
          onClick={() => onReset(thresholdKey, defaultValue)}
          title="Réinitialiser"
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-muted)',
            fontSize: 10, padding: '4px 8px', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 700,
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

// ── CooldownRow ───────────────────────────────────────────────────────────────

function CooldownRow({ label, thresholdKey, valueMs, defaultMs, onChange, onReset, last }) {
  const valueMin = Math.round(valueMs / 60_000)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10,
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,.04)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={valueMin}
          step={1}
          min={1}
          max={1440}
          onChange={e => onChange(`cooldown.${thresholdKey}`, parseInt(e.target.value, 10) * 60_000)}
          style={{
            width: 60, textAlign: 'right',
            background: 'rgba(255,255,255,.05)',
            border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)',
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
            padding: '5px 8px', outline: 'none',
          }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 24 }}>
          min
        </span>
        <button
          onClick={() => onReset(`cooldown.${thresholdKey}`, defaultMs)}
          title="Réinitialiser"
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-muted)',
            fontSize: 10, padding: '4px 8px', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 700,
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const [permission,  setPermission]  = useState(() => getPermissionStatus())
  const [thresholds,  setThresholds]  = useState(() => getThresholds())
  const [history,     setHistory]     = useState([])
  const [requesting,  setRequesting]  = useState(false)
  const [resetDone,   setResetDone]   = useState(false)

  useEffect(() => {
    setHistory(getNotificationHistory(30))
  }, [])

  // ── Permission ──────────────────────────────────────────────────────────────

  const handleRequestPermission = async () => {
    setRequesting(true)
    const result = await requestPermission()
    setPermission(getPermissionStatus())
    setRequesting(false)
  }

  // ── Seuils ──────────────────────────────────────────────────────────────────

  const handleThresholdChange = (key, value) => {
    const updated = updateThreshold(key, value)
    setThresholds(updated)
  }

  const handleThresholdReset = (key, defaultValue) => {
    const updated = updateThreshold(key, defaultValue)
    setThresholds(updated)
  }

  const handleResetAll = () => {
    const reset = resetThresholds()
    setThresholds(reset)
    setResetDone(true)
    setTimeout(() => setResetDone(false), 2000)
  }

  // ── Historique ──────────────────────────────────────────────────────────────

  const handleClearHistory = () => {
    clearNotificationHistory()
    setHistory([])
    setThresholds(getThresholds())  // reload cooldowns
  }

  const permissionColor = permission === 'granted'
    ? 'var(--call)'
    : permission === 'denied'
    ? 'var(--put)'
    : 'var(--text-muted)'

  const permissionLabel = {
    granted:       '✓ Autorisées',
    denied:        '✗ Refusées',
    default:       '? Non configurées',
    not_supported: '⚠ Non supportées',
  }[permission] ?? '?'

  const { DEFAULT_THRESHOLDS } = thresholds

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-title">
          Notifications <span style={{ color: 'var(--accent)' }}>Push</span>
        </div>
      </div>

      {/* ── 1. Permission ── */}
      <SectionCard title="Permission">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
              Statut actuel
            </div>
            <div style={{
              fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14, color: permissionColor,
            }}>
              {permissionLabel}
            </div>
          </div>

          {permission === 'default' && (
            <button
              onClick={handleRequestPermission}
              disabled={requesting}
              style={{
                padding: '9px 16px',
                background: 'var(--accent)',
                border: 'none', borderRadius: 9,
                color: 'var(--bg)',
                fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 12,
                cursor: requesting ? 'not-allowed' : 'pointer',
                opacity: requesting ? 0.7 : 1,
              }}
            >
              {requesting ? '…' : 'Activer'}
            </button>
          )}

          {permission === 'denied' && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 140, textAlign: 'right', lineHeight: 1.4 }}>
              Autoriser dans les réglages système.
            </span>
          )}
        </div>

        {/* iOS info */}
        {permission === 'not_supported' && (
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(255,107,53,.08)', border: '1px solid rgba(255,107,53,.3)',
            fontSize: 11, color: 'var(--accent2)', lineHeight: 1.5,
          }}>
            Notifications PWA requises : Chrome Android, Safari iOS 16.4+, ou Firefox.
            Sur iOS, installez l'app (Partager → Sur l'écran d'accueil) avant d'autoriser.
          </div>
        )}

        {/* Test panel — affiché si permission accordée */}
        {permission === 'granted' && (
          <div style={{ marginTop: 4 }}>
            <NotificationTestPanel />
          </div>
        )}

        {/* Bouton test SW si permission accordée */}
        {permission === 'granted' && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => {
                navigator.serviceWorker?.ready
                  .then(sw => sw.active?.postMessage({ type: 'TEST_NOTIFICATION' }))
                  .catch(() => {})
              }}
              style={{
                width: '100%', padding: '10px 0',
                border: '1px solid var(--border)', borderRadius: 9,
                background: 'none', color: 'var(--text-muted)',
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
                cursor: 'pointer',
              }}
            >
              🔔 Test rapide (via Service Worker)
            </button>
          </div>
        )}
      </SectionCard>

      {/* ── 2. Seuils d'alerte ── */}
      <SectionCard title="Seuils d'alerte">
        <ThresholdRow
          label="Mouvement prix (% en 1h)"
          thresholdKey="price_move_pct"
          value={thresholds.price_move_pct}
          defaultValue={5.0}
          unit="%"
          step={0.5}
          min={1}
          max={20}
          onChange={handleThresholdChange}
          onReset={handleThresholdReset}
        />
        <ThresholdRow
          label="IV Rank — seuil bas"
          thresholdKey="iv_spike_low"
          value={thresholds.iv_spike_low}
          defaultValue={50}
          unit=""
          step={5}
          min={10}
          max={90}
          onChange={handleThresholdChange}
          onReset={handleThresholdReset}
        />
        <ThresholdRow
          label="IV Rank — seuil haut"
          thresholdKey="iv_spike_high"
          value={thresholds.iv_spike_high}
          defaultValue={70}
          unit=""
          step={5}
          min={30}
          max={100}
          onChange={handleThresholdChange}
          onReset={handleThresholdReset}
        />
        <ThresholdRow
          label="Variation funding (%/an en 15min)"
          thresholdKey="funding_change_ann"
          value={thresholds.funding_change_ann}
          defaultValue={20.0}
          unit="%/an"
          step={1}
          min={5}
          max={100}
          onChange={handleThresholdChange}
          onReset={handleThresholdReset}
        />
        <ThresholdRow
          label="Liquidations (M$ en 1h)"
          thresholdKey="liquidations_usd"
          value={thresholds.liquidations_usd / 1_000_000}
          defaultValue={50}
          unit="M$"
          step={10}
          min={10}
          max={500}
          onChange={(k, v) => handleThresholdChange(k, v * 1_000_000)}
          onReset={(k, v)  => handleThresholdReset(k, v * 1_000_000)}
        />
        <ThresholdRow
          label="Settlement écart vs spot (%)"
          thresholdKey="settlement_delta_pct"
          value={thresholds.settlement_delta_pct}
          defaultValue={0.3}
          unit="%"
          step={0.1}
          min={0}
          max={5}
          onChange={handleThresholdChange}
          onReset={handleThresholdReset}
        />

        <button
          onClick={handleResetAll}
          style={{
            width: '100%', marginTop: 8, padding: '9px 0',
            border: '1px solid var(--border)', borderRadius: 9,
            background: resetDone ? 'rgba(0,229,160,.08)' : 'none',
            color: resetDone ? 'var(--call)' : 'var(--text-muted)',
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11,
            cursor: 'pointer', transition: 'all .2s',
          }}
        >
          {resetDone ? '✓ Réinitialisés' : 'Réinitialiser tous les seuils'}
        </button>
      </SectionCard>

      {/* ── 3. Anti-spam (cooldowns) ── */}
      <SectionCard title="Anti-spam (délai entre alertes)">
        {[
          { label: 'Mouvement prix',  key: 'price_move',    ms: thresholds.cooldown?.price_move    ?? 1800000, def: 30  },
          { label: 'IV Spike',        key: 'iv_spike',      ms: thresholds.cooldown?.iv_spike      ?? 3600000, def: 60  },
          { label: 'Funding',         key: 'funding_change',ms: thresholds.cooldown?.funding_change?? 900000,  def: 15  },
          { label: 'Liquidations',    key: 'liquidations',  ms: thresholds.cooldown?.liquidations  ?? 1800000, def: 30  },
          { label: 'Signal',          key: 'signal_change', ms: thresholds.cooldown?.signal_change ?? 1800000, def: 30  },
          { label: 'Anomalie',        key: 'anomaly',       ms: thresholds.cooldown?.anomaly       ?? 1800000, def: 30  },
        ].map(({ label, key, ms, def }, i, arr) => (
          <CooldownRow
            key={key}
            label={label}
            thresholdKey={key}
            valueMs={ms}
            defaultMs={def * 60_000}
            onChange={handleThresholdChange}
            onReset={handleThresholdReset}
            last={i === arr.length - 1}
          />
        ))}
      </SectionCard>

      {/* ── 4. Historique ── */}
      <SectionCard title="Dernières notifications">
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
            Aucune notification envoyée
          </div>
        ) : (
          <>
            {history.slice(0, 20).map((h, i) => {
              const { dot, color } = levelDot(h.level)
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  paddingBottom: i < Math.min(history.length, 20) - 1 ? 10 : 0,
                  marginBottom: i < Math.min(history.length, 20) - 1 ? 10 : 0,
                  borderBottom: i < Math.min(history.length, 20) - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                }}>
                  <span style={{ color, fontSize: 8, marginTop: 4 }}>{dot}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--sans)', fontWeight: 700, lineHeight: 1.3 }}>
                      {h.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>
                      {h.body}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatTs(h.timestamp)}
                  </span>
                </div>
              )
            })}

            <button
              onClick={handleClearHistory}
              style={{
                width: '100%', marginTop: 12, padding: '9px 0',
                border: '1px solid rgba(255,77,109,.2)', borderRadius: 9,
                background: 'rgba(255,77,109,.05)',
                color: 'var(--put)',
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Effacer l'historique et réinitialiser les cooldowns
            </button>
          </>
        )}
      </SectionCard>

      {/* Note VAPID */}
      <div style={{
        padding: '10px 14px', borderRadius: 10,
        background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
        marginBottom: 14,
      }}>
        ℹ︎ Ces notifications fonctionnent quand l'app est ouverte ou en arrière-plan.
        Pour les notifications app complètement fermée, un backend VAPID est requis (non implémenté).
      </div>
    </div>
  )
}
