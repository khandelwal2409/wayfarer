import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool, types } = pg;
const databaseUrl = process.env.DATABASE_URL;
const usePostgres = Boolean(databaseUrl);

if (process.env.NODE_ENV === 'production' && !databaseUrl) {
  throw new Error('DATABASE_URL must be configured in production.');
}

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1082, (value) => value);

const sqlite = usePostgres ? null : (() => {
  const databasePath = resolve(process.env.DB_PATH || 'data/travel-expense.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  const connection = new DatabaseSync(databasePath);
  connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return connection;
})();

const postgres = usePostgres ? new Pool({ connectionString: databaseUrl, max: 5 }) : null;
export const databaseKind = usePostgres ? 'postgres' : 'sqlite';

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    travel_type TEXT NOT NULL CHECK (travel_type = 'domestic'),
    name TEXT NOT NULL,
    destination_city TEXT NOT NULL,
    destination_state TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    transport_mode TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
  );
  CREATE INDEX IF NOT EXISTS trips_user_dates_idx ON trips(user_id, start_date, end_date);
  CREATE TABLE IF NOT EXISTS stays (
    id INTEGER PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    hotel_name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    booking_reference TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    hotel_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (hotel_amount_paise >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (check_out >= check_in)
  );
  CREATE INDEX IF NOT EXISTS stays_trip_dates_idx ON stays(trip_id, check_in);
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('food', 'fuel', 'transport', 'other')),
    description TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    payment_method TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS expenses_trip_date_idx ON expenses(trip_id, expense_date);
  CREATE TABLE IF NOT EXISTS transport_records (
    id INTEGER PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    transport_date TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('car', 'train', 'bus', 'flight', 'taxi', 'two-wheeler', 'other')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS transport_trip_date_idx ON transport_records(trip_id, transport_date);
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    travel_type TEXT NOT NULL CHECK (travel_type = 'domestic'),
    name TEXT NOT NULL,
    destination_city TEXT NOT NULL,
    destination_state TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    transport_mode TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
  );
  CREATE INDEX IF NOT EXISTS trips_user_dates_idx ON trips(user_id, start_date, end_date);
  CREATE TABLE IF NOT EXISTS stays (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    hotel_name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    booking_reference TEXT NOT NULL DEFAULT '',
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    hotel_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (hotel_amount_paise >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (check_out >= check_in)
  );
  CREATE INDEX IF NOT EXISTS stays_trip_dates_idx ON stays(trip_id, check_in);
  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    expense_date DATE NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('food', 'fuel', 'transport', 'other')),
    description TEXT NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    payment_method TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS expenses_trip_date_idx ON expenses(trip_id, expense_date);
  CREATE TABLE IF NOT EXISTS transport_records (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    transport_date DATE NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('car', 'train', 'bus', 'flight', 'taxi', 'two-wheeler', 'other')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS transport_trip_date_idx ON transport_records(trip_id, transport_date);
`;

export async function initializeDatabase() {
  if (usePostgres) {
    for (const statement of postgresSchema.split(';').map((item) => item.trim()).filter(Boolean)) {
      await postgres.query(statement);
    }
    return;
  }
  sqlite.exec(sqliteSchema);
  const columns = sqlite.prepare('PRAGMA table_info(stays)').all();
  if (!columns.some((column) => column.name === 'hotel_amount_paise')) {
    sqlite.exec('ALTER TABLE stays ADD COLUMN hotel_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (hotel_amount_paise >= 0)');
  }
}

function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export const database = {
  prepare(sql) {
    return {
      async get(...values) {
        if (!usePostgres) return sqlite.prepare(sql).get(...values);
        const result = await postgres.query(postgresSql(sql), values);
        return result.rows[0];
      },
      async all(...values) {
        if (!usePostgres) return sqlite.prepare(sql).all(...values);
        const result = await postgres.query(postgresSql(sql), values);
        return result.rows;
      },
      async run(...values) {
        if (!usePostgres) {
          if (/\bRETURNING\b/i.test(sql)) {
            const row = sqlite.prepare(sql).get(...values);
            return { lastInsertRowid: row?.id, changes: row ? 1 : 0 };
          }
          return sqlite.prepare(sql).run(...values);
        }
        const result = await postgres.query(postgresSql(sql), values);
        return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
      },
    };
  },
};
