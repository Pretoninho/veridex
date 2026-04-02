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
  try {
    // eslint-disable-next-line node/no-unpublished-require
    const Database = require('better-sqlite3')
    const dbDir  = path.join(__dirname, '../data')
    const dbFile = path.join(dbDir, 'veridex.db')

    console.log(`[dataStore] _initSqlite() starting — dbFile=${dbFile}`)

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    // Delete any existing database file so the app always starts with a fresh
    // schema.  SQLite is stored on ephemeral container storage (no persistent
    // volume), so there is no data worth preserving across deployments.  Stale
    // files from previous deployments cause "column does not exist" errors when
    // the schema has evolved but the old file is reused instead of recreated.
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile)
      console.log(`[dataStore] Deleted stale database file at ${dbFile}`)
    } else {
      console.log(`[dataStore] No existing database file found at ${dbFile} — starting fresh`)
    }

    console.log(`[dataStore] Creating new SQLite connection at ${dbFile}`)
    _db   = new Database(dbFile)
    _isPg = false
    console.log(`[dataStore] SQLite connection created successfully`)

    _db.pragma('journal_mode = WAL')

    const schemaPath = path.join(__dirname, '../db/schema.sql')
    console.log(`[dataStore] Reading schema file from ${schemaPath}`)
    const schema = fs.readFileSync(schemaPath, 'utf8')
    console.log(`[dataStore] Schema file read OK (${schema.length} chars) — first 500 chars:\n${schema.slice(0, 500)}`)

    console.log(`[dataStore] Executing schema SQL...`)
    _db.exec(schema)
    console.log(`[dataStore] Schema executed successfully`)

    // Migration: add new columns to existing tables that predate the current schema.
    // SQLite's ALTER TABLE does not support IF NOT EXISTS before 3.35.0, so each
    // statement is wrapped in a try-catch — a "duplicate column" error is silently
    // ignored while any other error is re-thrown.
    const migrations = [
      // signals table
      `ALTER TABLE signals ADD COLUMN direction  VARCHAR(10)`,
      `ALTER TABLE signals ADD COLUMN vol_source VARCHAR(10)`,
      `ALTER TABLE signals ADD COLUMN vol_ann    DECIMAL(10,6)`,
      `ALTER TABLE signals ADD COLUMN k          DECIMAL(5,3)`,
      // outcomes table
      `ALTER TABLE outcomes ADD COLUMN threshold_1h  DECIMAL(10,6)`,
      `ALTER TABLE outcomes ADD COLUMN label_1h      VARCHAR(10)`,
      `ALTER TABLE outcomes ADD COLUMN threshold_4h  DECIMAL(10,6)`,
      `ALTER TABLE outcomes ADD COLUMN label_4h      VARCHAR(10)`,
      `ALTER TABLE outcomes ADD COLUMN threshold_24h DECIMAL(10,6)`,
      `ALTER TABLE outcomes ADD COLUMN label_24h     VARCHAR(10)`,
      `ALTER TABLE outcomes ADD COLUMN updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    ]

    console.log(`[dataStore] Running ${migrations.length} migration statement(s)...`)
    for (const sql of migrations) {
      console.log(`[dataStore] Migration: ${sql.trim()}`)
      try {
        _db.exec(sql)
        console.log(`[dataStore] Migration OK: ${sql.trim()}`)
      } catch (err) {
        // SQLite error code 1 with "duplicate column name" means the column
        // already exists — safe to ignore.  Any other error is a real problem.
        if (!err.message.includes('duplicate column name')) {
          console.error(`[dataStore] Migration FAILED: ${sql.trim()} — ${err.message}`)
          throw err
        }
        console.log(`[dataStore] Migration skipped (column already exists): ${sql.trim()}`)
      }
    }

    console.log(`[dataStore] SQLite initialized at ${dbFile}`)
  } catch (err) {
    console.error(`[dataStore] _initSqlite() FAILED — ${err.message}`)
    console.error(err.stack)
    throw err
  }
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
  _isPg = true

  // Execute each DDL statement individually to guarantee all tables and columns
  // are created/migrated on every startup.  Passing a multi-statement string to
  // pool.query() is unreliable with node-postgres: the driver may silently stop
  // after the first result set, leaving new tables or migration columns missing.
  const pgStatements = [
    // ── tickers ────────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS tickers (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tickers_asset_ts ON tickers (asset, timestamp)`,

    // ── signals ────────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS signals (
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
      direction         VARCHAR(10),
      vol_source        VARCHAR(10),
      vol_ann           DECIMAL(10,6),
      k                 DECIMAL(5,3),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_signals_asset_ts ON signals (asset, timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_asset_direction ON signals (asset, direction)`,

    // ── outcomes ───────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS outcomes (
      id               SERIAL PRIMARY KEY,
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_outcomes_signal_id ON outcomes (signal_id)`,

    // ── Migrations: add new columns to existing tables (safe to re-run) ────────
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS direction  VARCHAR(10)`,
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS vol_source VARCHAR(10)`,
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS vol_ann    DECIMAL(10,6)`,
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS k          DECIMAL(5,3)`,

    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS threshold_1h  DECIMAL(10,6)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS label_1h      VARCHAR(10)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS threshold_4h  DECIMAL(10,6)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS label_4h      VARCHAR(10)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS threshold_24h DECIMAL(10,6)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS label_24h     VARCHAR(10)`,
    `ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  ]

  // Use a dedicated client for the entire schema bootstrap so all statements
  // share one connection and are reliably executed in order.
  const client = await _pgPool.connect()
  try {
    console.log(`[dataStore] Running ${pgStatements.length} PostgreSQL schema statement(s)...`)
    for (const sql of pgStatements) {
      const label = sql.trim().split('\n')[0].slice(0, 80) // first line, max 80 chars
      console.log(`[dataStore] PG schema: ${label}`)
      await client.query(sql)
    }
  } finally {
    client.release()
  }

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
