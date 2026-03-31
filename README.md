# Veridex — Market Intelligence Platform

Plateforme PWA pour l’analyse des marchés crypto dérivés (focus Deribit, BTC/ETH).

---

## 1) État réel des modules actifs (mars 2026)

### Frontend actif

- **Entrée applicative**: `src/main.jsx` (boot React + enregistrement SW PWA).  
- **Shell principal**: `src/interface/App.jsx`.
- **Pages réellement utilisées en runtime**:
  - `src/interface/pages/LandingPage.jsx`
  - `src/interface/pages/MarketPage.jsx`
  - `src/interface/pages/DerivativesPage.jsx`
  - `src/interface/pages/SignalsPage.jsx`
  - `src/interface/pages/MaintenancePage.jsx` (activée via `VITE_MAINTENANCE_MODE=true`)
- **Composants UI branchés**:
  - `src/interface/components/NavDrawer.jsx`
  - `src/interface/components/ClockStatus.jsx`
  - `src/interface/components/VLogo.jsx`
  - `src/interface/components/TradeDisplay.jsx`
  - `src/interface/components/PriceChartWithPatterns.jsx`
  - `src/interface/components/AuditBanner.jsx`

### Backend actif

- **Entrée API**: `backend/server.js`.
- **Routes officiellement exposées**:
  - `GET /health`
  - `GET /signals?asset=BTC|ETH`
  - `GET /signals?assets=BTC,ETH`
  - `GET /market?asset=BTC|ETH`
- **Services actifs**:
  - `backend/services/dataCore.js`
  - `backend/services/signalEngine.js`
  - `backend/data/providers.js`
  - `backend/utils/cache.js`

### Modules cœur actifs (frontend)

- **Signals**: `src/signals/` (engine, interprétation, notifications, settlement tracker)
- **Data**: `src/data/` (provider Deribit, streams polling/ws, cache/store, normalizers)
- **Core quant**: `src/core/` (greeks, skew, iv_rank, max_pain, term_structure, history)
- **API client**: `src/api/backend.js`

> Note: `src/engine/index.js` existe encore dans le dépôt comme façade DataCore, mais n’est pas un point d’entrée officiellement supporté côté produit.

---

## 2) Points d’entrée officiellement supportés

### Produit (utilisation standard)

1. **Frontend web/PWA**
   - Démarrage: `npm run dev`
   - Entrée technique: `src/main.jsx`
   - Navigation supportée: Landing → onglets **Market / Dérivés / Signaux**

2. **Backend API Express**
   - Démarrage: `cd backend && npm run dev`
   - Entrée technique: `backend/server.js`
   - Contrat stable: `/health`, `/signals`, `/market`

### Entrées de maintenance (supportées)

- `npm run build`
- `npm test`
- `./test-refactor.sh` (script de contrôle de cohérence refactor)

---

## 3) Modules archivés / supprimés (historique refactor)

Les chemins ci-dessous sont **retirés de la base active** (absents du dépôt actuel) et ne doivent pas être réintroduits sans RFC explicite.

### Dossiers supprimés

- `src/analytics/`
- `backend/backtest/`

### Providers supprimés

- `src/data/providers/onchain.js`
- `backend/data_core/providers/onchain.js`

### Pages supprimées

- `src/interface/pages/OptionsDataPage.jsx`
- `src/interface/pages/VolPage.jsx`
- `src/interface/pages/TrackerPage.jsx`
- `src/interface/pages/TradePage.jsx`
- `src/interface/pages/AssistantPage.jsx`
- `src/interface/pages/OnChainPage.jsx`
- `src/interface/pages/AuditPage.jsx`
- `src/interface/pages/AnalyticsPage.jsx`
- `src/interface/pages/NotificationSettingsPage.jsx`
- `src/interface/pages/CalibrationPage.jsx`
- `src/interface/pages/FingerprintDebug.jsx`
- `src/interface/pages/MonitorPage.jsx`

---

## 4) Architecture supportée

```txt
Frontend (React/Vite/PWA)
  src/main.jsx
    -> src/interface/App.jsx
       -> pages: Landing, Market, Derivatives, Signals, Maintenance(mode)
       -> data/signals/core/api

Backend (Express)
  backend/server.js
    -> /health
    -> /signals (dataCore + signalEngine)
    -> /market  (providers)
```

---

## 5) Installation rapide

### Prérequis
- Node.js >= 24
- npm >= 10

### Dev

```bash
npm install
npm run dev

cd backend
npm install
npm run dev
```

### Build / tests

```bash
npm run build
npm test
./test-refactor.sh
```

---

## 6) Checklist maintenance — détection de fichiers orphelins

Objectif: éviter la dérive entre « modules présents » et « modules réellement supportés ».

### A. Détection imports vers modules retirés

```bash
rg "from .*onchain|from .*analytics|pattern_clustering|market_fingerprint|snapshot_" src backend
```

- Attendu: **0 résultat** (hors docs).

### B. Détection fichiers JS/JSX non référencés depuis les entrées officielles

1. Construire le graphe d’entrées supportées:
   - `src/main.jsx`
   - `backend/server.js`
2. Lister les fichiers potentiellement orphelins (inspection manuelle obligatoire):

```bash
rg --files src backend | rg "\.(js|jsx)$"
```

Puis vérifier les usages ciblés:

```bash
rg "<NomModule>|from '.*<nom_module>'|require\('.*<nom_module>'\)" src backend
```

### C. Vérification contrat API stable

```bash
curl -s http://localhost:3000/health
curl -s "http://localhost:3000/signals?asset=BTC"
curl -s "http://localhost:3000/market?asset=BTC"
```

### D. Garde-fous CI locaux

```bash
npm test
npm run build
./test-refactor.sh
```

- Si l’un échoue: bloquer le merge.

---

## 7) Références

- Détails de refonte: `REFACTOR.md`
- Guide calibration: `SIGNAL_CALIBRATION_GUIDE.md`
- Guide hashing secteur: `SECTOR_HASHING_GUIDE.md`
