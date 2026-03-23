/**
 * strategy_engine/decision_engine.js
 *
 * Moteur de décision Q-learning pour la stratégie Dual Investment.
 * Migré depuis src/utils/rlDual.js — source canonique.
 *
 * Algorithme : Q-learning avec reward shaping multi-composantes.
 * Persistance : localStorage (Q-table + logs d'expérience).
 *
 * États : encodés en string (asset|side|days|apr|dist|iv|delta|dcaGap|pv|trap)
 * Actions : 'subscribe' | 'skip'
 */

export {
  encodeDualState,
  evaluateDualPolicy,
  learnFromSettlement,
  getDualRlMetrics,
  getDualRlSnapshot,
  getDualRewardConfig,
  updateDualRewardConfig,
  resetDualRewardConfig,
  resetDualRl,
} from '../utils/rlDual.js'
