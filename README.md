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
  - `GET /analytics/stats?asset=BTC&days=7`
  - `GET /analytics/export?asset=BTC&type=signals&format=csv&days=30`
- **Services actifs**:
  - `backend/services/dataCore.js`
  - `backend/services/signalEngine.js`
  - `backend/data/providers.js`
  - `backend/utils/cache.js`
- **Workers actifs**:
  - `backend/workers/dataStore.js` — couche de persistance SQLite/PostgreSQL
  - `backend/workers/settlementJob.js` — settlement périodique des signaux (horizons 1h/4h/24h)
  - `backend/workers/dataCollector.js` — collecte de tickers en temps réel

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
    -> /analytics/stats  (settlement outcomes DB)
    -> /analytics/export (CSV/JSON export)
    -> workers: dataCollector, settlementJob (SQLite / PostgreSQL)
```

---

## 5) Installation rapide

### Prérequis
- Node.js >= 24
- npm >= 10

### Dev (frontend + backend séparés)

```bash
# Installer les dépendances frontend et backend
npm install          # installe aussi backend/node_modules via le hook postinstall

# Démarrer le frontend Vite en mode dev (hot-reload)
npm run dev

# Dans un second terminal — démarrer le backend Express
cd backend
npm run dev          # node --watch server.js (rechargement auto)
```

### Mode production complet (npm start)

`npm start` sert le frontend compilé **et** l'API Express sur le même port.
Il faut d'abord construire le frontend :

```bash
# 1. Installer les dépendances (frontend + backend)
npm install

# 2. Construire le frontend (génère dist/)
npm run build

# 3. Démarrer le serveur (API + frontend statique)
npm start
# ou avec le collecteur de données activé :
ENABLE_COLLECTOR=true npm start
```

> **Note** : si vous omettez `npm run build`, le serveur démarre mais renvoie
> `ENOENT: no such file or directory, stat 'dist/index.html'` sur les routes frontend.

### Build / tests

```bash
npm run build
npm test
./test-refactor.sh
```

### Configuration base de données (optionnel)

Sans `DATABASE_URL`, le backend utilise automatiquement SQLite local (`backend/data/veridex.db`).
Pour utiliser PostgreSQL, copiez `.env.example` en `.env` et renseignez `DATABASE_URL` :

```bash
cp .env.example .env
# Modifier DATABASE_URL=postgresql://user:password@host:5432/veridex
```

Voir `.env.example` pour la liste complète des variables d'environnement disponibles.

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
curl -s "http://localhost:3000/analytics/stats?asset=BTC&days=7"
curl -s "http://localhost:3000/analytics/export?asset=BTC&type=signals&format=json&days=7"
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

---

## 8) Edge statistique — comment interpréter les métriques

### 8.1 Pourquoi `settled_signals: 0` au démarrage ?

Lors d'un démarrage à froid (base de données vide), il n'existe pas encore de signaux dans la base.
Le **settlement job** (`backend/workers/settlementJob.js`) tourne toutes les 5 minutes et remplit
la table `outcomes` dès que le temps target d'un horizon (1h / 4h / 24h) est écoulé
**et** qu'un tick de prix est disponible à ce moment.

Pipeline de données :
```
signal inscrit → [délai horizon] → settlementJob lit le ticker le plus proche
               → calcule move_pct + label (WIN/LOSS/FLAT) → INSERT outcomes
               → /analytics/stats relit outcomes → métriques non-null
```

En pratique, **les métriques commencent à se peupler ≈ 1 heure après le premier signal**.

### 8.2 Métriques disponibles dans `/analytics/stats`

| Champ | Description |
|-------|-------------|
| `settled_signals` | Nombre de signaux avec un résultat au horizon demandé |
| `total_signals` | Nombre total de signaux dans la fenêtre |
| `win_rate` | % de signaux classés WIN (move > threshold) |
| `avg_return` | Rendement moyen en % sur l'horizon |
| `avg_gain` / `avg_loss` | Moyenne des gains / pertes |
| `sharpe_ratio` | Ratio de Sharpe (mean / std des retours, rf=0) |
| `max_drawdown` | Drawdown maximal simulé sur l'equity curve |
| `confidence_interval_95` | IC 95 % de la moyenne (z=1,96 pour n≥30, t≈2,0 sinon) |
| `equity_curve` | Courbe d'equity cumulée (base 100) |
| `win_rate_1h/4h/24h` | Taux de gain par horizon (signaux directionnels) |
| `by_direction` | Ventilation LONG / SHORT |
| `by_vol_source` | Ventilation DVOL / RV |
| `confusion_matrix` | Comptage WIN/LOSS/FLAT/UNSETTLED par type de signal |

### 8.3 Qu'est-ce qu'un « edge » statistique ?

Un signal a un **edge** exploitable si et seulement si :

1. **Taille d'échantillon suffisante** — En deçà de **30 trades settled**, les estimations sont
   trop instables pour être actionnables. Pour un IC 95 % fiable sur `win_rate`,
   viser **n ≥ 100** (erreur standard ≤ 5 points de pourcentage).

2. **Win rate supérieur au hasard** — Selon les frais et le ratio gain/perte moyen :
   - `avg_gain / |avg_loss| = 1` → seuil de rentabilité ≈ 50 %
   - `avg_gain / |avg_loss| = 2` → seuil ≈ 34 %
   - Règle rapide : `win_rate > 1 / (1 + avg_gain/|avg_loss|)`

3. **Intervalle de confiance au-dessus de 50 %** — Si `confidence_interval_95[0] > 50`
   (borne basse de l'IC > 50 %), le signal est statistiquement bullish avec 95 % de confiance.
   Si l'IC chevauche 50 %, l'edge n'est **pas prouvé**.

4. **Sharpe ratio > 0** — Un Sharpe positif indique un retour moyen positif par unité de risque.
   Un Sharpe > 0,5 est considéré comme « acceptable » sur un portefeuille de signaux.

5. **Drawdown maîtrisé** — Un `max_drawdown` élevé suggère une succession de pertes ;
   surveiller ce chiffre pour le sizing (position sizing adaptatif).

### 8.4 Pièges classiques à éviter

| Biais | Description | Contre-mesure |
|-------|-------------|---------------|
| **Overfitting** | Threshold k calibré sur les mêmes données qu'on évalue | Fenêtre out-of-sample obligatoire |
| **Look-ahead bias** | Utiliser des données futures dans le signal d'entrée | Vérifier que `trigger_price` < prix au moment du signal |
| **Multiple comparisons** | Tester 1h/4h/24h × LONG/SHORT × DVOL/RV = 12 combinaisons | Appliquer correction de Bonferroni ou ne retenir qu'une hypothèse principale |
| **Survivorship bias** | Signaux manqués ou non enregistrés | S'assurer que `dataCollector` tourne en continu sans interruption |
| **Biais de régime** | Edge valide en bull market uniquement | Segmenter les résultats par régime de volatilité (IV rank) |

### 8.5 Interprétation rapide (checklist)

```
settled_signals < 30  → ⚠️  Trop peu de données — ne pas trader
win_rate < seuil      → ❌  Pas d'edge détecté
CI_95[0] > 50         → ✅  Edge statistiquement significatif (95 %)
sharpe > 0.5          → ✅  Risque/rendement acceptable
max_drawdown > 20%    → ⚠️  Sizing à réduire
```
