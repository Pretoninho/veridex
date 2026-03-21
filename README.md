# OptionLab — PWA Mobile

Application React PWA installable sur mobile pour l'analyse des marchés crypto dérivés :
options, futures, funding, IV, Greeks, OI — données en temps réel depuis 4 exchanges.

## Onglets

| Onglet | Contenu |
|---|---|
| **Market** | Prix spot 4 exchanges (Deribit index, Binance, OKX, Coinbase), VWAP pondéré volume, spread cross-exchange, prix relatif au VWAP |
| **Dérivés** | Funding perpétuel (Deribit · Binance · OKX), term structure futures + basis annualisé, Open Interest 3 sources, sentiment Long/Short (Binance), liquidations (Binance), prix de règlement Deribit |
| **Options** | DVOL + IV Rank Deribit, structure à terme ATM IV, Greeks ATM (Black-Scholes), IV cross-exchange (Deribit · Binance · OKX), OI options Call/Put/P·C Ratio |
| **Signaux** | *(en développement)* |
| **Trade** | *(en développement)* |

Le sélecteur d'actif (BTC / ETH) dans le header est global : il met à jour tous les onglets simultanément.
Pour ajouter un actif, modifier uniquement `const ASSETS` dans `src/App.jsx`.

---

## Architecture

```
src/
├── data_core/                  ← Couche données (source unique de vérité)
│   ├── providers/
│   │   ├── deribit.js          ← REST Deribit : index, options, DVOL, OI, funding, RV, settlement
│   │   ├── binance.js          ← REST Binance : spot, perp, funding, OI, sentiment, liquidations
│   │   ├── okx.js              ← REST OKX : spot, options, OI, funding perp USDT-SWAP
│   │   └── coinbase.js         ← REST Coinbase Exchange : spot fiat (BTC-USD, ETH-USD)
│   ├── normalizers/
│   │   └── format_data.js      ← Format canonique unifié (Ticker, Option, Funding, OI…)
│   ├── data_store/
│   │   └── cache.js            ← Cache central avec clés typées (CacheKey)
│   └── index.js                ← Façade dataCore + exports unifiés
│
├── data_processing/            ← Calculs financiers
│   ├── volatility/
│   │   ├── greeks.js           ← Black-Scholes : delta, gamma, vega, theta (param objet)
│   │   ├── iv_rank.js          ← IV Rank, IV Percentile, détection spike
│   │   └── skew.js             ← Skew 25-delta
│   ├── market_structure/
│   │   └── term_structure.js   ← Basis annualisé, contango/backwardation
│   └── signals/
│       └── signal_engine.js    ← Score composite (IV + funding + basis + IV/RV)
│
├── pages/
│   ├── LandingPage.jsx         ← Écran d'accueil (splash)
│   ├── MarketPage.jsx          ← Onglet Market
│   ├── DerivativesPage.jsx     ← Onglet Dérivés
│   ├── OptionsDataPage.jsx     ← Onglet Options
│   ├── SignalsPage.jsx         ← Onglet Signaux
│   └── TradePage.jsx           ← Onglet Trade
│
├── App.jsx                     ← Shell : navigation bottom bar, asset selector, versioning
└── App.css                     ← Thème dark + variables CSS
```

---

## Démarrage rapide

```bash
npm install
npm run dev     # → http://localhost:5173
npm run build   # build de production
```

---

## 🚀 Déploiement GitHub Pages

### Prérequis
- Node.js 18+, Git, compte GitHub

### Première mise en ligne
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/deribit-options-pwa.git
git push -u origin main
```

Dans GitHub :
- **Settings → Pages → Source → GitHub Actions**
- Le workflow `.github/workflows/deploy.yml` se déclenche automatiquement à chaque push sur `main`
- App disponible sur : `https://TON_USERNAME.github.io/deribit-options-pwa/`

---

## 📱 Installer sur mobile (PWA)

**iPhone (Safari)** : Partager ↑ → "Sur l'écran d'accueil"

**Android (Chrome)** : Menu ⋮ → "Ajouter à l'écran d'accueil"

---

## 📡 APIs utilisées

| Source | Endpoints | Données |
|---|---|---|
| **Deribit API v2** | `get_index_price`, `get_volatility_index_data`, `get_funding_rate_value`, `get_funding_rate_history`, `get_book_summary_by_currency`, `get_delivery_prices` | Index, options, DVOL, funding, OI, settlement |
| **Binance Spot** | `/api/v3/ticker/24hr` | Prix spot USDT |
| **Binance Futures** | `/fapi/v1/*`, `/futures/data/*` | Perp, funding, OI, sentiment, liquidations |
| **Binance Options** | `/eapi/v1/mark`, `/eapi/v1/openInterest` | Options européennes (BTCUSDT) |
| **OKX** | `/api/v5/market/ticker`, `/api/v5/public/opt-summary`, `/api/v5/market/open-interest`, `/api/v5/public/funding-rate` | Spot USDT, options, OI, funding SWAP |
| **Coinbase Exchange** | `/products/{id}/ticker` | Spot fiat USD (public, sans auth) |

Toutes les APIs utilisées sont **publiques** — aucune clé d'authentification requise.

---

## 🔧 Polling & mise à jour

- Toutes les pages rafraîchissent automatiquement leurs données toutes les **10 secondes** via `setInterval`
- `Promise.allSettled` sur chaque groupe d'appels → une source hors ligne ne bloque pas les autres
- Bouton "Refresh" manuel disponible sur chaque onglet
- Bouton "MAJ" dans la barre de version : désenregistre le Service Worker et recharge pour forcer la mise à jour du cache PWA
