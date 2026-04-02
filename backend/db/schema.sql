-- Veridex Data Collection Schema
-- Compatible with SQLite and PostgreSQL

CREATE TABLE IF NOT EXISTS tickers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  asset      VARCHAR(10)    NOT NULL,
  timestamp  BIGINT         NOT NULL,
  spot       DECIMAL(20,8),
  iv_rank    DECIMAL(5,2),
  funding    DECIMAL(8,4),
  oi         DECIMAL(20,2),
  skew       DECIMAL(8,4),
  basis      DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickers_asset_ts ON tickers (asset, timestamp);

CREATE TABLE IF NOT EXISTS signals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  asset             VARCHAR(10)    NOT NULL,
  timestamp         BIGINT         NOT NULL,
  signal_type       VARCHAR(20),
  trigger_price     DECIMAL(20,8),
  signal_score      DECIMAL(5,2),
  components        TEXT,
  outcome           VARCHAR(20),
  outcome_price     DECIMAL(20,8),
  outcome_timestamp BIGINT,
  pnl               DECIMAL(10,4),
  direction         VARCHAR(10),
  vol_source        VARCHAR(10),
  vol_ann           DECIMAL(10,6),
  k                 DECIMAL(5,3),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_asset_ts ON signals (asset, timestamp);

CREATE TABLE IF NOT EXISTS outcomes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id        INTEGER NOT NULL,
  asset            VARCHAR(10),
  price_1h_after   DECIMAL(20,8),
  price_4h_after   DECIMAL(20,8),
  price_24h_after  DECIMAL(20,8),
  move_1h_pct      DECIMAL(8,4),
  move_4h_pct      DECIMAL(8,4),
  move_24h_pct     DECIMAL(8,4),
  threshold_1h     DECIMAL(10,6),
  label_1h         VARCHAR(10),
  threshold_4h     DECIMAL(10,6),
  label_4h         VARCHAR(10),
  threshold_24h    DECIMAL(10,6),
  label_24h        VARCHAR(10),
  settled_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outcomes_signal_id ON outcomes (signal_id);
