/**
 * pages/CalibrationPage.jsx
 *
 * Page de calibration des paramètres de détection des signaux et patterns.
 *
 * Sections :
 *   1. Filtre DVOL         — seuils marché calme / agité
 *   2. Score IV            — ratios IV / moyenne 30j
 *   3. Score Funding       — seuils taux de funding annualisé
 *   4. Score Basis         — seuils basis futures
 *   5. Score IV/RV         — prime IV sur volatilité réalisée
 *   6. Signal global       — seuils de classification du score composite
 *   7. Anomalies           — nb indicateurs et fenêtre de détection
 *   8. Patterns (bucketing) — seuils mouvements prix, spread, L/S, basis
 *   9. Positioning         — seuils L/S Ratio et P/C Ratio
 *  10. Convergence         — critères et minimums
 *  11. On-Chain            — Fear & Greed, Hash Rate, score interprétation
 */

import { useState } from 'react'
import {
  getCalibration,
  updateCalibration,
  resetCalibration,
  DEFAULT_CALIBRATION,
} from '../../signals/signal_calibration.js'

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 14,
    }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
          fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        }}>
          {title}
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  )
}

// ── ParamRow ──────────────────────────────────────────────────────────────────

function ParamRow({ label, paramKey, value, defaultValue, unit, step, min, max, last, onChange, onReset }) {
  const isDirty = value !== defaultValue
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: last ? 0 : 12, marginBottom: last ? 0 : 12,
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,.04)',
    }}>
      <span style={{ fontSize: 12, color: isDirty ? 'var(--text)' : 'var(--text-muted)', flex: 1, lineHeight: 1.4 }}>
        {label}
        {isDirty && <span style={{ fontSize: 9, color: 'var(--atm)', marginLeft: 5 }}>●</span>}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={value}
          step={step ?? 1}
          min={min ?? 0}
          max={max ?? 1000}
          onChange={e => onChange(paramKey, parseFloat(e.target.value))}
          style={{
            width: 72, textAlign: 'right',
            background: isDirty ? 'rgba(255,215,0,.06)' : 'rgba(255,255,255,.05)',
            border: `1px solid ${isDirty ? 'rgba(255,215,0,.3)' : 'var(--border)'}`,
            borderRadius: 6, color: 'var(--text)',
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
            padding: '5px 8px', outline: 'none',
          }}
        />
        {unit && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 36 }}>{unit}</span>
        )}
        <button
          onClick={() => onReset(paramKey, defaultValue)}
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

// ── WeightRow ─────────────────────────────────────────────────────────────────

function WeightRow({ label, paramKey, value, defaultValue, last, onChange, onReset }) {
  const isDirty = value !== defaultValue
  const pct = Math.round(value * 100)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: last ? 0 : 12, marginBottom: last ? 0 : 12,
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,.04)',
      gap: 8,
    }}>
      <span style={{ fontSize: 12, color: isDirty ? 'var(--text)' : 'var(--text-muted)', flex: 1, lineHeight: 1.4 }}>
        {label}
        {isDirty && <span style={{ fontSize: 9, color: 'var(--atm)', marginLeft: 5 }}>●</span>}
      </span>
      <input
        type="range"
        min={0} max={100} step={1}
        value={pct}
        onChange={e => onChange(paramKey, parseFloat(e.target.value) / 100)}
        style={{ width: 90, accentColor: isDirty ? 'var(--atm)' : 'var(--accent)' }}
      />
      <span style={{
        fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
        color: isDirty ? 'var(--atm)' : 'var(--text)',
        minWidth: 38, textAlign: 'right',
      }}>
        {pct}%
      </span>
      <button
        onClick={() => onReset(paramKey, defaultValue)}
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
  )
}

// ── WeightScenarioSection ─────────────────────────────────────────────────────

function WeightScenarioSection({ title, keys, labels, cfg, defaults, onChange, onReset, onNormalize }) {
  const total = keys.reduce((sum, k) => sum + (cfg[k] ?? defaults[k]), 0)
  const totalPct = Math.round(total * 100)
  const isValid = totalPct === 100
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        {title && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            {title}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span style={{
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
            color: isValid ? 'var(--call)' : 'var(--put)',
          }}>
            Total : {totalPct}%
          </span>
          {!isValid && (
            <button
              onClick={() => onNormalize(keys)}
              style={{
                background: 'rgba(255,215,0,.08)', border: '1px solid rgba(255,215,0,.3)',
                borderRadius: 6, color: 'var(--atm)',
                fontSize: 10, padding: '3px 8px', cursor: 'pointer',
                fontFamily: 'var(--sans)', fontWeight: 700,
              }}
            >
              Normaliser
            </button>
          )}
        </div>
      </div>
      {keys.map((k, i) => (
        <WeightRow
          key={k}
          label={labels[i]}
          paramKey={k}
          value={cfg[k] ?? defaults[k]}
          defaultValue={defaults[k]}
          last={i === keys.length - 1}
          onChange={onChange}
          onReset={onReset}
        />
      ))}
    </div>
  )
}

// ── CollapsibleScenario ───────────────────────────────────────────────────────

function CollapsibleScenario({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: 10, marginTop: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700,
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px',
          padding: '4px 0', marginBottom: open ? 12 : 0,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function CalibrationPage() {
  const [cfg, setCfg]         = useState(() => getCalibration())
  const [resetDone, setResetDone] = useState(false)

  const handleChange = (key, value) => {
    if (isNaN(value)) return
    const updated = updateCalibration(key, value)
    setCfg(updated)
  }

  const handleReset = (key, defaultValue) => {
    const updated = updateCalibration(key, defaultValue)
    setCfg(updated)
  }

  const handleResetAll = () => {
    const reset = resetCalibration()
    setCfg(reset)
    setResetDone(true)
    setTimeout(() => setResetDone(false), 2000)
  }

  const handleNormalize = (keys) => {
    const raw = keys.map(k => cfg[k] ?? DEFAULT_CALIBRATION[k])
    const sum = raw.reduce((a, b) => a + b, 0)
    if (sum === 0) return
    const scaled = raw.map(v => Math.round((v / sum) * 100) / 100)
    const residual = Math.round((1 - scaled.reduce((a, b) => a + b, 0)) * 100) / 100
    scaled[0] = Math.round((scaled[0] + residual) * 100) / 100
    let current = { ...cfg }
    keys.forEach((k, i) => {
      current = { ...current, [k]: scaled[i] }
      updateCalibration(k, scaled[i])
    })
    setCfg(current)
  }

  const p = (key, label, unit, step, min, max, last = false) => (
    <ParamRow
      key={key}
      label={label}
      paramKey={key}
      value={cfg[key]}
      defaultValue={DEFAULT_CALIBRATION[key]}
      unit={unit}
      step={step}
      min={min}
      max={max}
      last={last}
      onChange={handleChange}
      onReset={handleReset}
    />
  )

  const dirtyCount = Object.keys(DEFAULT_CALIBRATION).filter(k => cfg[k] !== DEFAULT_CALIBRATION[k]).length

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-title">
          Calibration <span style={{ color: 'var(--accent)' }}>Signaux</span>
        </div>
      </div>

      {/* Info banner */}
      <div style={{
        padding: '10px 14px', borderRadius: 10, marginBottom: 14,
        background: dirtyCount > 0 ? 'rgba(255,215,0,.05)' : 'rgba(255,255,255,.03)',
        border: `1px solid ${dirtyCount > 0 ? 'rgba(255,215,0,.25)' : 'var(--border)'}`,
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
      }}>
        {dirtyCount > 0
          ? `⚙ ${dirtyCount} paramètre${dirtyCount > 1 ? 's' : ''} modifié${dirtyCount > 1 ? 's' : ''} — les scores et patterns utilisent ces valeurs en temps réel.`
          : 'Ajustez les seuils de détection des signaux, du score composite et des patterns.'}
      </div>

      {/* 1. Filtre DVOL */}
      <SectionCard title="Filtre DVOL — qualité de signal">
        {p('dvol_calm_max',     'DVOL < seuil → marché trop calme (facteur ×0.7)',    '',  1, 10, 60)}
        {p('dvol_agitated_min', 'DVOL ≥ seuil → marché trop agité (facteur ×0.8)',   '',  1, 50, 150, true)}
      </SectionCard>

      {/* 2. Score IV */}
      <SectionCard title="Score IV (ratio courant / moyenne 30j)">
        {p('iv_ratio_t1', 'Ratio < t1 → score 0',    '', 0.01, 0.5, 1.5)}
        {p('iv_ratio_t2', 'Ratio ≥ t1 → score 25',   '', 0.01, 0.5, 1.5)}
        {p('iv_ratio_t3', 'Ratio ≥ t2 → score 50',   '', 0.01, 0.5, 1.5)}
        {p('iv_ratio_t4', 'Ratio ≥ t3 → score 75 / ≥ t4 → 100', '', 0.01, 0.5, 2.0, true)}
      </SectionCard>

      {/* 3. Score Funding */}
      <SectionCard title="Score Funding (taux annualisé en %)">
        {p('funding_t1', 'Taux < t1 → score 0',             '%/an', 1, -100, 0)}
        {p('funding_t2', 'Taux ≥ t1 → score 25',            '%/an', 1, 0, 50)}
        {p('funding_t3', 'Taux ≥ t2 → score 50',            '%/an', 1, 0, 100)}
        {p('funding_t4', 'Taux ≥ t3 → score 75 / ≥ t4 → 100', '%/an', 1, 0, 200, true)}
      </SectionCard>

      {/* 4. Score Basis */}
      <SectionCard title="Score Basis (basis annualisé en %)">
        {p('basis_score_t1', 'Basis < t1 → score 0',               '%', 0.5, -20, 10)}
        {p('basis_score_t2', 'Basis ≥ t1 → score 25',              '%', 0.5, 0, 20)}
        {p('basis_score_t3', 'Basis ≥ t2 → score 50',              '%', 0.5, 0, 30)}
        {p('basis_score_t4', 'Basis ≥ t3 → score 75 / ≥ t4 → 100','%', 0.5, 0, 50, true)}
      </SectionCard>

      {/* 5. Score IV/RV */}
      <SectionCard title="Score IV/RV (prime IV − RV en points)">
        {p('ivvsrv_t1', 'Prime < t1 → score 0',             'pts', 1, -50, 20)}
        {p('ivvsrv_t2', 'Prime ≥ t1 → score 50 (seuil bas)','pts', 1, 0, 50)}
        {p('ivvsrv_t3', 'Prime ≥ t2 → score 100 (seuil haut)','pts', 1, 0, 100, true)}
      </SectionCard>

      {/* 6. Signal global */}
      <SectionCard title="Signal global (seuils du score composite)">
        {p('signal_unfav_max', 'Score < seuil → Défavorable', '', 1, 0,  60)}
        {p('signal_neutr_max', 'Score ≥ seuil → Favorable',   '', 1, 20, 80)}
        {p('signal_fav_max',   'Score ≥ seuil → Exceptionnel','', 1, 40, 100, true)}
      </SectionCard>

      {/* 7. Détection d'anomalies */}
      <SectionCard title="Détection d'anomalies">
        {p('anomaly_threshold', 'Nb min. d\'indicateurs simultanés', '',   1,    1,   10)}
        {p('anomaly_window_ms', 'Fenêtre de comparaison',            'ms', 1000, 1000, 60000, true)}
      </SectionCard>

      {/* 8. Bucketing des patterns */}
      <SectionCard title="Bucketing des patterns">
        {p('move_small',      'Zone plate : ±seuil (%)',             '%', 0.01, 0.01, 2)}
        {p('move_big',        'Grand mouvement : > seuil (%)',       '%', 0.1,  0.5, 20)}
        {p('spread_tight_max','Spread tight si <',                   '%', 0.01, 0.01, 1)}
        {p('spread_wide_min', 'Spread wide si ≥',                    '%', 0.05, 0.1, 5)}
        {p('ls_short_max',    'L/S short_heavy si ≤',                '',  0.05, 0.3, 1)}
        {p('ls_long_min',     'L/S long_heavy si ≥',                 '',  0.05, 1, 3)}
        {p('basis_back_max',  'Basis backwardation si <',            '%', 0.5, -20, 0)}
        {p('basis_flat_max',  'Basis flat si < (limite haute)',      '%', 0.5, 0, 20)}
        {p('basis_high_min',  'Basis high_contango si ≥',           '%', 0.5, 2, 50, true)}
      </SectionCard>

      {/* 9. Positioning */}
      <SectionCard title="Positioning — L/S Ratio (retail)">
        {p('ls_bullish',     'L/S bullish si ≥',         '', 0.05, 0.5, 3)}
        {p('ls_bearish',     'L/S bearish si ≤',         '', 0.05, 0.3, 1)}
        {p('ls_strong_bull', 'L/S fortement bullish si ≥','', 0.05, 1, 4)}
        {p('ls_strong_bear', 'L/S fortement bearish si ≤','', 0.05, 0.2, 0.9, true)}
      </SectionCard>

      <SectionCard title="Positioning — P/C Ratio (institutionnel)">
        {p('pc_bullish',     'P/C bullish si <',          '', 0.05, 0.3, 1.5)}
        {p('pc_bearish',     'P/C bearish si >',          '', 0.05, 0.5, 2)}
        {p('pc_strong_bull', 'P/C fortement bullish si <','', 0.05, 0.2, 1)}
        {p('pc_strong_bear', 'P/C fortement bearish si >','', 0.05, 0.5, 3, true)}
      </SectionCard>

      {/* 10. Convergence */}
      <SectionCard title="Convergence des critères">
        {p('conv_min_hist', 'Points min. pour seuils dynamiques', '',  1, 5,  100)}
        {p('conv_min',      'Critères min. → signal modéré',      '',  1, 1,  10)}
        {p('conv_strong',   'Critères min. → signal fort',        '',  1, 2,  10, true)}
      </SectionCard>

      {/* 11. On-Chain */}
      <SectionCard title="On-Chain — Fear & Greed">
        {p('fg_extreme_fear', 'Indice ≤ seuil → Peur extrême', '', 1, 0,  40)}
        {p('fg_fear',         'Indice ≤ seuil → Peur',         '', 1, 10, 60)}
        {p('fg_neutral',      'Indice ≤ seuil → Neutre',       '', 1, 30, 70)}
        {p('fg_greed',        'Indice ≤ seuil → Avidité',      '', 1, 50, 100)}
        {p('fg_delta',        'Variation significative (momentum)', 'pts', 1, 1, 20, true)}
      </SectionCard>

      <SectionCard title="On-Chain — Hash Rate & Score">
        {p('hashrate_bull',    'Hash rate > seuil → bullish (%/7j)',  '%', 1, 0,  30)}
        {p('hashrate_bear',    'Hash rate < seuil → bearish (%/7j)',  '%', 1, -30, 0)}
        {p('onchain_favorable','Score on-chain ≥ → favorable',        '', 1, 50, 100)}
        {p('onchain_neutral',  'Score on-chain ≥ → neutre',           '', 1, 30, 80)}
        {p('onchain_weak',     'Score on-chain ≤ → faible',           '', 1, 0,  60, true)}
      </SectionCard>

      {/* 12. Pondération des composantes */}
      <SectionCard title="Pondération des composantes (score composite)">

        <WeightScenarioSection
          title="Scénario complet — s1 à s6"
          keys={[
            'w_complete_s1_iv',
            'w_complete_s2_funding',
            'w_complete_s3_basis',
            'w_complete_s4_ivVsRv',
            'w_complete_s5_onChain',
            'w_complete_s6_positioning',
          ]}
          labels={[
            'Rang IV (DVOL vs moy. 30j)',
            'Taux de Financement',
            'Basis Futures',
            'Prime IV / Volatilité Réalisée',
            'On-Chain (Fear & Greed, Hash Rate)',
            'Positionnement (L/S + P/C)',
          ]}
          cfg={cfg}
          defaults={DEFAULT_CALIBRATION}
          onChange={handleChange}
          onReset={handleReset}
          onNormalize={handleNormalize}
        />

        <CollapsibleScenario title="Sans positionnement — s1 à s5">
          <WeightScenarioSection
            title=""
            keys={[
              'w_nopos_s1_iv',
              'w_nopos_s2_funding',
              'w_nopos_s3_basis',
              'w_nopos_s4_ivVsRv',
              'w_nopos_s5_onChain',
            ]}
            labels={[
              'Rang IV',
              'Taux de Financement',
              'Basis Futures',
              'Prime IV / Volatilité Réalisée',
              'On-Chain',
            ]}
            cfg={cfg}
            defaults={DEFAULT_CALIBRATION}
            onChange={handleChange}
            onReset={handleReset}
            onNormalize={handleNormalize}
          />
        </CollapsibleScenario>

        <CollapsibleScenario title="Minimal — s1 à s4 uniquement">
          <WeightScenarioSection
            title=""
            keys={[
              'w_min_s1_iv',
              'w_min_s2_funding',
              'w_min_s3_basis',
              'w_min_s4_ivVsRv',
            ]}
            labels={[
              'Rang IV',
              'Taux de Financement',
              'Basis Futures',
              'Prime IV / Volatilité Réalisée',
            ]}
            cfg={cfg}
            defaults={DEFAULT_CALIBRATION}
            onChange={handleChange}
            onReset={handleReset}
            onNormalize={handleNormalize}
          />
        </CollapsibleScenario>

        <div style={{
          marginTop: 14, padding: '8px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
          fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6,
        }}>
          Le scénario actif est sélectionné automatiquement selon la disponibilité des données
          (on-chain et positionnement). Les trois scénarios peuvent être calibrés indépendamment.
        </div>

      </SectionCard>

      {/* Reset global */}
      <button
        onClick={handleResetAll}
        style={{
          width: '100%', marginBottom: 20, padding: '12px 0',
          border: `1px solid ${resetDone ? 'rgba(0,229,160,.3)' : 'var(--border)'}`,
          borderRadius: 10,
          background: resetDone ? 'rgba(0,229,160,.08)' : 'none',
          color: resetDone ? 'var(--call)' : 'var(--text-muted)',
          fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
          cursor: 'pointer', transition: 'all .2s',
        }}
      >
        {resetDone ? '✓ Tous les paramètres réinitialisés' : 'Réinitialiser tous les paramètres'}
      </button>
    </div>
  )
}
