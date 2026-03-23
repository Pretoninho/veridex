/**
 * SnapshotManager.jsx
 *
 * Interface de gestion des snapshots de patterns de marché.
 *
 * Sections :
 *   1. Génération — générer un snapshot et le télécharger en JSON
 *   2. Historique de chaîne — liste des hashes locaux (BTC / ETH)
 *   3. Import test — coller une URL ou un JSON pour tester l'import
 */

import { useState, useEffect, useCallback } from 'react'
import {
  generateSnapshot,
  verifySnapshot,
  snapshotToJSON,
  snapshotFromJSON,
  getSnapshotHistory,
} from '../../signals/snapshot_generator.js'
import {
  shouldImportSnapshot,
  importSnapshot,
  getImportState,
  resetImportState,
} from '../../signals/snapshot_importer.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function fmtAge(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  if (d > 0) return `il y a ${d}j`
  if (h > 0) return `il y a ${h}h`
  return 'il y a < 1h'
}

function downloadJSON(content, filename) {
  const blob = new Blob([content], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Section : Génération ──────────────────────────────────────────────────────

function GenerateSection() {
  const [asset,       setAsset]       = useState('BTC')
  const [generating,  setGenerating]  = useState(false)
  const [lastResult,  setLastResult]  = useState(null)
  const [error,       setError]       = useState(null)

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    setLastResult(null)
    try {
      const snapshot = await generateSnapshot(asset)
      const json     = snapshotToJSON(snapshot)
      setLastResult({
        hash:         snapshot.meta.hash,
        patternCount: snapshot.meta.patternCount,
        chainLength:  snapshot.meta.chainLength,
        json,
        filename:     `patterns_snapshot_${asset}.json`,
      })
    } catch (err) {
      setError(err?.message ?? 'Erreur lors de la génération')
    }
    setGenerating(false)
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-header">Générer un snapshot</div>
      <div style={{ padding: '14px 18px' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
          Exporte les patterns de marché accumulés dans IndexedDB vers un fichier JSON
          partageable. Les nouveaux utilisateurs pourront l'importer au premier lancement.
        </p>

        {/* Asset selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {['BTC', 'ETH'].map(a => (
            <button
              key={a}
              onClick={() => setAsset(a)}
              style={{
                padding: '6px 18px',
                background: asset === a ? 'var(--accent)' : 'var(--bg-surface-2)',
                border: `1px solid ${asset === a ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                color: asset === a ? '#000' : 'var(--text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {a}
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            width: '100%',
            padding: '10px 0',
            background: generating ? 'var(--bg-surface-2)' : 'var(--accent)',
            border: 'none',
            borderRadius: 8,
            color: generating ? 'var(--text-muted)' : '#000',
            fontFamily: 'var(--font-body)',
            fontSize: 13, fontWeight: 700,
            cursor: generating ? 'not-allowed' : 'pointer',
            transition: 'all 150ms ease',
          }}
        >
          {generating ? 'Génération…' : `Générer snapshot ${asset}`}
        </button>

        {error && (
          <div style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(240,71,107,.1)',
            border: '1px solid rgba(240,71,107,.3)',
            borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--put)',
          }}>
            {error}
          </div>
        )}

        {lastResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              padding: '10px 14px',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>Patterns exportés</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--call)', fontWeight: 700 }}>{lastResult.patternCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>Longueur de chaîne</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{lastResult.chainLength}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>Hash</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{lastResult.hash}</span>
              </div>
            </div>

            <button
              onClick={() => downloadJSON(lastResult.json, lastResult.filename)}
              style={{
                width: '100%',
                padding: '9px 0',
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
                fontFamily: 'var(--font-body)',
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Télécharger {lastResult.filename}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section : Historique de chaîne ────────────────────────────────────────────

function ChainHistorySection() {
  const [chains, setChains] = useState({ BTC: null, ETH: null })

  useEffect(() => {
    Promise.all([
      getSnapshotHistory('BTC'),
      getSnapshotHistory('ETH'),
    ]).then(([btc, eth]) => setChains({ BTC: btc, ETH: eth }))
  }, [])

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-header">Chaîne locale</div>
      <div style={{ padding: '14px 18px' }}>
        {['BTC', 'ETH'].map(asset => {
          const chain = chains[asset]
          return (
            <div key={asset} style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 8,
              }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  {asset}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {chain ? `${chain.chainLength} snapshot(s)` : '…'}
                </span>
              </div>

              {chain && chain.hashes.length === 0 && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-ghost)', fontStyle: 'italic' }}>
                  Aucun snapshot généré localement
                </div>
              )}

              {chain && chain.hashes.slice(-5).reverse().map((hash, i) => (
                <div key={hash} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: i === 0 ? 'var(--accent)' : 'var(--text-ghost)',
                    flexShrink: 0,
                  }}>
                    {i === 0 ? '▸' : ' '}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: i === 0 ? 'var(--text)' : 'var(--text-muted)',
                  }}>
                    {hash}
                  </span>
                </div>
              ))}
            </div>
          )
        })}

        <div style={{
          marginTop: 4,
          fontFamily: 'var(--font-body)', fontSize: 10,
          color: 'var(--text-ghost)',
          lineHeight: 1.5,
        }}>
          Les 5 derniers hashes de chaque chaîne sont affichés (max 365 conservés).
        </div>
      </div>
    </div>
  )
}

// ── Section : Import & État ───────────────────────────────────────────────────

function ImportSection() {
  const [importText,    setImportText]    = useState('')
  const [importing,     setImporting]     = useState(false)
  const [importResult,  setImportResult]  = useState(null)
  const [importError,   setImportError]   = useState(null)
  const [importState,   setImportState]   = useState(getImportState())

  const refreshState = () => setImportState(getImportState())

  const handleImport = async () => {
    setImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      let snapshot = null

      // Essayer d'abord comme URL
      if (importText.startsWith('http')) {
        const resp = await fetch(importText)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        snapshot = await resp.json()
      } else {
        snapshot = snapshotFromJSON(importText)
        if (!snapshot) throw new Error('JSON invalide')
      }

      const check = shouldImportSnapshot(snapshot)
      if (!check.ok) throw new Error(check.reason)

      const result = await importSnapshot(snapshot)
      setImportResult({
        asset:   snapshot.meta?.asset ?? '?',
        imported: result.imported,
        skipped:  result.skipped,
        warning:  result.warning,
        hash:     snapshot.meta?.hash ?? '?',
      })
      refreshState()
    } catch (err) {
      setImportError(err?.message ?? 'Erreur import')
    }

    setImporting(false)
  }

  const handleReset = (asset) => {
    resetImportState(asset)
    refreshState()
  }

  return (
    <div className="card">
      <div className="card-header">Import & État initial</div>
      <div style={{ padding: '14px 18px' }}>

        {/* État d'import automatique */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Import initial (premier lancement)
          </div>
          {['BTC', 'ETH'].map(asset => {
            const s = importState[asset]
            return (
              <div key={asset} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--text)', marginRight: 8 }}>{asset}</span>
                  {s?.done ? (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10,
                      color: s.error ? 'var(--put)' : 'var(--call)',
                    }}>
                      {s.error
                        ? `Erreur: ${s.error}`
                        : `${s.count} importé(s), ${s.skipped ?? 0} ignoré(s) · ${fmtAge(s.importedAt)}`
                      }
                    </span>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-ghost)' }}>
                      Non exécuté
                    </span>
                  )}
                  {s?.warning && (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--neutral)', marginTop: 2 }}>
                      ⚠ {s.warning}
                    </div>
                  )}
                </div>
                {s?.done && (
                  <button
                    onClick={() => handleReset(asset)}
                    style={{
                      background: 'none', border: '1px solid var(--border)',
                      borderRadius: 4, cursor: 'pointer',
                      fontFamily: 'var(--font-body)', fontSize: 10,
                      color: 'var(--text-muted)', padding: '3px 8px',
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Import manuel */}
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          Import manuel (URL ou JSON)
        </div>
        <textarea
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder="https://… ou collez le JSON du snapshot"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 10px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11, resize: 'vertical',
            marginBottom: 8,
          }}
        />
        <button
          onClick={handleImport}
          disabled={importing || !importText.trim()}
          style={{
            width: '100%', padding: '9px 0',
            background: importing || !importText.trim() ? 'var(--bg-surface-2)' : 'var(--accent)',
            border: 'none', borderRadius: 8,
            color: importing || !importText.trim() ? 'var(--text-muted)' : '#000',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            cursor: importing || !importText.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {importing ? 'Import…' : 'Importer'}
        </button>

        {importError && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: 'rgba(240,71,107,.1)',
            border: '1px solid rgba(240,71,107,.3)',
            borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--put)',
          }}>
            {importError}
          </div>
        )}

        {importResult && (
          <div style={{
            marginTop: 10, padding: '10px 14px',
            background: 'rgba(0,200,100,.08)',
            border: '1px solid rgba(0,200,100,.25)',
            borderRadius: 8,
          }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--call)', marginBottom: 4 }}>
              Import {importResult.asset} réussi
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {importResult.imported} nouveau(x) · {importResult.skipped} ignoré(s)
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-ghost)', marginTop: 2 }}>
              hash: {importResult.hash}
            </div>
            {importResult.warning && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--neutral)', marginTop: 4 }}>
                ⚠ {importResult.warning}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function SnapshotManager() {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 11,
        color: 'var(--text-muted)', lineHeight: 1.6,
        marginBottom: 16, padding: '10px 14px',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}>
        Les snapshots permettent de partager les patterns accumulés entre utilisateurs.
        Chaque snapshot est chaîné cryptographiquement (hash FNV-1a) pour garantir l'intégrité.
        Les patterns locaux ne sont jamais écrasés par un import.
      </div>

      <GenerateSection />
      <ChainHistorySection />
      <ImportSection />
    </div>
  )
}
