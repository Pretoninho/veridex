import { useState } from 'react'
import { parseNexoCSV, buildContracts, calcStats } from '../utils/nexo.js'

function fmtUSD(n) {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(str) {
  return new Date(str).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
}

export default function PerfPage() {
  const [contracts, setContracts] = useState([])
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true); setError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const rows     = parseNexoCSV(ev.target.result)
        const built    = buildContracts(rows)
        const computed = calcStats(built)
        setContracts(built)
        setStats(computed)
        if (!built.length) setError('Aucun contrat DI trouvé dans ce fichier.')
      } catch(err) {
        setError('Erreur de parsing : ' + err.message)
      }
      setLoading(false)
    }
    reader.readAsText(file)
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Suivi <span>Performance</span></div>
        {contracts.length > 0 && (
          <label style={{ cursor:'pointer' }}>
            <span className="icon-btn">↑ CSV</span>
            <input type="file" accept=".csv" style={{ display:'none' }} onChange={handleFile} />
          </label>
        )}
      </div>

      {/* Zone import */}
      {contracts.length === 0 && (
        <label style={{ cursor:'pointer', display:'block' }}>
          <div style={{
            border:'2px dashed var(--border-bright)', borderRadius:12, padding:'40px 20px',
            textAlign:'center', background:'var(--surface)', transition:'all .2s',
          }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📂</div>
            <div style={{ fontFamily:'var(--sans)', fontSize:15, fontWeight:700, color:'var(--text-dim)', marginBottom:8 }}>
              Importer l'export Nexo
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.8 }}>
              Nexo → Transactions → Exporter CSV<br/>
              Filtre : Dual Investment
            </div>
            {loading && <div style={{ marginTop:12, color:'var(--accent)', fontSize:12 }}>Analyse en cours…</div>}
          </div>
          <input type="file" accept=".csv" style={{ display:'none' }} onChange={handleFile} />
        </label>
      )}

      {error && <div className="error-box" style={{ marginTop:12 }}>⚠ {error}</div>}

      {stats && (
        <div className="fade-in">

          {/* KPIs principaux */}
          <div className="stats-grid" style={{ marginBottom:12 }}>
            <div className="stat-card" style={{ borderColor:'rgba(0,229,160,.3)', background:'rgba(0,229,160,.04)' }}>
              <div className="stat-label">Primes totales</div>
              <div className="stat-value green">{fmtUSD(stats.totalPrime)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Contrats</div>
              <div className="stat-value blue">{stats.total}</div>
            </div>
            <div className="stat-card" style={{ borderColor: stats.conversionRate > 40 ? 'rgba(255,77,109,.3)' : 'rgba(255,215,0,.3)' }}>
              <div className="stat-label">Taux conversion</div>
              <div className="stat-value" style={{ color: stats.conversionRate > 40 ? 'var(--put)' : 'var(--atm)' }}>
                {stats.conversionRate.toFixed(1)}%
              </div>
              <div className="stat-sub">{stats.convertedCount} exercés / {stats.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Non exercés</div>
              <div className="stat-value green">{stats.notConvertedCount}</div>
              <div className="stat-sub">{(100 - stats.conversionRate).toFixed(1)}% du total</div>
            </div>
          </div>

          {/* Buy Low vs Sell High */}
          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header">Buy Low vs Sell High</div>
            <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div style={{ background:'rgba(0,229,160,.06)', borderRadius:8, padding:'12px' }}>
                <div style={{ color:'var(--call)', fontFamily:'var(--sans)', fontWeight:800, fontSize:13, marginBottom:8 }}>Buy Low</div>
                <div style={{ fontSize:11, color:'var(--text-dim)', display:'flex', flexDirection:'column', gap:6 }}>
                  <div>Contrats : <strong style={{ color:'var(--text)' }}>{stats.buyLowCount}</strong></div>
                  <div>Primes : <strong style={{ color:'var(--call)', fontSize:13 }}>{fmtUSD(stats.buyLowPrime)}</strong></div>
                  {stats.buyLowCount > 0 && (
                    <div>Moy/contrat : <strong style={{ color:'var(--text-dim)' }}>{fmtUSD(stats.buyLowPrime / stats.buyLowCount)}</strong></div>
                  )}
                </div>
              </div>
              <div style={{ background:'rgba(255,107,53,.06)', borderRadius:8, padding:'12px' }}>
                <div style={{ color:'var(--accent2)', fontFamily:'var(--sans)', fontWeight:800, fontSize:13, marginBottom:8 }}>Sell High</div>
                <div style={{ fontSize:11, color:'var(--text-dim)', display:'flex', flexDirection:'column', gap:6 }}>
                  <div>Contrats : <strong style={{ color:'var(--text)' }}>{stats.sellHighCount}</strong></div>
                  <div>Primes : <strong style={{ color:'var(--accent2)', fontSize:13 }}>{fmtUSD(stats.sellHighPrime)}</strong></div>
                  {stats.sellHighCount > 0 && (
                    <div>Moy/contrat : <strong style={{ color:'var(--text-dim)' }}>{fmtUSD(stats.sellHighPrime / stats.sellHighCount)}</strong></div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Performance par actif */}
          <div className="card">
            <div className="card-header">Performance par actif</div>
            {Object.entries(stats.byAsset).map(([asset, data]) => {
              // Primes reçues dans l'actif natif
              const nativeInterests = contracts
                .filter(c => c.asset === asset)
                .reduce((s, c) => {
                  if (!s[c.interestAsset]) s[c.interestAsset] = 0
                  s[c.interestAsset] += c.interestAmount
                  return s
                }, {})

              return (
                <div key={asset} style={{ padding:'14px 16px', borderBottom:'1px solid rgba(30,58,95,.3)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:15, color: asset==='BTC'?'#f7931a':asset==='ETH'?'#627eea':'var(--accent)' }}>
                      {asset==='BTC'?'₿':asset==='ETH'?'Ξ':'$'} {asset}
                    </span>
                    <span style={{ color:'var(--call)', fontWeight:700, fontSize:14 }}>{fmtUSD(data.prime)}</span>
                  </div>

                  {/* Primes reçues en natif */}
                  <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', marginBottom:8 }}>
                    <div style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>Primes reçues</div>
                    {Object.entries(nativeInterests).map(([a, amt]) => (
                      <div key={a} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                        <span style={{ color:'var(--text-dim)' }}>{a}</span>
                        <span style={{ color:'var(--call)', fontWeight:700 }}>
                          +{amt.toFixed(a==='BTC'?6:a==='ETH'?5:2)} {a}
                        </span>
                      </div>
                    ))}
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginTop:4, paddingTop:4, borderTop:'1px solid rgba(30,58,95,.3)' }}>
                      <span style={{ color:'var(--text-muted)' }}>Équivalent USD</span>
                      <span style={{ color:'var(--call)', fontWeight:700 }}>{fmtUSD(data.prime)}</span>
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:16, fontSize:10, color:'var(--text-muted)' }}>
                    <span>Contrats : <strong style={{ color:'var(--text-dim)' }}>{data.count}</strong></span>
                    <span>Exercés : <strong style={{ color: data.converted/data.count > 0.4 ? 'var(--put)' : 'var(--atm)' }}>
                      {data.converted} ({(data.converted/data.count*100).toFixed(0)}%)
                    </strong></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
