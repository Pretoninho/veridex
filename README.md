# Veridex — PWA Mobile

Application React PWA installable sur mobile pour l'analyse des marchés crypto dérivés :
options, futures, funding, IV, Greeks, signaux — données en temps réel depuis 3 exchanges.

## Onglets

| Onglet | Contenu |
|---|---|
| **Market** | Prix spot 3 exchanges (Deribit index, Binance, Coinbase), VWAP pondéré volume, spread cross-exchange |
| **Dérivés** | Funding perpétuel (Deribit · Binance), term structure futures + basis annualisé, Open Interest restructuré en 3 sous-sections (Deribit Options · Binance Perps · Signal Combiné), sentiment Long/Short (Binance), liquidations, countdown prochain fixing funding |
| **Options** | DVOL + IV Rank Deribit, structure à terme ATM IV, Greeks ATM (Black-Scholes), IV spread Deribit / Binance, OI, prix de règlement, onglet Signaux avec couche Expert/Simple (Claude API) |
| **Signaux** | Score composite global (IV · Funding · Basis · IV/RV · On-Chain · Positionnement), tableau positionnement croisé Retail/Institutionnels (mode Expert), 3 blocs recommandations indépendants (Spot / Futures / Options), couche Expert et Simple (6 tons paramétrables, génération Claude API) |
| **Volatilité** | ✅ IV/RV, Greeks, skew 25-delta, smile, term structure |
| **Chaîne Options** | ✅ Visualisation strikes Deribit, Greeks ATM, évaluation RL |
| **IV Live** | ✅ Tracker IV temps réel, alertes spike, historique |
| **Trade** | ✅ Gestion positions, P&L simulation, historique |
| **On-Chain** | Score on-chain composite, Mempool, Exchange Flows, Mining — couche Expert/Simple |
| **Audit** | Journal de hashage unifié (Signaux · Anomalies · Patterns · Cache), Vue générale avec stats et description des sources. Accessible via l'icône ⚙ dans le header. |

Le sélecteur d'actif (BTC / ETH) dans le header est global — il met à jour tous les onglets simultanément.

---

## Statut des fonctionnalités

| Onglet | Statut | Contenu |
|---|---|---|
| **Market** | ✅ Complet | Prix spot 3 exchanges, VWAP, spreads cross-exchange |
| **Dérivés** | ✅ Complet | Funding, futures, OI, liquidations, countdown funding |
| **Options** | ✅ Complet | IV cross-exchange, Greeks, OI multi-source |
| **Signaux** | ✅ Complet | Score composite, positionnement, recommandations IA |
| **Volatilité** | ✅ Complet | IV/RV, Greeks, skew, smile, term structure ATM |
| **Chaîne Options** | ✅ Complet | Chaîne strikes, Greeks temps réel, RL evaluation |
| **IV Live** | ✅ Complet | Tracker temps réel, alertes, historique CSV |
| **Trade** | ✅ Complet | Gestion positions, P&L simulation, historique |
| **On-Chain** | ✅ Complet | Composite score, Mempool, Exchange Flows, Mining |
| **Audit** | ✅ Complet | Journal de hashage, anomalies, patterns, stats cache |
| **Notifications** | ✅ Complet | Configuration seuils, cooldowns, historique |

---

## Architecture

```
src/
├── data_core/                      ← Couche données (source unique de vérité)
│   ├── providers/
│   │   ├── deribit.js              ← REST Deribit : index, options, DVOL, OI, funding, RV, settlement
│   │   ├── binance.js              ← REST Binance : spot, perp, funding, OI, sentiment, liquidations
│   │   ├── coinbase.js             ← REST Coinbase Exchange : spot fiat USD
│   │   └── onchain.js              ← On-chain : blockchain.info, mempool.space, Glassnode, CryptoQuant
│   ├── normalizers/
│   │   └── format_data.js          ← Format canonique unifié + validateDataFreshness + normalizeOnChain
│   ├── data_store/
│   │   └── cache.js                ← SmartCache FNV-1a (hash-based, évite re-renders React inutiles)
│   └── index.js                    ← Façade dataCore + exports unifiés
│
├── data_processing/                ← Calculs financiers et signaux
│   ├── volatility/
│   │   ├── greeks.js               ← Black-Scholes : delta, gamma, vega, theta
│   │   ├── iv_rank.js              ← IV Rank, IV Percentile, détection spike
│   │   └── skew.js                 ← Skew 25-delta
│   ├── market_structure/
│   │   └── term_structure.js       ← Basis annualisé, contango/backwardation
│   ├── history/
│   │   └── metric_history.js       ← Historique snapshots options
│   └── signals/
│       ├── signal_engine.js        ← Score composite (IV 30% · Funding 20% · Basis 20% · IV/RV 15% · On-Chain 10-15% · Positionnement 15%)
│       ├── signal_interpreter.js   ← 3 blocs recommandations : Spot / Futures / Options (+ contexte positionnement)
│       ├── positioning_score.js    ← Score s6 : divergence Retail (Binance L/S) vs Institutionnels (Deribit P/C)
│       ├── market_fingerprint.js   ← Fingerprint marché IndexedDB (pattern matching)
│       ├── onchain_signals.js      ← Signaux on-chain : Exchange flows, Mempool, Mining
│       ├── tone_config.js          ← 6 tons paramétrables (humor, formal, serious, pedagogical, motivational, storytelling)
│       └── novice_generator.js     ← Génération Claude API (claude-haiku) avec fallback statique
│
├── components/
│   ├── ToneSelector.jsx            ← Grille 3×2 de sélection du ton (couche Simple)
│   ├── ClockStatus.jsx             ← Indicateur drift horloges cross-exchange (invisible si OK)
│   ├── HashJournal.jsx             ← Journal unifié hashage (Signal/Anomalie/Pattern/Cache)
│   └── AuditBanner.jsx             ← Bandeau d'alerte anomalie fixe (dismissable, poll 30s)
│
├── pages/
│   ├── LandingPage.jsx             ← Écran d'accueil (splash) — prix BTC + ETH
│   ├── MarketPage.jsx              ← Onglet Market
│   ├── DerivativesPage.jsx         ← Onglet Dérivés (+ countdown funding)
│   ├── OptionsDataPage.jsx         ← Onglet Options (Analyse · Signaux Expert/Simple · Journal)
│   ├── SignalsPage.jsx             ← Onglet Signaux (Expert/Simple · 3 blocs · copie)
│   ├── VolPage.jsx                 ← Onglet Volatilité (IV/RV, Greeks, skew, smile)
│   ├── ChainPage.jsx               ← Onglet Chaîne Options (strikes, Greeks, RL evaluation)
│   ├── TrackerPage.jsx             ← Onglet IV Live (tracker temps réel, alertes, historique)
│   ├── OnChainPage.jsx             ← Onglet On-Chain
│   ├── TradePage.jsx               ← Onglet Trade
│   └── AuditPage.jsx               ← Onglet Audit (Vue générale · Journal de hashage)
│
├── App.jsx                         ← Shell : navigation, asset selector, clock sync, AuditBanner
└── App.css                         ← Thème dark + variables CSS
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

Affiché dans **SignalsPage** (mode Expert) sous forme de tableau avec ratios, badges colorés et action recommandée.
Affiché dans **DerivativesPage** sous le bloc Open Interest (3 sous-sections + Signal Combiné coloré).

### Interprétation 3 marchés

Pour chaque niveau de score, 3 recommandations indépendantes :

| Marché | Indicateurs clés |
|---|---|
| **Spot** | IV Rank, zones de support |
| **Futures/Perp** | Funding rate, cash-and-carry, contexte positionnement croisé si divergence |
| **Options** | IV Rank, straddle/strangle, strikes ATM ±8% |

### Couche Simple (Claude API)

- Génération via `claude-haiku-4-5-20251001` avec nonce aléatoire (variation garantie)
- 6 tons : 😄 Humour · 🎩 Formel · 🎯 Sérieux · 📚 Pédagogique · 🔥 Motivant · 📖 Récit
- Fallback statique si API indisponible
- Ton persisté par page (`selected_tone`, `options_tone`)

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

Consultable via l'icône ⚙ dans le header → onglet "Journal de hashage" :

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
npm test        # 188 tests Vitest
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
| Market | 15 s |
| Dérivés | 30 s |
| Options | 90 s |
| Signaux | Manuel (Refresh) |
| On-Chain | 60 s |

- `Promise.allSettled` partout — une source hors ligne ne bloque pas les autres
- Bouton "Refresh" manuel sur chaque onglet
- Bouton "MAJ" dans la barre de version : force la mise à jour du cache PWA (désenregistre le Service Worker)
