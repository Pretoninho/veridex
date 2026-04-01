/**
 * backend/workers/dataStore.js
 *
 * Persistence layer for Veridex data collection.
 * Uses SQLite for local development and PostgreSQL for production.
 * Switches automatically based on DATABASE_URL environment variable.
 */

'use strict'

const path = require('path')
const fs   = require('fs')

// ── Database abstraction ──────────────────────────────────────────────────────

let _db     = null
let _isPg   = false
let _pgPool = null

/**
 * Initialize the database connection and create tables if they don't exist.
 * @returns {Promise<void>}
 */
async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL

  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    await _initPostgres(databaseUrl)
  } else {
    _initSqlite()
  }
}

function _initSqlite() {
  // eslint-disable-next-line node/no-unpublished-require
  const Database = require('better-sqlite3')
  const dbDir  = path.join(__dirname, '../data')
  const dbFile = path.join(dbDir, 'veridex.db')

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  _db   = new Database(dbFile)
  _isPg = false

  _db.pragma('journal_mode = WAL')

  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')
  _db.exec(schema)

  console.log(`[dataStore] SQLite initialized at ${dbFile}`)
}

async function _initPostgres(connectionString) {
  const { Pool } = require('pg')

  // SSL is required on Railway and most managed Postgres providers.
  // `rejectUnauthorized: false` is intentional: Railway's Postgres uses a
  // self-signed certificate that cannot be verified against standard CA bundles.
  // To use full certificate validation, set PGSSLMODE=verify-full and provide
  // PGSSLROOTCERT pointing to the provider's CA certificate bundle.
  // Set PGSSLMODE=disable only for plain local Postgres (no SSL).
  const sslMode = process.env.PGSSLMODE
  let sslOption
  if (sslMode === 'disable') {
    sslOption = false
  } else if (sslMode === 'verify-full') {
    sslOption = { rejectUnauthorized: true }
  } else {
    // Default: require SSL but allow self-signed certs (Railway-compatible)
    sslOption = { rejectUnauthorized: false }
  }
  _pgPool = new Pool({
    connectionString,
    max: 10,
    ssl: sslOption,
  })
  _isPg   = true

  // PostgreSQL-compatible schema (uses SERIAL instead of INTEGER PRIMARY KEY AUTOINCREMENT)
  const pgSchema = `
    CREATE TABLE IF NOT EXISTS tickers (
      id         SERIAL PRIMARY KEY,
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
      id                SERIAL PRIMARY KEY,
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
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_signals_asset_ts ON signals (asset, timestamp);

    CREATE TABLE IF NOT EXISTS outcomes (
      id               SERIAL PRIMARY KEY,
      signal_id        INTEGER NOT NULL,
      asset            VARCHAR(10),
      price_1h_after   DECIMAL(20,8),
      price_4h_after   DECIMAL(20,8),
      price_24h_after  DECIMAL(20,8),
      move_1h_pct      DECIMAL(8,4),
      move_4h_pct      DECIMAL(8,4),
      move_24h_pct     DECIMAL(8,4),
      settled_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_signal_id ON outcomes (signal_id);
  `

  await _pgPool.query(pgSchema)

  console.log('[dataStore] PostgreSQL initialized')
}

/**
 * Verify the database connection by running a lightweight SELECT 1.
 * Returns an object with { ok: boolean, latencyMs: number, error?: string }.
 */
async function testConnection() {
  if (!_isPg && !_db) {
    return { ok: false, error: 'Database not initialized' }
  }
  const start = Date.now()
  try {
    if (_isPg) {
      await _pgPool.query('SELECT 1')
    } else {
      _db.prepare('SELECT 1').all()
    }
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message }
  }
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

/**
 * Insert a row into a table.
 * @param {string} table
 * @param {Record<string, any>} data
 * @returns {Promise<number>} inserted row id
 */
async function insert(table, data) {
  const keys   = Object.keys(data)
  const values = Object.values(data)

  if (_isPg) {
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING id`
    const result = await _pgPool.query(sql, values)
    return result.rows[0].id
  } else {
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    const stmt = _db.prepare(sql)
    const result = stmt.run(...values)
    return result.lastInsertRowid
  }
}

/**
 * Query rows from a table.
 * @param {string} sql  — parameterized query
 * @param {any[]}  params
 * @returns {Promise<any[]>}
 */
async function query(sql, params = []) {
  if (_isPg) {
    // Convert ? placeholders to $1, $2, ...
    let i = 0
    const pgSql = sql.replace(/\?/g, () => `$${++i}`)
    const result = await _pgPool.query(pgSql, params)
    return result.rows
  } else {
    return _db.prepare(sql).all(...params)
  }
}

/**
 * Update rows in a table.
 * @param {string} sql
 * @param {any[]}  params
 * @returns {Promise<void>}
 */
async function run(sql, params = []) {
  if (_isPg) {
    let i = 0
    const pgSql = sql.replace(/\?/g, () => `$${++i}`)
    await _pgPool.query(pgSql, params)
  } else {
    _db.prepare(sql).run(...params)
  }
}

/**
 * Returns true if the database has been initialized.
 */
function isReady() {
  return _isPg ? _pgPool !== null : _db !== null
}

module.exports = { initDatabase, testConnection, insert, query, run, isReady }
