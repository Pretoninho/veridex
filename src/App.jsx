import { useState, useEffect } from 'react'
import { version } from '../package.json'
import * as coinbase from './data_core/providers/coinbase.js'
import LandingPage    from './pages/LandingPage.jsx'
import MarketPage     from './pages/MarketPage.jsx'
import DerivativesPage from './pages/DerivativesPage.jsx'
import OptionsDataPage from './pages/OptionsDataPage.jsx'
import SignalsPage    from './pages/SignalsPage.jsx'
import TradePage      from './pages/TradePage.jsx'
import OnChainPage    from './pages/OnChainPage.jsx'
import AuditPage      from './pages/AuditPage.jsx'
import ClockStatus    from './components/ClockStatus.jsx'
import AuditBanner    from './components/AuditBanner.jsx'
import NavDrawer      from './components/NavDrawer.jsx'
import VLogo          from './components/VLogo.jsx'
import { getSignalHistory } from './data_processing/signals/signal_engine.js'
import { setupSettlementWatcher } from './data_processing/signals/settlement_tracker.js'
import { syncServerClocks, SYNC_INTERVAL_MS } from './data_core/providers/clock_sync.js'
import { setCachedClockSync, dataStore, CacheKey } from './data_core/data_store/cache.js'
import { checkNotifications, notifyAnomaly } from './data_processing/signals/notification_engine.js'
import { requestPermission } from './data_processing/signals/notification_manager.js'
import { runInitialImport } from './data_processing/signals/snapshot_importer.js'
import NotificationSettingsPage from './pages/NotificationSettingsPage.jsx'
import './App.css'

// ── Constantes ────────────────────────────────────────────────────────────────

const ANOMALY_LOG_KEY   = 'veridex_anomaly_log'
const RECENT_WINDOW_MS  = 10 * 60 * 1000

const PAGE_NAMES = {
  market:        'Market',
  deriv:         'Dérivés',
  options:       'Options',
  signals:       'Signaux',
  trade:         'Trade',
  onchain:       'On-Chain',
  audit:         'Audit',
  notifications: 'Notifications',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAuditAlerts() {
  try {
    const log = JSON.parse(localStorage.getItem(ANOMALY_LOG_KEY) || '[]')
    const now = Date.now()
    return log.filter(e => now - e.timestamp < RECENT_WINDOW_MS).length
  } catch (_) {
    return 0
  }
}

function getNextFundingCountdown() {
  const now  = new Date()
  const h    = now.getUTCHours()
  const m    = now.getUTCMinutes()
  // Binance / Deribit : fixings à 00h, 08h, 16h UTC
  const next = [0, 8, 16, 24].find(i => i > h) ?? 24
  const diff = next * 60 - (h * 60 + m)
  return diff >= 60 ? `${Math.floor(diff / 60)}h` : `${diff}m`
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [inApp,       setInApp]       = useState(false)
  const [tab,         setTab]         = useState('market')
  const [asset,       setAsset]       = useState('BTC')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [clockSync,   setClockSync]   = useState(null)
  const [btcPrice,    setBtcPrice]    = useState(null)
  const [ethPrice,    setEthPrice]    = useState(null)
  const [signalScore, setSignalScore] = useState(null)
  const [auditAlerts, setAuditAlerts] = useState(0)
  const [nextFunding, setNextFunding] = useState(() => getNextFundingCountdown())

  // Synchronisation horloges
  useEffect(() => {
    const doSync = async () => {
      const result = await syncServerClocks()
      setCachedClockSync(result)
      setClockSync(result)
    }
    doSync()
    const timer = setInterval(doSync, SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  // Import initial des snapshots de patterns (fire-and-forget)
  useEffect(() => {
    runInitialImport('BTC').catch(() => {})
    runInitialImport('ETH').catch(() => {})
  }, [])

  // Watcher settlement quotidien Deribit (08:00 UTC)
  useEffect(() => {
    const getSpot = (asset) =>
      dataStore.get(CacheKey.spot('deribit', asset), true)?.price ?? null

    const getIVRank = (asset) => {
      const dvol = dataStore.get(CacheKey.dvol('deribit', asset), true)
      if (!dvol) return null
      const range = (dvol.monthMax ?? 0) - (dvol.monthMin ?? 0)
      if (!range) return null
      return Math.round(((dvol.current - dvol.monthMin) / range) * 100)
    }

    const getInstruments = (asset) =>
      dataStore.get(CacheKey.instruments('deribit', asset), true)?.instruments ?? []

    const cleanup = setupSettlementWatcher(getSpot, getIVRank, getInstruments)
    return cleanup
  }, [])

  // Demande de permission notifications (une seule fois, à l'entrée dans l'app)
  useEffect(() => {
    if (!inApp) return
    // Ne demander qu'une fois (permission 'default') — jamais sans interaction utilisateur
    if ('Notification' in window && Notification.permission === 'default') {
      // Délai de 3s pour ne pas interrompre immédiatement l'entrée dans l'app
      const timer = setTimeout(() => requestPermission().catch(() => {}), 3000)
      return () => clearTimeout(timer)
    }
  }, [inApp])

  // Polling de fond pour les vérifications de notifications (toutes les 60s)
  useEffect(() => {
    if (!inApp) return

    const check = async () => {
      for (const asset of ['BTC', 'ETH']) {
        try {
          const spot    = dataStore.get(CacheKey.spot('deribit', asset), true)?.price ?? null
          const dvol    = dataStore.get(CacheKey.dvol('deribit', asset), true)
          const funding = dataStore.get(CacheKey.funding('deribit', asset), true)
          const ivRank  = dvol
            ? Math.round(((dvol.current - dvol.monthMin) / ((dvol.monthMax - dvol.monthMin) || 1)) * 100)
            : null
          const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null

          await checkNotifications(asset, {
            spotPrice:  spot,
            ivRank,
            fundingAnn,
          })
        } catch (_) {}
      }
    }

    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [inApp])

  // Prix landing
  useEffect(() => {
    coinbase.getSpot('BTC').then(p => setBtcPrice(p?.price ?? null)).catch(() => {})
    coinbase.getSpot('ETH').then(p => setEthPrice(p?.price ?? null)).catch(() => {})
  }, [])

  // Dernier score signal (badge drawer)
  useEffect(() => {
    getSignalHistory(null, 10).then(h => {
      if (h.length > 0) setSignalScore(h[h.length - 1].score)
    }).catch(() => {})
  }, [tab]) // recharge quand on change de page (ex: après refresh Signaux)

  // Compteur anomalies audit (badge drawer)
  useEffect(() => {
    const check = () => setAuditAlerts(getAuditAlerts())
    check()
    const timer = setInterval(check, 30_000)
    return () => clearInterval(timer)
  }, [])

  // Countdown funding (badge Dérivés)
  useEffect(() => {
    const timer = setInterval(() => setNextFunding(getNextFundingCountdown()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const forceUpdate = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister())
        window.location.reload(true)
      })
    } else {
      window.location.reload(true)
    }
  }

  if (!inApp) return (
    <LandingPage
      onEnter={() => setInApp(true)}
      btcPrice={btcPrice}
      ethPrice={ethPrice}
    />
  )

  return (
    <div className="app-shell">

      {/* Header global fixé */}
      <GlobalHeader
        tab={tab}
        asset={asset}
        clockSync={clockSync}
        onClockSync={setClockSync}
        onOpenDrawer={() => setDrawerOpen(true)}
        onLanding={() => setInApp(false)}
      />

      {/* Contenu des pages */}
      <div className="app-content">
        {tab === 'market'        && <MarketPage             asset={asset} />}
        {tab === 'deriv'         && <DerivativesPage        asset={asset} clockSync={clockSync} />}
        {tab === 'options'       && <OptionsDataPage        asset={asset} clockSync={clockSync} />}
        {tab === 'signals'       && <SignalsPage            asset={asset} clockSync={clockSync} />}
        {tab === 'trade'         && <TradePage              asset={asset} />}
        {tab === 'onchain'       && <OnChainPage            asset={asset} />}
        {tab === 'audit'         && <AuditPage />}
        {tab === 'notifications' && <NotificationSettingsPage />}
        <VersionBar version={version} forceUpdate={forceUpdate} />
      </div>

      {/* Bandeau anomalie */}
      <AuditBanner onNavigateToAudit={() => setTab('audit')} />

      {/* Drawer de navigation */}
      {drawerOpen && (
        <NavDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          activePage={tab}
          onNavigate={(page) => setTab(page)}
          activeAsset={asset}
          onAssetChange={(a) => setAsset(a)}
          signalScore={signalScore}
          auditAlerts={auditAlerts}
          nextFunding={nextFunding}
        />
      )}
    </div>
  )
}

// ── Header global ─────────────────────────────────────────────────────────────

function GlobalHeader({ tab, asset, clockSync, onClockSync, onOpenDrawer, onLanding }) {
  return (
    <header className="app-header-global">
      <div className="header-inner">

        {/* Gauche : logo (→ landing) + hamburger (→ drawer) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onLanding}
            aria-label="Accueil Veridex"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <VLogo size={28} />
          </button>
          <button className="hamburger-btn" onClick={onOpenDrawer} aria-label="Menu">
            <div className="hamburger-line" style={{ width: 14 }} />
            <div className="hamburger-line" style={{ width: 10 }} />
            <div className="hamburger-line" style={{ width: 14 }} />
          </button>
        </div>

        {/* Centre : titre page active + ClockStatus */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClockStatus clockSync={clockSync} onSync={onClockSync} />
          <span className="header-title">{PAGE_NAMES[tab] ?? tab}</span>
        </div>

        {/* Droite : asset pill (tap → drawer) */}
        <button className="asset-pill-header" onClick={onOpenDrawer}>
          {asset}
        </button>

      </div>
    </header>
  )
}

// ── Version bar ───────────────────────────────────────────────────────────────

function VersionBar({ version, forceUpdate }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '8px 0 4px', flexShrink: 0,
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: .35, letterSpacing: '1px' }}>v{version}</span>
      <button onClick={forceUpdate} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-muted)', opacity: .35, padding: '0 4px', fontSize: 9,
        fontFamily: 'var(--sans)', fontWeight: 700,
      }}>MAJ</button>
    </div>
  )
}
