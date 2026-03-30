# Veridex — PWA Mobile

**v2.0: Deribit + On-Chain only**

Application React PWA installable sur mobile pour l'analyse des marchés crypto dérivés :
options, futures, funding, IV, Greeks, signaux — données en temps réel depuis Deribit + analyse on-chain.

## Onglets

| Onglet | Contenu |
|---|---|
| **Market** | Prix spot Deribit Index, liquidité du carché |
| **Dérivés** | Funding perpétuel Deribit, term structure futures + basis annualisé, Open Interest Deribit perpetuals, countdown prochain fixing funding |
| **Options** | DVOL + IV Rank Deribit, structure à terme ATM IV, Greeks ATM (Black-Scholes), OI Deribit, prix de règlement, onglet Signaux avec recommandations stratégies |
| **Signaux** | Score composite global (IV · Funding · Basis · IV/RV · On-Chain · Positionnement), top patterns par EV, clustering Bull/Bear, confluence multi-signaux, insights analytiques (Claude API), 3 blocs recommandations indépendants (Spot / Futures / Options) |
| **Volatilité** | IV/RV, Greeks ATM (Black-Scholes), skew 25-delta, smile, term structure — chargement manuel |
| **IV Live** | Tracker IV temps réel, alertes spike, historique CSV — streaming WebSocket ou polling configurable |
| **Trade** | Gestion positions paper trading, P&L simulation, historique settlements |
| **Assistant** | Moteur de décision IA (LONG/SHORT/NEUTRAL), simulation portfolio, régime de marché, Monte Carlo, risque de ruine |
| **On-Chain** | Score on-chain composite, Fear & Greed, Mempool, Exchange Flows, Mining, whale transactions |
| **Audit** | Journal de hashage unifié (Signaux · Anomalies · Patterns · Cache), Vue générale avec stats et description des sources. Accessible via l'icône ≡ dans le header. |
| **Notifications** | Configuration seuils d'alerte push, cooldowns anti-spam, historique des 20 dernières notifications |
| **Calibration** | Paramètres de calibration des seuils signaux : IV, Funding, Basis, IV/RV, anomalies, bucketing patterns |

Le sélecteur d'actif (BTC / ETH) dans le header est global — il met à jour tous les onglets simultanément.

---

## Mode d’emploi — page Calibration

La page **Calibration** permet d’ajuster les seuils utilisés par le moteur de signaux, la détection d’anomalies et le bucketing des patterns. Les changements sont appliqués **en temps réel** et **persistés dans le localStorage** (ils restent actifs après rechargement).

### Accès
- Ouvrez l’onglet **Calibration** depuis la navigation.
- Un bandeau en haut indique le nombre de paramètres modifiés.

### Organisation des sections
Chaque carte correspond à un groupe de seuils :
- **Filtre DVOL** (marché calme/agité)
- **Score IV** (ratio IV courante / moyenne 30j)
- **Score Funding** (% annualisé)
- **Score Basis** (% annualisé)
- **Score IV/RV** (prime IV − RV en points)
- **Signal global** (seuils du score composite)
- **Détection d’anomalies** (nb d’indicateurs et fenêtre)
- **Bucketing des patterns** (mouvements prix, spreads, basis)
- **Positioning** (P/C ratio Deribit institutionnel)
- **Convergence** (minimums de critères)
- **On-Chain** (Fear & Greed, Hash Rate, score)

### Modifier un seuil
- Saisissez une nouvelle valeur dans le champ numérique.
- Les **unités** sont indiquées à droite (%, pts, ms, etc.).
- Un **point jaune** apparaît si la valeur diffère du défaut.

### Réinitialiser
- **Reset** à droite d’un paramètre : remet uniquement ce seuil à sa valeur par défaut.
- **Réinitialiser tous les paramètres** (bouton en bas) : restaure l’ensemble des valeurs par défaut.

### Bonnes pratiques
- Ajustez par petites étapes pour isoler l’effet sur les scores.
- Conservez un ordre logique des seuils (t1 < t2 < t3 < t4) pour éviter des scores incohérents.
- Les seuils **Funding/Basis** sont en **% annualisé**, et les mouvements **Patterns** en **% de prix**.

---

## Statut des fonctionnalités

| Onglet | Statut | Contenu |
|---|---|---|
| **Market** | ✅ Complet | Prix spot Deribit Index |
| **Dérivés** | ✅ Complet | Funding Deribit, futures, OI, countdown funding |
| **Options** | ✅ Complet | IV Deribit, Greeks, OI Deribit, settlements |
| **Signaux** | ✅ Complet | Score composite, patterns EV, confluence, insights IA |
| **Volatilité** | ✅ Complet | IV/RV, Greeks, skew, smile, term structure ATM |
| **IV Live** | ✅ Complet | Tracker temps réel, alertes, historique CSV, WebSocket |
| **Trade** | ✅ Complet | Gestion positions paper trading, P&L, historique |
| **Assistant** | ✅ Complet | Décision IA, portfolio simulation, Monte Carlo, régime marché |
| **On-Chain** | ✅ Complet | Composite score, Fear & Greed, Mempool, Exchange Flows, Mining |
| **Audit** | ✅ Complet | Journal de hashage, anomalies, patterns, stats cache |
| **Notifications** | ✅ Complet | Configuration seuils, cooldowns, historique |
| **Calibration** | ✅ Complet | Paramètres IV, Funding, Basis, IV/RV, anomalies, patterns |

---

## Architecture

```
src/
├── data/                           ← Couche données (source unique de vérité)
│   ├── providers/
│   │   ├── deribit.js              ← REST Deribit : index, options, DVOL, OI, funding, RV, settlement
│   │   ├── onchain.js              ← On-chain : blockchain.info, mempool.space, Glassnode, CryptoQuant
│   │   └── clock_sync.js           ← Synchronisation horloge Deribit
│   ├── normalizers/
│   │   └── format_data.js          ← Format canonique unifié + validateDataFreshness + normalizeOnChain
│   ├── data_store/
│   │   └── cache.js                ← SmartCache FNV-1a (hash-based, évite re-renders React inutiles)
│   ├── streams/
│   │   ├── polling.js              ← Polling REST générique
│   │   └── websocket.js            ← WebSocket Deribit (IV Live)
│   └── index.js                    ← Façade données + exports unifiés
│
├── core/                           ← Calculs financiers de base
│   ├── volatility/
│   │   ├── greeks.js               ← Black-Scholes : delta, gamma, vega, theta
│   │   ├── iv_rank.js              ← IV Rank, IV Percentile, détection spike
│   │   ├── skew.js                 ← Skew 25-delta
│   │   └── max_pain.js             ← Calcul Max Pain options
│   ├── market_structure/
│   │   └── term_structure.js       ← Basis annualisé, contango/backwardation
│   ├── history/
│   │   └── metric_history.js       ← Historique snapshots options
│   └── index.js
│
├── signals/                        ← Moteur de signaux et détection
│   ├── signal_engine.js            ← Score composite (IV 30% · Funding 20% · Basis 20% · IV/RV 15% · On-Chain 10-15% · Positionnement 15%)
│   ├── signal_interpreter.js       ← 3 blocs recommandations : Spot / Futures / Options (+ contexte positionnement)
│   ├── signal_calibration.js       ← Paramètres de calibration persistés (localStorage)
│   ├── positioning_score.js        ← Score s6 : divergence Retail (Binance L/S) vs Institutionnels (Deribit P/C)
│   ├── market_fingerprint.js       ← Fingerprint marché IndexedDB (pattern matching)
│   ├── onchain_signals.js          ← Signaux on-chain : Exchange flows, Mempool, Mining
│   ├── insight_generator.js        ← Insights analytiques courts via Claude API (claude-haiku) par métrique
│   ├── probability_engine.js       ← Probabilités conditionnelles par pattern
│   ├── convergence.js              ← Détection convergence multi-signaux
│   ├── notification_engine.js      ← Vérification seuils + envoi notifications push
│   ├── notification_manager.js     ← Gestion permission + historique notifications
│   ├── settlement_tracker.js       ← Watcher settlement quotidien Deribit (08:00 UTC)
│   ├── snapshot_generator.js       ← Génération snapshots de patterns
│   ├── snapshot_importer.js        ← Import initial snapshots BTC/ETH
│   └── index.js
│
├── analytics/                      ← Analyse avancée et simulation
│   ├── decision_engine.js          ← Décision LONG/SHORT/NEUTRAL (seuils + contexte)
│   ├── pattern_engine.js           ← Analyse patterns de marché (EV, clustering)
│   ├── pattern_cluster.js          ← Clustering patterns Bull/Bear × Fort/Modéré
│   ├── signal_confluence.js        ← Confluence multi-signaux
│   ├── strategy_engine.js          ← Recommandations stratégies options (radar, skew)
│   ├── market_regime.js            ← Détection régime : Trending / Choppy / Mean-Reverting
│   ├── portfolio_simulator.js      ← Simulation paper trading (P&L, win rate, equity curve)
│   ├── monte_carlo.js              ← Monte Carlo : distribution des rendements
│   └── risk.js                     ← Risque de ruine
│
├── api/
│   └── backend.js                  ← Façade vers les API exchanges (fetch market + signals)
│
├── interface/
│   ├── components/
│   │   ├── NavDrawer.jsx           ← Drawer de navigation latéral
│   │   ├── AuditBanner.jsx         ← Bandeau d'alerte anomalie fixe (dismissable, poll 30s)
│   │   ├── ClockStatus.jsx         ← Indicateur drift horloges cross-exchange (invisible si OK)
│   │   ├── HashJournal.jsx         ← Journal unifié hashage (Signal/Anomalie/Pattern/Cache)
│   │   ├── SnapshotManager.jsx     ← Gestion imports/exports de snapshots
│   │   ├── MaxPainChart.jsx        ← Visualisation Max Pain
│   │   └── VLogo.jsx               ← Logo Veridex animé
│   ├── pages/
│   │   ├── LandingPage.jsx         ← Écran d'accueil (splash) — prix BTC + ETH
│   │   ├── MarketPage.jsx          ← Onglet Market
│   │   ├── DerivativesPage.jsx     ← Onglet Dérivés (+ countdown funding)
│   │   ├── OptionsDataPage.jsx     ← Onglet Options (Analyse · Signaux · Journal)
│   │   ├── SignalsPage.jsx         ← Onglet Signaux (patterns, confluence, insights IA)
│   │   ├── VolPage.jsx             ← Onglet Volatilité (IV/RV, Greeks, skew, smile)
│   │   ├── TrackerPage.jsx         ← Onglet IV Live (tracker temps réel, alertes, historique)
│   │   ├── TradePage.jsx           ← Onglet Trade (paper trading, P&L, settlements)
│   │   ├── AssistantPage.jsx       ← Onglet Assistant (décision IA, simulation portfolio)
│   │   ├── OnChainPage.jsx         ← Onglet On-Chain
│   │   ├── CalibrationPage.jsx     ← Onglet Calibration (paramètres signaux/patterns)
│   │   ├── NotificationSettingsPage.jsx ← Onglet Notifications
│   │   └── AuditPage.jsx           ← Onglet Audit (Vue générale · Journal de hashage)
│   ├── App.jsx                     ← Shell : navigation, asset selector, clock sync, AuditBanner
│   └── App.css                     ← Thème dark + variables CSS
│
└── main.jsx
```

---

## Système de signaux

### Score composite global (0–100)

| Composante | Poids | Source |
|---|---|---|
| Volatilité IV (DVOL / IV Rank) | 30% | Deribit |
| Funding Rate annualisé | 20% | Deribit perp |
| Basis Futures (contango/backwardation) | 20% | Deribit futures datés |
| Prime IV/RV | 15% | DVOL vs Realized Vol |
| On-Chain | 10% (15% si s6 absent) | blockchain.info · mempool.space · Glassnode |
| **Positionnement (s6)** | **15%** (optionnel) | Binance Long/Short · Deribit Put/Call OI |

> **Rétrocompatibilité :** si les données Binance L/S ou Deribit OI sont indisponibles, s6 = null et le poids de l'On-Chain remonte à 15% — le comportement est identique à l'ancienne version.

### Positionnement croisé Retail vs Institutionnels

Le module `positioning_score.js` calcule la divergence entre :
- **Retail** — Long/Short ratio Binance (`lsRatio`) : > 1.2 = retail long, < 0.8 = retail short
- **Institutionnels** — Put/Call ratio Deribit (`pcRatio`) : < 0.85 = offensif (calls), > 1.15 = défensif (puts)

| Situation | Type | Signal |
|---|---|---|
| Retail long + Instit défensif | Divergence contrarian | Baissier |
| Retail short + Instit offensif | Divergence contrarian | Haussier |
| Retail long + Instit offensif | Consensus | Haussier (momentum) |
| Retail short + Instit défensif | Consensus | Baissier (momentum) |

Affiché dans **SignalsPage** sous forme de tableau avec ratios, badges colorés et action recommandée.
Affiché dans **DerivativesPage** sous le bloc Open Interest (3 sous-sections + Signal Combiné coloré).

### Interprétation 3 marchés

Pour chaque niveau de score, 3 recommandations indépendantes :

| Marché | Indicateurs clés |
|---|---|
| **Spot** | IV Rank, zones de support |
| **Futures/Perp** | Funding rate, cash-and-carry, contexte positionnement croisé si divergence |
| **Options** | IV Rank, straddle/strangle, strikes ATM ±8% |

### Insights analytiques (Claude API)

- Génération via `claude-haiku-4-5-20251001` — 1 phrase technique (15–25 mots) par métrique
- Métriques supportées : `iv_rank`, `funding`, `basis`, `iv_rv`, `pattern`, `positioning`
- Cache mémoire 5 min (évite les appels répétés)
- Fallback statique si API indisponible
- Utilisé dans **SignalsPage** sous forme de chips d'insight (biais bullish/bearish/neutral)

---

## Assistant (moteur de décision IA)

Le module `analytics/` fournit une couche d'analyse avancée consommée par **AssistantPage** :

| Module | Rôle |
|---|---|
| `decision_engine.js` | Décision LONG/SHORT/NEUTRAL à partir du score composite et du contexte |
| `pattern_engine.js` | Détection et scoring des patterns historiques (EV 1h/4h/24h) |
| `pattern_cluster.js` | Clustering Bull/Bear × Fort/Modéré pour résumé visuel |
| `signal_confluence.js` | Score de confluence multi-signaux (alignement IV · Funding · Basis · On-Chain) |
| `strategy_engine.js` | Recommandations stratégies options (radar 5 stratégies : Straddle, Risk Reversal, Calendar, Butterfly, Directionnel) |
| `market_regime.js` | Détection régime : Trending / Choppy / Mean-Reverting |
| `portfolio_simulator.js` | Simulation paper trading — application automatique des décisions, equity curve, win rate |
| `monte_carlo.js` | Monte Carlo N=1000 — distribution des rendements et intervalles de confiance |
| `risk.js` | Risque de ruine à partir du win rate et du ratio risk/reward |

Le rafraîchissement est automatique toutes les **30 secondes** — aucune intervention utilisateur requise.

---

## Système de hashage (SmartCache + Journal d'audit)

- **FNV-1a 32-bit** — hash pur JS, sans dépendance externe
- `SmartCache.set(key, data)` → retourne `true` uniquement si les données ont changé
- `SmartCache.changeLog` — journal circulaire (max 500 entrées) `{ key, hash, ts }` des changements détectés
- Évite les re-renders React inutiles sur polling fréquent
- **Détection d'anomalies** : 3+ indicateurs changent en < 10s → persisté dans `localStorage` (`veridex_anomaly_log`, max 200 entrées, déduplication 60s)
- **Market Fingerprint** (IndexedDB) : bucketise les conditions de marché, enregistre les résultats +1h/+4h/+24h, index des hashes connus (`mf_index`)
- **Versioning signaux** (IndexedDB) : déduplication via hash du contexte

### Journal de hashage (AuditPage)

Consultable via le menu ≡ dans le header → onglet "Journal de hashage" :

| Type | Source | Champs clés |
|---|---|---|
| Signal | IndexedDB `signal_history` | hash, asset, score, conditions, recommendation, marketHash |
| Anomalie | localStorage `veridex_anomaly_log` | hash, severity (warning/critical), changedIndicators |
| Pattern | IndexedDB `mf_*` + index `mf_index` | hash, occurrences, winRate_1h/4h, avgMove_24h, config |
| Cache | `smartCache.changeLog` (mémoire) | key, hash, ts |

Lecture seule — aucun appel API, aucun signal généré.

### AuditBanner

Bandeau fixe en bas d'écran (au-dessus de la nav) si anomalie < 10 min :
- **Warning** (3–4 indicateurs) → fond ambre
- **Critique** (5+ indicateurs) → fond rouge
- Dismissable pour 10 min via `sessionStorage`

---

## Démarrage rapide

```bash
npm install
npm run dev     # → http://localhost:5173
npm run build   # build de production
npm test        # 410 tests Vitest
```

Variables d'environnement optionnelles :
```bash
VITE_ANTHROPIC_API_KEY=sk-ant-...   # Optionnel — commentaires experts Claude
VITE_CRYPTOQUANT_API_KEY=           # Optionnel — exchange flows on-chain (tier gratuit sur cryptoquant.com)
```

> **Note :** Si `VITE_CRYPTOQUANT_API_KEY` est absent, la section Exchange Flows affiche un message explicatif et le score on-chain est calculé sans cette composante (comportement identique à l'ancienne version Glassnode N/A).

---

## Installation

### Prérequis
- Node.js 18+
- npm ou yarn

### Setup local

```bash
# Cloner le repo
git clone https://github.com/Pretoninho/veridex.git
cd veridex

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos API keys (Deribit, Binance, Coinbase, etc.)

# Démarrer en développement
npm run dev

# Build pour production
npm run build
```

### Variables d'environnement requises
Voir `.env.example` pour la liste complète.

---

## 🚀 Déploiement GitHub Pages

Le workflow `.github/workflows/deploy.yml` se déclenche automatiquement à chaque push sur `main` :
1. `npm ci` → `npm test` → `npm run build`
2. Upload du dossier `dist/` sur GitHub Pages

Dans **Settings → Pages → Source → GitHub Actions**.

### Depuis GitHub Actions
Un workflow est fourni pour déployer automatiquement sur GitHub Pages.

1. Activer GitHub Pages dans Settings → Pages
2. Sélectionner branche `main` et dossier `dist`
3. Push sur main — le build se lance automatiquement

### Build manuel
```bash
npm run build
# Les fichiers sont dans le dossier dist/
```

### URL de déploiement
https://pretoninho.github.io/veridex/

---

## 📱 Installer sur mobile (PWA)

**iPhone (Safari)** : Partager ↑ → "Sur l'écran d'accueil"

**Android (Chrome)** : Menu ⋮ → "Ajouter à l'écran d'accueil"

---

## 📡 APIs utilisées

| Source | Endpoints | Données |
|---|---|---|
| **Deribit API v2** | `get_index_price`, `get_volatility_index_data`, `get_funding_rate_value`, `get_funding_rate_history`, `get_book_summary_by_currency`, `get_delivery_prices`, `get_instruments`, `public/ticker` | Index, options, DVOL, funding, OI, settlement, term structure |
| **Binance Spot** | `/api/v3/ticker/24hr` | Prix spot USDT |
| **Binance Futures** | `/fapi/v1/*`, `/futures/data/*` | Perp, funding, OI, sentiment, liquidations |
| **Binance Options** | `/eapi/v1/mark` | Mark IV options européennes |
| **Binance Futures** | `/futures/data/globalLongShortAccountRatio` | Long/Short ratio (s6) |
| **Coinbase Exchange** | `/products/{id}/ticker` | Spot fiat USD |
| **blockchain.info** | `/stats` | Stats réseau Bitcoin |
| **mempool.space** | `/api/mempool`, `/api/v1/fees/recommended`, `/api/v1/mining/hashrate/1m`, `/api/mempool/recent` | Mempool, frais, hash rate, whale tx |
| **CryptoQuant** | `/v1/btc/exchange-flows/netflow`, `/v1/eth/exchange-flows/netflow` | Exchange netflow BTC/ETH (clé API gratuite requise) |
| **alternative.me** | `/fng/?limit=2` | Fear & Greed Index |
| **Anthropic API** | `/v1/messages` (claude-haiku-4-5-20251001) | Commentaires experts courts |

Toutes les APIs exchange sont **publiques** — aucune clé requise sauf Anthropic (optionnelle) et CryptoQuant (optionnelle, tier gratuit).

---

## 🔧 Polling & mise à jour

| Page | Intervalle |
|---|---|
| Market | 10 s |
| Dérivés | 30 s |
| Options | 90 s |
| Signaux | 5 min (auto) |
| On-Chain | 60 s (principal) · 5 min (whales, flows) |
| Assistant | 30 s |
| IV Live | Configurable 30–600 s (WebSocket ou REST) |

- `Promise.allSettled` partout — une source hors ligne ne bloque pas les autres
- Bouton "Refresh" manuel sur chaque onglet
- Bouton "MAJ" dans la barre de version : force la mise à jour du cache PWA (désenregistre le Service Worker)
