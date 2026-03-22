/**
 * components/NotificationTestPanel.jsx
 *
 * Panneau de test des notifications — intégré dans NotificationSettingsPage.
 *
 * Permet de :
 *   1. Sélectionner un type de notification parmi les 15 types disponibles
 *   2. Prévisualiser le titre et le corps dans un mockup iOS/Android
 *   3. Éditer le contenu avant envoi
 *   4. Envoyer la notification avec bypass cooldown (forceTest: true)
 *   5. Voir le feedback en temps réel
 */

import { useState } from 'react'
import { sendNotification } from '../data_processing/signals/notification_manager.js'

// ── Données de test par type ───────────────────────────────────────────────────

const NOTIFICATION_TESTS = {
  price_move_btc: {
    label: 'Mouvement Prix BTC',
    level: 'critical',
    asset: 'BTC',
    icon:  '🔴',
    default: {
      title: '◈ BTC ↓ -5.2% en 1h',
      body:  'Prix actuel : $67,834 · Il y a 1h : $71,543',
    },
    context: { asset: 'BTC', changePct: -5.2, priceCurrent: 67834, priceOld: 71543 },
  },
  price_move_eth: {
    label: 'Mouvement Prix ETH',
    level: 'critical',
    asset: 'ETH',
    icon:  '🔴',
    default: {
      title: '◈ ETH ↑ +5.8% en 1h',
      body:  'Prix actuel : $3,842 · Il y a 1h : $3,634',
    },
    context: { asset: 'ETH', changePct: 5.8, priceCurrent: 3842, priceOld: 3634 },
  },
  anomaly_critical: {
    label: 'Anomalie Critique',
    level: 'critical',
    asset: 'BTC',
    icon:  '🔴',
    default: {
      title: '◈ Anomalie critique · BTC',
      body:  '5 indicateurs simultanés : spreadPct, fundingBinance, ivRank, lsRatio +2',
    },
    context: { count: 5, indicators: ['spreadPct', 'fundingBinance', 'ivRank', 'lsRatio', 'oiDelta'] },
  },
  liquidations: {
    label: 'Liquidations Massives',
    level: 'critical',
    asset: 'BTC',
    icon:  '🔴',
    default: {
      title: '◈ Liquidations massives · BTC',
      body:  '$73M liquidés en 1h sur Binance',
    },
    context: { totalUSD: 73_000_000, windowMin: 60 },
  },
  iv_spike_btc: {
    label: 'IV Rank Spike BTC',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ IV Rank spike · BTC',
      body:  'IV Rank : 44 → 74 en 3h',
    },
    context: { asset: 'BTC', ivPrevious: 44, ivCurrent: 74, elapsedHours: 3 },
  },
  iv_spike_eth: {
    label: 'IV Rank Spike ETH',
    level: 'alert',
    asset: 'ETH',
    icon:  '🟡',
    default: {
      title: '◈ IV Rank spike · ETH',
      body:  'IV Rank : 38 → 71 en 2h',
    },
    context: { asset: 'ETH', ivPrevious: 38, ivCurrent: 71, elapsedHours: 2 },
  },
  funding_change_btc: {
    label: 'Funding Spike BTC',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ Funding ↑ · BTC',
      body:  '+38.4%/an (variation +22.1% en 15min)',
    },
    context: { asset: 'BTC', fundingCurrent: 38.4, fundingOld: 16.3, windowMin: 15 },
  },
  funding_change_eth: {
    label: 'Funding Spike ETH',
    level: 'alert',
    asset: 'ETH',
    icon:  '🟡',
    default: {
      title: '◈ Funding ↑ · ETH',
      body:  '+24.1%/an (variation +20.8% en 15min)',
    },
    context: { asset: 'ETH', fundingCurrent: 24.1, fundingOld: 3.3, windowMin: 15 },
  },
  signal_change_btc: {
    label: 'Changement Signal BTC',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ Signal BTC : 🔥 Exceptionnel',
      body:  '↓ Défavorable → 🔥 Exceptionnel · Score 91/100',
    },
    context: { asset: 'BTC', previous: '↓ Défavorable', current: '🔥 Exceptionnel', score: 91 },
  },
  signal_change_eth: {
    label: 'Changement Signal ETH',
    level: 'alert',
    asset: 'ETH',
    icon:  '🟡',
    default: {
      title: '◈ Signal ETH : ✓ Favorable',
      body:  '~ Neutre → ✓ Favorable · Score 67/100',
    },
    context: { asset: 'ETH', previous: '~ Neutre', current: '✓ Favorable', score: 67 },
  },
  settlement_weekly: {
    label: 'Settlement Hebdo BTC',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ Settlement Hebdomadaire · BTC',
      body:  '$71,234 · -0.12% vs spot',
    },
    context: { asset: 'BTC', settlementPrice: 71234, spotDelta: -0.12, priority: 'Hebdomadaire' },
  },
  anomaly_warning: {
    label: 'Anomalie Warning',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ Anomalie détectée · BTC',
      body:  '3 indicateurs simultanés : spreadPct, fundingBinance, ivRank',
    },
    context: { count: 3, indicators: ['spreadPct', 'fundingBinance', 'ivRank'] },
  },
  expiry_1h: {
    label: 'Expiration dans 1h',
    level: 'alert',
    asset: 'BTC',
    icon:  '🟡',
    default: {
      title: '◈ Expiration dans 1h · BTC',
      body:  'Échéance 31JAN25 · 47min restantes',
    },
    context: { asset: 'BTC', expiryStr: '31JAN25', minutesLeft: 47 },
  },
  expiry_24h: {
    label: 'Expiration dans 24h',
    level: 'info',
    asset: 'BTC',
    icon:  '⚪',
    default: {
      title: '◈ Expiration demain · BTC',
      body:  'Échéance 31JAN25 dans 23h',
    },
    context: { asset: 'BTC', expiryStr: '31JAN25', hoursLeft: 23 },
  },
  funding_fixing: {
    label: 'Funding Fixing 30min',
    level: 'info',
    asset: 'ALL',
    icon:  '⚪',
    default: {
      title: '◈ Funding fixing dans 28min',
      body:  'Prochain fixing Binance à 16:00 UTC',
    },
    context: { minutesLeft: 28, fixingHour: 16 },
  },
}

// ── Groupement par niveau ─────────────────────────────────────────────────────

const GROUPS = [
  {
    label: 'CRITIQUE',
    dot:   '🔴',
    color: '#FF4D6D',
    bg:    'rgba(255,77,109,.08)',
    border:'rgba(255,77,109,.3)',
    keys:  ['price_move_btc', 'price_move_eth', 'anomaly_critical', 'liquidations'],
  },
  {
    label: 'ALERTE',
    dot:   '🟡',
    color: '#FFD700',
    bg:    'rgba(255,215,0,.08)',
    border:'rgba(255,215,0,.3)',
    keys:  [
      'iv_spike_btc', 'iv_spike_eth',
      'funding_change_btc', 'funding_change_eth',
      'signal_change_btc', 'signal_change_eth',
      'settlement_weekly', 'anomaly_warning', 'expiry_1h',
    ],
  },
  {
    label: 'INFO',
    dot:   '⚪',
    color: 'var(--accent)',
    bg:    'rgba(0,212,255,.07)',
    border:'rgba(0,212,255,.25)',
    keys:  ['expiry_24h', 'funding_fixing'],
  },
]

// ── Indicateur vibration ──────────────────────────────────────────────────────

function VibrationDots({ level }) {
  const dots    = level === 'critical' ? 5 : level === 'alert' ? 3 : 1
  const dotColor = level === 'critical' ? '#FF4D6D' : level === 'alert' ? '#FFD700' : 'var(--text-muted)'
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: dotColor, display: 'inline-block',
        }} />
      ))}
    </span>
  )
}

// ── Compteur de caractères ────────────────────────────────────────────────────

function CharCount({ value, max }) {
  const pct   = value.length / max
  const color = pct >= 0.9 ? '#FF4D6D' : pct >= 0.7 ? '#FFD700' : 'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, color, fontFamily: 'var(--sans)', fontWeight: 700 }}>
      {value.length}/{max}
    </span>
  )
}

// ── NotificationTestPanel ─────────────────────────────────────────────────────

export default function NotificationTestPanel() {
  const [selectedType,  setSelectedType]  = useState(null)
  const [editTitle,     setEditTitle]     = useState('')
  const [editBody,      setEditBody]      = useState('')
  const [isSending,     setIsSending]     = useState(false)
  const [sentFeedback,  setSentFeedback]  = useState(null)
  const [sentOk,        setSentOk]        = useState(false)

  const isSupported = 'Notification' in window

  // ── Sélection d'un type ───────────────────────────────────────────────────

  const handleSelect = (typeKey) => {
    const test = NOTIFICATION_TESTS[typeKey]
    setSelectedType(typeKey)
    setEditTitle(test.default.title)
    setEditBody(test.default.body)
    setSentFeedback(null)
    setSentOk(false)
  }

  // ── Reset aux valeurs par défaut ──────────────────────────────────────────

  const handleReset = () => {
    if (!selectedType) return
    const test = NOTIFICATION_TESTS[selectedType]
    setEditTitle(test.default.title)
    setEditBody(test.default.body)
    setSentFeedback(null)
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!selectedType || isSending) return
    setIsSending(true)

    const test = NOTIFICATION_TESTS[selectedType]

    try {
      const success = await sendNotification({
        type:      selectedType,
        asset:     test.asset,
        level:     test.level,
        title:     editTitle,
        body:      editBody,
        tag:       `test_${selectedType}`,
        data:      { page: 'test', context: test.context },
        forceTest: true,
      })

      setSentOk(success)
      setSentFeedback(
        success
          ? '✓ Notification envoyée ! Vérifie ton écran ou le panneau de notifications.'
          : '⚠ Erreur — vérifie les permissions dans les réglages système.'
      )
    } catch (_) {
      setSentOk(false)
      setSentFeedback('⚠ Erreur inattendue lors de l\'envoi.')
    }

    setIsSending(false)
    setTimeout(() => setSentFeedback(null), 4000)
  }

  const selected = selectedType ? NOTIFICATION_TESTS[selectedType] : null
  const now      = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  const levelColors = {
    critical: '#FF4D6D',
    alert:    '#FFD700',
    info:     'var(--accent)',
  }
  const levelLabels = {
    critical: 'CRITIQUE',
    alert:    'ALERTE',
    info:     'INFO',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Titre section */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
        Test des notifications
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        Sélectionne un type, modifie le contenu si besoin, envoie.
      </div>

      {/* ── Sélection par groupe ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {GROUPS.map(group => (
          <div key={group.label}>
            {/* Label de groupe */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{
                fontSize: 9, color: group.color, fontFamily: 'var(--sans)',
                fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase',
                flexShrink: 0,
              }}>
                {group.dot} {group.label}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Boutons du groupe */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {group.keys.map(key => {
                const test      = NOTIFICATION_TESTS[key]
                const isSelected = selectedType === key
                return (
                  <button
                    key={key}
                    onClick={() => handleSelect(key)}
                    style={{
                      padding:      '6px 11px',
                      borderRadius: 8,
                      border:       `1px solid ${isSelected ? group.border : 'var(--border)'}`,
                      background:   isSelected ? group.bg : 'rgba(255,255,255,.03)',
                      color:        isSelected ? group.color : 'var(--text-muted)',
                      fontSize:     11,
                      fontFamily:   'var(--sans)',
                      fontWeight:   700,
                      cursor:       'pointer',
                      transition:   'all .15s',
                    }}
                  >
                    {test.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Prévisualisation + édition ── */}
      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>

          {/* Mockup notification */}
          <div style={{
            background:   'rgba(255,255,255,.04)',
            border:       `1px solid ${levelColors[selected.level]}40`,
            borderRadius: 14,
            padding:      '12px 14px',
            position:     'relative',
            overflow:     'hidden',
          }}>
            {/* Barre colorée gauche */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: 3, background: levelColors[selected.level],
              borderRadius: '14px 0 0 14px',
            }} />

            <div style={{ paddingLeft: 6 }}>
              {/* Header mockup */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700 }}>
                  ◈ Veridex
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{now}</span>
              </div>

              {/* Titre */}
              <div style={{
                fontSize: 13, fontFamily: 'var(--sans)', fontWeight: 800,
                color: 'var(--text)', lineHeight: 1.3, marginBottom: 4,
              }}>
                {editTitle}
              </div>

              {/* Corps */}
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {editBody}
              </div>

              {/* Footer badge + vibration */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{
                  fontSize: 9, fontFamily: 'var(--sans)', fontWeight: 800,
                  color: levelColors[selected.level],
                  background: `${levelColors[selected.level]}18`,
                  border: `1px solid ${levelColors[selected.level]}40`,
                  borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase',
                }}>
                  {levelLabels[selected.level]}
                </span>
                <VibrationDots level={selected.level} />
              </div>
            </div>
          </div>

          {/* Champ titre */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                Titre
              </span>
              <CharCount value={editTitle} max={100} />
            </div>
            <input
              type="text"
              value={editTitle}
              maxLength={100}
              onChange={e => setEditTitle(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                background:   'var(--bg)',
                border:       '1px solid var(--border)',
                borderRadius: 8,
                color:        'var(--text)',
                fontFamily:   'IBM Plex Mono, monospace',
                fontSize:     12,
                padding:      '9px 12px',
                outline:      'none',
              }}
              onFocus={e  => { e.target.style.borderColor = 'var(--accent)' }}
              onBlur={e   => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>

          {/* Champ corps */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                Corps
              </span>
              <CharCount value={editBody} max={200} />
            </div>
            <textarea
              rows={3}
              value={editBody}
              maxLength={200}
              onChange={e => setEditBody(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                background:   'var(--bg)',
                border:       '1px solid var(--border)',
                borderRadius: 8,
                color:        'var(--text)',
                fontFamily:   'IBM Plex Mono, monospace',
                fontSize:     12,
                padding:      '9px 12px',
                outline:      'none',
                resize:       'vertical',
                lineHeight:   1.5,
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
              onBlur={e  => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>

          {/* Boutons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleReset}
              style={{
                flex:         1,
                padding:      '9px 0',
                border:       '1px solid var(--border)',
                borderRadius: 9,
                background:   'none',
                color:        'var(--text-muted)',
                fontSize:     11,
                fontFamily:   'var(--sans)',
                fontWeight:   700,
                cursor:       'pointer',
              }}
            >
              Reset au défaut
            </button>

            <button
              onClick={handleSend}
              disabled={isSending || !isSupported}
              style={{
                flex:         2,
                padding:      '9px 0',
                border:       'none',
                borderRadius: 9,
                background:   isSending ? 'rgba(0,212,255,.15)' : 'var(--accent)',
                color:        isSending ? 'var(--accent)' : 'var(--bg)',
                fontSize:     12,
                fontFamily:   'var(--sans)',
                fontWeight:   800,
                cursor:       isSending ? 'not-allowed' : 'pointer',
                transition:   'background .2s',
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                gap:          6,
              }}
            >
              {isSending ? (
                <>
                  <span style={{ animation: 'spin .7s linear infinite', display: 'inline-block' }}>⟳</span>
                  Envoi…
                </>
              ) : (
                '📱 Envoyer la notification →'
              )}
            </button>
          </div>

          {/* Feedback */}
          {sentFeedback && (
            <div style={{
              padding:      '10px 14px',
              borderRadius: 10,
              background:   sentOk ? 'rgba(0,229,160,.08)' : 'rgba(255,77,109,.08)',
              border:       `1px solid ${sentOk ? 'rgba(0,229,160,.3)' : 'rgba(255,77,109,.3)'}`,
              color:        sentOk ? 'var(--call)' : 'var(--put)',
              fontSize:     12,
              fontFamily:   'var(--sans)',
              fontWeight:   600,
              lineHeight:   1.5,
            }}>
              {sentFeedback}
            </div>
          )}

          {/* Message si non supporté */}
          {!isSupported && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'rgba(255,107,53,.08)', border: '1px solid rgba(255,107,53,.3)',
              color: 'var(--accent2)', fontSize: 12, lineHeight: 1.5,
            }}>
              Les notifications ne sont pas supportées sur ce navigateur ou cette version iOS.
              Requis : Chrome / Safari iOS 16.4+ / Firefox.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
