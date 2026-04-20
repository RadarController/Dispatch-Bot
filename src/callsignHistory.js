const { Pool } = require('pg');
const { config } = require('./config');

let databasePool = null;
let tableInitialisationPromise = null;

function shouldUseDatabase() {
  return Boolean(config.databaseUrl);
}

function getDatabasePool() {
  if (!shouldUseDatabase()) {
    return null;
  }

  if (!databasePool) {
    const useSsl = !/localhost|127\.0\.0\.1/i.test(config.databaseUrl);
    databasePool = new Pool({
      connectionString: config.databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    });
  }

  return databasePool;
}

async function ensureCallsignHistoryTable() {
  if (!shouldUseDatabase()) {
    return false;
  }

  if (!tableInitialisationPromise) {
    tableInitialisationPromise = (async () => {
      const pool = getDatabasePool();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS callsign_generations (
          id BIGSERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL,
          input_flight_number TEXT NOT NULL,
          iata_designator TEXT NOT NULL,
          icao_root TEXT NOT NULL,
          generated_callsign TEXT NOT NULL,
          generated_suffix TEXT NOT NULL,
          departure TEXT NOT NULL DEFAULT '',
          destination TEXT NOT NULL DEFAULT '',
          was_preserved BOOLEAN NOT NULL DEFAULT FALSE,
          used_destination_letters BOOLEAN NOT NULL DEFAULT FALSE,
          pattern_description TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_callsign_generations_guild_created_at
        ON callsign_generations (guild_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_callsign_generations_callsign
        ON callsign_generations (generated_callsign)
      `);

      return true;
    })().catch((error) => {
      tableInitialisationPromise = null;
      throw error;
    });
  }

  await tableInitialisationPromise;
  return true;
}

async function recordCreatedCallsign(entry) {
  if (!shouldUseDatabase()) {
    return false;
  }

  await ensureCallsignHistoryTable();

  const pool = getDatabasePool();

  await pool.query(
    `INSERT INTO callsign_generations (
      guild_id,
      created_by_user_id,
      input_flight_number,
      iata_designator,
      icao_root,
      generated_callsign,
      generated_suffix,
      departure,
      destination,
      was_preserved,
      used_destination_letters,
      pattern_description
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    )`,
    [
      `${entry.guildId || ''}`.trim(),
      `${entry.createdByUserId || ''}`.trim(),
      `${entry.inputFlightNumber || ''}`.trim().toUpperCase(),
      `${entry.iataDesignator || ''}`.trim().toUpperCase(),
      `${entry.icaoRoot || ''}`.trim().toUpperCase(),
      `${entry.generatedCallsign || ''}`.trim().toUpperCase(),
      `${entry.generatedSuffix || ''}`.trim().toUpperCase(),
      `${entry.departure || ''}`.trim().toUpperCase(),
      `${entry.destination || ''}`.trim().toUpperCase(),
      entry.wasPreserved === true,
      entry.usedDestinationLetters === true,
      `${entry.patternDescription || ''}`.trim()
    ]
  );

  return true;
}

module.exports = {
  recordCreatedCallsign
};