/**
 * signals/calibration_profiles.js
 *
 * Profils de calibration prédéfinis pour le système de signaux.
 * Chaque profil définit des surcharges partielles appliquées par-dessus
 * DEFAULT_CALIBRATION dans signal_calibration.js.
 *
 * Profils disponibles :
 *   - sensitive   : Très sensible — déclenche tôt, seuils bas
 *   - balanced    : Équilibré     — valeurs par défaut (aucune surcharge)
 *   - conservative: Conservateur  — ne déclenche que sur signaux forts
 */

export const CALIBRATION_PROFILES = {
  sensitive: {
    label: 'Très sensible',
    description: 'Détecte les signaux tôt, seuils bas — plus de faux positifs',
    params: {
      // Score IV — ratios plus bas = signal déclenche plus tôt
      iv_ratio_t1: 0.70,
      iv_ratio_t2: 0.85,
      iv_ratio_t3: 0.95,
      iv_ratio_t4: 1.10,

      // Score Funding — seuils plus bas
      funding_t2: 3,
      funding_t3: 10,
      funding_t4: 20,

      // Signal global — classification plus permissive
      signal_unfav_max: 30,
      signal_neutr_max: 50,
      signal_fav_max:   70,

      // Anomalies — fenêtre plus large, seuil plus bas
      anomaly_threshold: 2,
    },
  },

  balanced: {
    label: 'Équilibré',
    description: 'Paramètres par défaut — compromis sensibilité / précision',
    params: {},
  },

  conservative: {
    label: 'Conservateur',
    description: 'Signaux forts uniquement — moins de bruit, moins de faux positifs',
    params: {
      // Score IV — ratios plus hauts = signal déclenche plus tard
      iv_ratio_t1: 0.90,
      iv_ratio_t2: 1.00,
      iv_ratio_t3: 1.15,
      iv_ratio_t4: 1.30,

      // Score Funding — seuils plus hauts
      funding_t2: 8,
      funding_t3: 20,
      funding_t4: 40,

      // Signal global — classification plus stricte
      signal_unfav_max: 45,
      signal_neutr_max: 65,
      signal_fav_max:   85,

      // Anomalies — seuil plus élevé
      anomaly_threshold: 4,
    },
  },
}

/** Nom du profil appliqué si aucune sélection n'est persistée. */
export const DEFAULT_PROFILE_NAME = 'balanced'
