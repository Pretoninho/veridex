# Veridex — Signal Validation Guide

> **Objectif** : transformer les données collectées en preuve d'edge reproductible et honnête.

---

## Table des matières

1. [Pourquoi valider ?](#1-pourquoi-valider-)
2. [Architecture des données](#2-architecture-des-données)
3. [Étape 1 — Settlement (labellisation des outcomes)](#étape-1--settlement-labellisation-des-outcomes)
4. [Étape 2 — Split temporel (train / test)](#étape-2--split-temporel-train--test)
5. [Étape 3 — Walk-Forward Validation](#étape-3--walk-forward-validation)
6. [Éviter le lookahead bias](#éviter-le-lookahead-bias)
7. [Métriques d'edge](#métriques-dedge)
8. [Export et analyse offline](#export-et-analyse-offline)
9. [Workflow recommandé end-to-end](#workflow-recommandé-end-to-end)
10. [Checklist avant toute décision de trading](#checklist-avant-toute-décision-de-trading)

---

## 1. Pourquoi valider ?

Collecter des données et calculer un win rate sur **tout l'historique** (in-sample) est trompeur :
- Le moteur de signal peut avoir été conçu/affiné en regardant des données passées → **overfit**.
- Des corrélations fortuites disparaissent hors-échantillon.
- Le marché évolue (régimes changeants).

La validation rigoureuse consiste à mesurer la performance **sur des données que le modèle n'a jamais vues au moment de la décision**.

---

## 2. Architecture des données

Veridex stocke trois tables :

| Table      | Contenu |
|------------|---------|
| `tickers`  | Snapshot de marché toutes les ~60s (spot, dvol, funding, OI, basis) |
| `signals`  | Signal calculé à chaque tick (type, score, composantes) |
| `outcomes` | Résultats labellisés à +1h / +4h / +24h après chaque signal |

Les `outcomes` sont produits automatiquement par le **settlement job** (`backend/workers/settlementJob.js`) qui tourne toutes les 5 minutes.

---

## Étape 1 — Settlement (labellisation des outcomes)

### Comment ça marche

Pour chaque signal émis à `t0` avec un prix `trigger_price` :

1. Le job attend que le temps actuel soit ≥ `t0 + 1h` / `t0 + 4h` / `t0 + 24h`.
2. Il cherche dans `tickers` le prix le plus proche du timestamp cible (tolérance ±2 min).
3. Il calcule le mouvement en % :  
   `move_pct = (price_at_horizon - trigger_price) / trigger_price * 100`
4. Il insère/met à jour la table `outcomes`.
5. Il labellise le signal (`WIN / LOSS / FLAT`) en utilisant un seuil dynamique basé sur la volatilité :  
   `threshold = k × σ_ann × √(T_days / 365)`  
   où `σ_ann` est la volatilité annualisée (DVOL en priorité, sinon RV) et `k` est configurable via `SETTLEMENT_K` (défaut : **0.75**).  
   WIN si le mouvement dépasse `+threshold` (LONG) ou `−threshold` (SHORT), LOSS dans le sens opposé, FLAT sinon.

### Configuration

| Variable d'environnement | Défaut   | Description |
|--------------------------|----------|-------------|
| `SETTLEMENT_INTERVAL_MS` | `300000` | Fréquence du job (ms) |
| `SETTLEMENT_K`           | `0.75`   | Multiplicateur du seuil de volatilité (`threshold = k × σ_ann × √(T/365)`) |

---

## Étape 2 — Split temporel (train / test)

### Règle fondamentale

**Ne jamais faire un split aléatoire.** Les données financières sont ordonnées dans le temps. Un split aléatoire crée du lookahead bias (les données de test peuvent précéder les données de train).

### Split recommandé

```
|─────────────── Données collectées ──────────────────|
|   TRAIN (calibration)   |  GAP  |   TEST (validation) |
|   70–80 %              |  0–5% |   20–30 %            |
|<── plus ancien ────────────────────── plus récent ──>|
```

- **Train** : les N premiers jours → ajustement des thresholds, paramètres.
- **Gap** (optionnel, ~7 jours) : évite que des signaux chevauchent les deux fenêtres.
- **Test** : les M derniers jours → mesure de l'edge **hors-échantillon**.

### Exemple pratique (30 jours de données)

```
Train  : jours 1–21  (70%)
Gap    : jours 22–23 (buffer)
Test   : jours 24–30 (23%)
```

### Comment réaliser le split avec l'API Veridex

```bash
# Exporter tous les signaux (30 jours)
curl "/analytics/export?asset=BTC&type=signals&format=json&days=30"

# Puis filtrer côté client selon le timestamp
```

---

## Étape 3 — Walk-Forward Validation

Le walk-forward est la méthode la plus robuste pour les systèmes de trading :

```
Fenêtre 1: Train [J1–J30]  → Test [J31–J37]
Fenêtre 2: Train [J8–J37]  → Test [J38–J44]
Fenêtre 3: Train [J15–J44] → Test [J45–J51]
...
```

### Paramètres typiques

| Paramètre              | Valeur recommandée |
|------------------------|--------------------|
| Taille fenêtre train   | 30 jours           |
| Taille fenêtre test    | 7 jours            |
| Pas (step)             | 7 jours            |
| Minimum de signaux     | ≥ 30 par fenêtre   |

### Interprétation

- **Win rate stable** sur toutes les fenêtres → edge robuste.
- **Win rate décroissant** dans le temps → signal qui s'érode (regime shift).
- **Win rate très variable** → pas assez de signaux, intervalle de confiance trop large.

---

## Éviter le lookahead bias

Le lookahead bias est le danger le plus insidieux : utiliser une information future pour prendre une décision passée.

### Sources courantes dans Veridex

| Risque | Mitigation |
|--------|------------|
| Utiliser les prix des `outcomes` pour calibrer les thresholds du signal | Ne jamais toucher aux paramètres du signal après avoir vu les outcomes |
| Normaliser les features (ex: IV rank) sur toute la période | Normaliser uniquement sur la fenêtre train, puis appliquer les mêmes paramètres au test |
| Sélectionner l'horizon (1h/4h/24h) en regardant lequel donne le meilleur résultat | Choisir l'horizon **avant** de regarder les métriques |
| Rejeter des signaux "outliers" après avoir vu qu'ils sont des pertes | Ne jamais filtrer les données de test a posteriori |

### Règle d'or

> Tout ce qui touche à la configuration du signal doit être décidé **avant** de regarder les données de test.

---

## Métriques d'edge

L'endpoint `/analytics/stats` retourne :

| Métrique               | Description | Seuil indicatif |
|------------------------|-------------|-----------------|
| `win_rate`             | % de signaux positifs | > 55% sur 30+ trades |
| `avg_return`           | Retour moyen par signal (%) | > 0 |
| `avg_gain`             | Gain moyen des signaux WIN | |
| `avg_loss`             | Perte moyenne des signaux LOSS | |
| `sharpe_ratio`         | Ratio Sharpe (rf=0) | > 0.5 significatif |
| `max_drawdown`         | Drawdown max sur l'equity curve (%) | < 20% acceptable |
| `trade_count`          | Nombre de signaux settléd | ≥ 30 pour significativité |
| `exposure_time_pct`    | % du temps en position (approx.) | |
| `confidence_interval_95` | IC 95% de l'avg_return | Doit exclure 0 |
| `horizon_breakdown`    | Métriques par horizon (1h/4h/24h) | |
| `confusion_matrix`     | WIN/LOSS/FLAT par type de signal | |

### Significativité statistique

Avec `n` trades, le t-test sur le retour moyen est :

```
t = avg_return / (std / sqrt(n))
```

Pour être significatif à 95% (p < 0.05), `|t| > 1.96` (ou ~2.0 pour n < 30).

Si `confidence_interval_95` **exclut 0**, l'edge est statistiquement significatif.

---

## Export et analyse offline

```bash
# Exporter les signaux avec outcomes (CSV, 30 derniers jours)
curl "http://localhost:3000/analytics/export?asset=BTC&type=signals&format=csv&days=30" \
  -o btc_signals_30d.csv

# Exporter les ticks (JSON)
curl "http://localhost:3000/analytics/export?asset=BTC&type=ticks&format=json&days=7" \
  -o btc_ticks_7d.json

# Exporter les outcomes uniquement
curl "http://localhost:3000/analytics/export?asset=BTC&type=outcomes&format=csv&days=30" \
  -o btc_outcomes_30d.csv
```

### Analyse Python (exemple)

```python
import pandas as pd
import numpy as np
from datetime import timedelta

df = pd.read_csv('btc_signals_30d.csv')
df['timestamp_dt'] = pd.to_datetime(df['timestamp'], unit='ms')
df = df.sort_values('timestamp_dt').reset_index(drop=True)

# Temporal split: train = first 70% of the time window, test = last 30%
time_min   = df['timestamp_dt'].min()
time_max   = df['timestamp_dt'].max()
split_date = time_min + (time_max - time_min) * 0.70

train = df[df['timestamp_dt'] <= split_date]
test  = df[df['timestamp_dt'] >  split_date]

# Métriques test
settled_test = test[test['move_4h_pct'].notna()]
win_rate = (settled_test['move_4h_pct'] > 0).mean()
avg_ret  = settled_test['move_4h_pct'].mean()
sharpe   = avg_ret / settled_test['move_4h_pct'].std() if settled_test['move_4h_pct'].std() else None

print(f"Test win rate : {win_rate:.1%}")
print(f"Avg return 4h: {avg_ret:.4f}%")
print(f"Sharpe       : {sharpe:.2f}" if sharpe else "Sharpe: N/A")
print(f"N trades     : {len(settled_test)}")
```

---

## Workflow recommandé end-to-end

```
1. Collecter des données (ENABLE_COLLECTOR=true)
   └─ Au moins 30 jours pour avoir une base statistique

2. Attendre que le settlement job labellise les outcomes
   └─ /health?include_collector=true → vérifier settlement.settledCount

3. Vérifier les métriques globales (in-sample)
   └─ GET /analytics/stats?asset=BTC&days=30&horizon=4h

4. Export et split temporel
   └─ GET /analytics/export?asset=BTC&type=signals&format=csv&days=30
   └─ Train : premiers 21 jours
   └─ Test  : derniers 9 jours

5. Mesurer les métriques sur le test uniquement
   └─ Si win_rate > 55% ET CI95 exclut 0 ET n ≥ 30 → edge valide

6. Walk-forward (optionnel, recommandé)
   └─ Glisser la fenêtre train/test sur l'historique complet
   └─ Vérifier la stabilité du win_rate

7. Si edge confirmé
   └─ Paper trading → mesurer le slippage réel
   └─ Définir les règles de sizing et de risk management
   └─ Déployer progressivement
```

---

## Checklist avant toute décision de trading

- [ ] Au moins **30 signaux settléd** dans la fenêtre de test
- [ ] **Confidence interval 95%** exclut 0 (statistiquement significatif)
- [ ] **Win rate stable** sur plusieurs fenêtres walk-forward
- [ ] **Max drawdown** acceptable pour ton risk profile
- [ ] Aucun **lookahead bias** identifié dans le processus
- [ ] Edge testé sur **au moins 2 régimes** de marché différents (high/low vol)
- [ ] Performance similaire sur **BTC et ETH** (robustesse cross-asset)
- [ ] Thresholds du signal **fixés avant** de regarder les données de test

---

*Ce guide est une base. Pour les systèmes en production, consulter des ressources spécialisées en backtesting quantitatif (ex: Marcos Lopez de Prado — "Advances in Financial Machine Learning").*
