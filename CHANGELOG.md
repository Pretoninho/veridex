# Changelog

Toutes les modifications notables de ce projet sont documentées ici.
Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).
Ce projet suit le [Versioning Sémantique](https://semver.org/lang/fr/) (Major.Minor.Patch).

---

## [1.1.0] — 2026-03-20

### Ajouté

**Architecture data_core/**
- `providers/deribit.js` — REST Deribit unifié (spot, DVOL, options, funding, OI, RV)
- `providers/binance.js` — REST Binance (spot, perp, funding, klines)
- `providers/coinbase.js` — REST Coinbase (spot fiat)
- `streams/websocket.js` — WebSocket multi-sources avec reconnexion automatique (backoff + jitter)
- `streams/polling.js` — Polling configurable par intervalle, pause auto si page cachée
- `normalizers/format_data.js` — Format canonique unifié (Ticker, Option, Funding, OI…)
- `data_store/cache.js` — Cache central avec TTL, historique et subscriptions réactives

**Architecture data_processing/**
- `volatility/greeks.js` — Black-Scholes pricing + Greeks (delta, gamma, vega, theta)
- `volatility/iv_rank.js` — IV Rank, IV Percentile, détection spike
- `volatility/skew.js` — Skew 25-delta, smile de volatilité
- `market_structure/term_structure.js` — Basis annualisé, contango/backwardation, signal DI
- `signals/signal_engine.js` — Score composite pondéré (IV 35% + funding 25% + basis 25% + IV/RV 15%)

**Architecture strategy_engine/**
- `strategies/dual_investment.js` — Calculs Dual Investment (premium, P&L, scoring BS)
- `decision_engine.js` — Moteur de décision Q-learning pour le DI

**Versioning**
- Version affichée dans la barre de navigation (UI)
- `vite.config.js` lit la version depuis `package.json` (source unique)
- `CHANGELOG.md` initialisé

### Modifié

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
