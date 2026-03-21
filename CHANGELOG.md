# Changelog

Toutes les modifications notables de ce projet sont documentées ici.
Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).
Ce projet suit le [Versioning Sémantique](https://semver.org/lang/fr/) (Major.Minor.Patch).

---

## [1.1.0] — 2026-03-21

### Ajouté

**Architecture data_core/**
- `providers/deribit.js` — REST Deribit unifié (spot, DVOL, options, funding, OI, RV, ticker, funding history, delivery prices, last trades)
- `providers/binance.js` — REST Binance étendu (spot, perp, funding, premium index, long/short ratio, taker volume, liquidations, options eapi, OI options, Coin-M)
- `providers/coinbase.js` — REST Coinbase (spot fiat)
- `providers/okx.js` — REST OKX (spot, options chain avec IV+Greeks, OI options)
- `streams/websocket.js` — WebSocket multi-sources avec reconnexion automatique (backoff + jitter)
- `streams/polling.js` — Polling configurable par intervalle, pause auto si page cachée
- `normalizers/format_data.js` — Format canonique unifié + 12 nouveaux normalizers (OKX spot/options/OI, Binance premium index/sentiment/taker/liquidations/options/OI, Deribit funding history/delivery prices/trades)
- `data_store/cache.js` — Cache central avec TTL, historique et subscriptions réactives (14 CacheKey types)

**Architecture data_processing/**
- `volatility/greeks.js` — Black-Scholes pricing + Greeks (delta, gamma, vega, theta)
- `volatility/iv_rank.js` — IV Rank, IV Percentile, détection spike
- `volatility/skew.js` — Skew 25-delta, smile de volatilité
- `market_structure/term_structure.js` — Basis annualisé, contango/backwardation, signal DI
- `signals/signal_engine.js` — Score composite pondéré (IV 35% + funding 25% + basis 25% + IV/RV 15%)

**Architecture strategy_engine/**
- `strategies/dual_investment.js` — Calculs Dual Investment (premium, P&L, scoring BS)
- `decision_engine.js` — Moteur de décision Q-learning pour le DI

**Pages UI**
- `MarketPage` — Comparaison spot 4 exchanges (Deribit/Binance/OKX/Coinbase), VWAP, spread cross-exchange, bar chart prix relatif
- `DerivativesPage` — Structure à terme futures, funding Deribit vs Binance, OI multi-source, liquidations, delivery prices
- `OptionsDataPage` — Comparaison IV 3 sources (Deribit/Binance/OKX), table arbitrage IV cross-exchange, term structure ATM IV, Greeks ATM, OI multi-source avec ratio P/C

**Versioning**
- Version affichée dans la barre de navigation (`VersionBar`)
- `vite.config.js` lit la version depuis `package.json` (source unique)
- `CHANGELOG.md` initialisé

### Modifié

- Navigation restructurée : **Market | Derivés | Options | Signaux | Trade**
- `DerivativesPage` — réécriture complète (correctif crash : état unifié, `safe()` null-guards, try-catch)
- Structure à terme futures déplacée de `MarketPage` → `DerivativesPage`
- `SignalPage.jsx` — logique de scoring extraite vers `data_processing/signals/signal_engine.js`
- `TermPage.jsx` — logique de basis et signal extraite vers `data_processing/market_structure/term_structure.js`
- `utils/greeks.js` — devient un re-export depuis `data_processing/volatility/greeks.js`
- `utils/di.js` — devient un re-export depuis `strategy_engine/strategies/dual_investment.js`
- `README.md` — reflète la nouvelle architecture DATA CORE → PROCESSING → STRATEGY → UI

### Déprécié

- `utils/api.js` — remplacé par `data_core/providers/deribit.js` (conservé pour compatibilité)
- `utils/deribitWs.js` — remplacé par `data_core/streams/websocket.js` (conservé pour compatibilité)

---

## [1.0.0] — version initiale

### Ajouté

- Application PWA installable (manifest, service worker, icônes)
- `ChainPage` — chaîne d'options Deribit avec Greeks temps réel
- `TrackerPage` — IV live tracker avec graphiques (DVOL, funding, OI, RV)
- `DualPage` — Dual Investment : gestion des contrats, scoring, P&L, break-even
- `TermPage` — Term structure / basis futures
- `SignalPage` — Signal DI composite avec historique et alertes push
- `PaperTradingPage` — Paper trading options
- `OptionsPage` — Analyseur d'options (placeholder)
- Moteur Q-learning (RL) pour l'évaluation des DI (`utils/rlDual.js`)
- Déploiement automatique GitHub Pages via GitHub Actions
