# Deribit Options Pro — PWA Mobile

Application React PWA installable sur mobile pour l'analyse des options crypto (Deribit, Binance, Coinbase).

## Architecture

```
DATA CORE → DATA PROCESSING → STRATEGY ENGINE → UI
```

```
src/
├── data_core/                  ← Cœur du système (source unique de vérité)
│   ├── providers/
│   │   ├── deribit.js          ← REST Deribit (spot, options, DVOL, OI, funding, RV)
│   │   ├── binance.js          ← REST Binance (spot, perp, funding, OI)
│   │   └── coinbase.js         ← REST Coinbase (spot fiat, candles)
│   ├── streams/
│   │   ├── websocket.js        ← WebSocket abstrait multi-sources (reconnexion auto)
│   │   └── polling.js          ← Polling configurable (backoff, pause page)
│   ├── normalizers/
│   │   └── format_data.js      ← Format canonique unifié (Ticker, Option, Funding…)
│   ├── data_store/
│   │   └── cache.js            ← Cache central (TTL, historique, subscriptions)
│   └── index.js                ← Façade dataCore + exports unifiés
│
├── data_processing/            ← Transformation & calculs
│   ├── volatility/
│   │   ├── greeks.js           ← Black-Scholes (delta, gamma, vega, theta)
│   │   ├── iv_rank.js          ← IV Rank, IV Percentile, détection spike
│   │   └── skew.js             ← Skew 25-delta
│   ├── market_structure/
│   │   └── term_structure.js   ← Basis annualisé, contango/backwardation, signal DI
│   ├── signals/
│   │   └── signal_engine.js    ← Score composite (IV + funding + basis + IV/RV)
│   └── index.js
│
├── strategy_engine/            ← Exploitation (edge)
│   ├── strategies/
│   │   └── dual_investment.js  ← Calculs DI (premium, P&L, scoring BS)
│   ├── decision_engine.js      ← Q-learning pour l'évaluation DI (RL)
│   └── index.js
│
├── pages/                      ← Vues React
│   ├── DualPage.jsx            ← Dual Investment + scoring + P&L
│   ├── ChainPage.jsx           ← Chaîne d'options Deribit
│   ├── TrackerPage.jsx         ← IV Live tracker avec graphiques
│   ├── TermPage.jsx            ← Term Structure / Basis futures
│   ├── SignalPage.jsx          ← Signal DI composite
│   └── PaperTradingPage.jsx    ← Paper trading
│
├── utils/                      ← Anciens utilitaires (compatibilité)
│   ├── api.js                  ← ⚠ Déprécié → utiliser data_core/providers/deribit.js
│   └── deribitWs.js            ← ⚠ Déprécié → utiliser data_core/streams/websocket.js
│
├── App.jsx                     ← Navigation bottom bar mobile
└── index.css                   ← Thème dark + variables CSS
```

## Démarrage rapide

```js
import { dataCore } from './data_core'

// Initialiser pour BTC et ETH (WS + polls de fond)
await dataCore.init(['BTC', 'ETH'], { websocket: true, binance: true })

// Lire depuis le cache
const spot = dataCore.store.get(dataCore.keys.spot('deribit', 'BTC'))

// S'abonner aux mises à jour
const unsub = dataCore.store.subscribe(
  dataCore.keys.spot('deribit', 'BTC'),
  (ticker) => console.log(ticker.price)
)

// Flux WebSocket temps réel
const stop = dataCore.ws.subscribe('deribit', 'ticker.BTC-PERPETUAL.raw', onData)

// Nettoyage
dataCore.destroy()
```

---

## 🚀 Déploiement en 5 étapes

### 1. Prérequis
- Node.js 18+ installé sur ton PC
- Compte GitHub (gratuit)
- Git installé

### 2. Installation locale
```bash
cd deribit-options-pwa
npm install
npm run dev   # → http://localhost:5173 pour tester
```

### 3. Créer le dépôt GitHub
1. Va sur https://github.com/new
2. Nom du repo : `deribit-options-pwa`
3. **Public** (obligatoire pour GitHub Pages gratuit)
4. Ne pas initialiser avec README

### 4. Push du code
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/deribit-options-pwa.git
git push -u origin main
```

### 5. Activer GitHub Pages avec GitHub Actions
Crée le fichier `.github/workflows/deploy.yml` (déjà inclus dans ce projet).

Puis dans GitHub :
- Settings → Pages → Source → **GitHub Actions**
- Le déploiement se lance automatiquement à chaque push
- Ton app sera disponible sur : `https://TON_USERNAME.github.io/deribit-options-pwa/`

---

## 📱 Installer sur mobile

### iPhone (Safari)
1. Ouvre l'URL dans Safari
2. Appuie sur l'icône Partager ↑
3. "Sur l'écran d'accueil"

### Android (Chrome)
1. Ouvre l'URL dans Chrome
2. Menu ⋮ → "Ajouter à l'écran d'accueil"

---

## 📡 APIs utilisées

| Source | Données | Mode |
|---|---|---|
| **Deribit API v2** | Options, DVOL, funding, OI, RV | REST + WebSocket |
| **Binance API** | Spot, perp, funding, klines | REST |
| **Coinbase Advanced** | Spot fiat (flux USD) | REST |

## ⚡ Temps réel
- WebSocket Deribit : reconnexion automatique avec backoff exponentiel + jitter
- Heartbeat `public/test` toutes les 15s + watchdog de connexion (45s stale)
- Polling configurable par flux (5s à 15min) avec pause auto si page cachée
- Batching des ticks UI (~150ms) pour éviter les freezes de rendu

## 💾 Persistance des données
- Contrats DI : sauvegardés automatiquement dans `localStorage`
- Historique IV Tracker : sauvegardé dans `localStorage`
- Q-table RL (DI) : persistée dans `localStorage`
- Fonctionne hors-ligne pour les données déjà chargées (PWA cache)

## 🔐 Sécurité API
- API Deribit publique : aucune authentification nécessaire pour les données de marché
- Ne jamais stocker de secret API en clair dans `localStorage`
- Pour les ordres : proxy backend recommandé
