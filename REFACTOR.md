# 🔄 Refonte Veridex — État consolidé (mars 2026)

Ce document remplace les notes partielles et décrit **l’état réel actuel** des modules actifs, des modules retirés, des points d’entrée supportés, et des pratiques de maintenance anti-dérive.

---

## 1) Périmètre officiellement supporté

### Frontend

- **Point d’entrée runtime**: `src/main.jsx`
- **Shell UI**: `src/interface/App.jsx`
- **Pages supportées**:
  - `src/interface/pages/LandingPage.jsx`
  - `src/interface/pages/MarketPage.jsx`
  - `src/interface/pages/DerivativesPage.jsx`
  - `src/interface/pages/SignalsPage.jsx`
  - `src/interface/pages/MaintenancePage.jsx` (uniquement si `VITE_MAINTENANCE_MODE=true`)

### Backend

- **Point d’entrée runtime**: `backend/server.js`
- **Routes supportées**:
  - `GET /health`
  - `GET /signals?asset=BTC|ETH`
  - `GET /signals?assets=BTC,ETH`
  - `GET /market?asset=BTC|ETH`

### Couche métier active

- `backend/services/dataCore.js`
- `backend/services/signalEngine.js`
- `backend/data/providers.js`
- `backend/utils/cache.js`
- `src/signals/`
- `src/data/`
- `src/core/`

---

## 2) Modules présents mais non « entrypoints produit »

Ces modules existent encore dans le dépôt mais ne sont pas des points d’entrée officiels:

- `src/engine/index.js` (façade DataCore historique)
- `src/data/index.js` (barrel export de la couche data)
- `src/signals/index.js` (barrel export signaux)
- `src/core/index.js` (barrel export calculs)

Ils restent utilisables pour factorisation interne, mais le support produit est défini par `src/main.jsx` et `backend/server.js`.

---

## 3) Modules archivés / supprimés (chemins exacts)

> État vérifié: ces chemins ne sont plus présents dans le dépôt courant.

### Dossiers

- `src/analytics/`
- `backend/backtest/`

### Providers retirés

- `src/data/providers/onchain.js`
- `backend/data_core/providers/onchain.js`

### Pages retirées

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

## 4) Contrat d’architecture (version actuelle)

```txt
src/main.jsx
  -> interface/App.jsx
     -> pages: Landing / Market / Derivatives / Signals
     -> MaintenancePage (flag env)

backend/server.js
  -> /health
  -> /signals
  -> /market
```

Contraintes métier:
- Scope asset supporté: `BTC`, `ETH`
- Source de données runtime principale: Deribit
- Signal engine produit: modèle 4 composantes

---

## 5) Checklist maintenance — détection de fichiers orphelins

Checklist à exécuter avant merge de toute PR touchant architecture/modules.

### 5.1 Imports vers modules supprimés

```bash
rg "from .*onchain|from .*analytics|pattern_clustering|market_fingerprint|snapshot_" src backend
```

- Résultat attendu: aucun import runtime.

### 5.2 Vérification des entrées supportées

```bash
rg "createRoot\(|registerSW\(" src/main.jsx
rg "app.use\('/signals'|app.use\('/market'|app.get\('/health'" backend/server.js
```

- Permet de confirmer que les points d’entrée documentés sont bien ceux branchés.

### 5.3 Détection candidats orphelins

```bash
rg --files src backend | rg "\.(js|jsx)$"
```

Pour chaque module suspect, vérifier explicitement:

```bash
rg "<ModuleName>|from '.*<module_name>'|require\('.*<module_name>'\)" src backend
```

### 5.4 Santé globale

```bash
npm test
npm run build
./test-refactor.sh
```

- Tout échec = blocage merge.

---

## 6) Évolution future (règle anti-dérive)

À chaque ajout/suppression de module:

1. Mettre à jour **README.md** (état actif + points d’entrée).
2. Mettre à jour **REFACTOR.md** (section supprimés/archivés).
3. Ajouter un check automatisé si possible (`test-refactor.sh` ou CI).
4. Vérifier qu’aucun « barrel export » ne réintroduit un module non supporté.
