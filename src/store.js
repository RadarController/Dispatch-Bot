const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { config } = require('./config');

const STORE_VERSION = 2;
const LEGACY_STORE_STATE_KEY = 'dispatch-bot';

let databasePool = null;
let storeInitialisationPromise = null;

function getDefaultGuildState() {
  return {
    liveConfig: {
      streamerRoleId: '',
      livePingRoleId: '',
      liveAnnouncementsChannelId: ''
    },
    rolePanelConfig: {
      channelId: '',
      roleIds: []
    },
    callsignConfig: {
      iataMappings: {}
    },
    streamers: {},
    liveSessions: {}
  };
}

function getDefaultState() {
  return {
    version: STORE_VERSION,
    guilds: {}
  };
}

function resolveDataFilePath() {
  return config.dataFilePath || path.join(process.cwd(), 'data', 'dispatch-bot.json');
}

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

function normaliseRoleIds(roleIds) {
  return Array.from(
    new Set(
      Array.isArray(roleIds)
        ? roleIds.map((value) => `${value}`.trim()).filter(Boolean)
        : []
    )
  );
}

function normaliseIataMappings(mappings) {
  if (!mappings || typeof mappings !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(mappings)
      .map(([iataDesignator, icaoRoot]) => [
        `${iataDesignator}`.trim().toUpperCase(),
        `${icaoRoot}`.trim().toUpperCase()
      ])
      .filter(([iataDesignator, icaoRoot]) => /^[A-Z0-9]{2}$/.test(iataDesignator) && /^[A-Z]{3}$/.test(icaoRoot))
  );
}

function normaliseSnowflake(value) {
  const normalised = `${value || ''}`.trim();
  return /^\d{17,20}$/.test(normalised) ? normalised : '';
}

function normaliseStreamerRecord(record, discordUserId) {
  return {
    discordUserId,
    displayName: typeof record?.displayName === 'string' ? record.displayName : '',
    channels: {
      twitch: null,
      tiktok: null,
      youtube: null,
      ...(record?.channels || {})
    },
    addedAt: record?.addedAt || null,
    updatedAt: record?.updatedAt || null
  };
}

function normaliseStreamers(streamers) {
  if (!streamers || typeof streamers !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(streamers)
      .map(([streamerKey, record]) => {
        const discordUserId = normaliseSnowflake(record?.discordUserId || streamerKey);
        if (!discordUserId) {
          return null;
        }

        return [discordUserId, normaliseStreamerRecord(record, discordUserId)];
      })
      .filter(Boolean)
  );
}

function normaliseGuildState(raw) {
  const defaults = getDefaultGuildState();

  return {
    liveConfig: {
      ...defaults.liveConfig,
      ...(raw?.liveConfig || {})
    },
    rolePanelConfig: {
      ...defaults.rolePanelConfig,
      ...(raw?.rolePanelConfig || {}),
      roleIds: normaliseRoleIds(raw?.rolePanelConfig?.roleIds || defaults.rolePanelConfig.roleIds)
    },
    callsignConfig: {
      ...defaults.callsignConfig,
      ...(raw?.callsignConfig || {}),
      iataMappings: normaliseIataMappings(raw?.callsignConfig?.iataMappings || defaults.callsignConfig.iataMappings)
    },
    streamers: normaliseStreamers(raw?.streamers),
    liveSessions: raw?.liveSessions && typeof raw.liveSessions === 'object' ? raw.liveSessions : {}
  };
}

function migrateLegacyState(raw) {
  if (!raw || typeof raw !== 'object') {
    return getDefaultState();
  }

  if (raw.guilds && typeof raw.guilds === 'object') {
    return {
      version: STORE_VERSION,
      guilds: Object.fromEntries(
        Object.entries(raw.guilds).map(([guildId, guildState]) => [guildId, normaliseGuildState(guildState)])
      )
    };
  }

  const hasLegacyFields =
    raw.liveConfig ||
    raw.streamers ||
    raw.liveSessions;

  if (!hasLegacyFields) {
    return getDefaultState();
  }

  const migratedGuildId = config.discordGuildId || 'legacy-global';

  return {
    version: STORE_VERSION,
    guilds: {
      [migratedGuildId]: normaliseGuildState({
        liveConfig: raw.liveConfig,
        streamers: raw.streamers,
        liveSessions: raw.liveSessions
      })
    }
  };
}

function normaliseState(raw) {
  const migrated = migrateLegacyState(raw);

  return {
    version: STORE_VERSION,
    guilds: Object.fromEntries(
      Object.entries(migrated.guilds || {}).map(([guildId, guildState]) => [guildId, normaliseGuildState(guildState)])
    )
  };
}

function ensureFileStoreExists() {
  const filePath = resolveDataFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(getDefaultState(), null, 2));
  }

  return filePath;
}

async function initialiseDatabaseStore() {
  const pool = getDatabasePool();
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      guild_id TEXT PRIMARY KEY,
      state_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columnResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_state'
  `);

  const columns = new Set(columnResult.rows.map((row) => row.column_name));
  const hasLegacyShape = columns.has('state_key');

  if (!hasLegacyShape) {
    return;
  }

  const legacyResult = await pool.query(
    'SELECT state_json, updated_at FROM app_state WHERE state_key = $1',
    [LEGACY_STORE_STATE_KEY]
  );

  if (legacyResult.rows.length === 0) {
    await pool.query('DROP TABLE app_state');
    await pool.query(`
      CREATE TABLE app_state (
        guild_id TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return;
  }

  const migratedState = normaliseState(legacyResult.rows[0].state_json);

  await pool.query('BEGIN');

  try {
    await pool.query('DROP TABLE IF EXISTS app_state_v2');
    await pool.query(`
      CREATE TABLE app_state_v2 (
        guild_id TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const [guildId, guildState] of Object.entries(migratedState.guilds)) {
      await pool.query(
        `INSERT INTO app_state_v2 (guild_id, state_json, updated_at)
         VALUES ($1, $2::jsonb, $3)`,
        [guildId, JSON.stringify(normaliseGuildState(guildState)), legacyResult.rows[0].updated_at]
      );
    }

    await pool.query('DROP TABLE app_state');
    await pool.query('ALTER TABLE app_state_v2 RENAME TO app_state');
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function ensureStoreInitialised() {
  if (!storeInitialisationPromise) {
    storeInitialisationPromise = shouldUseDatabase()
      ? initialiseDatabaseStore()
      : Promise.resolve(ensureFileStoreExists());
  }

  await storeInitialisationPromise;
}

async function readStore() {
  await ensureStoreInitialised();

  if (shouldUseDatabase()) {
    try {
      const pool = getDatabasePool();
      const result = await pool.query(
        'SELECT guild_id, state_json FROM app_state'
      );

      return {
        version: STORE_VERSION,
        guilds: Object.fromEntries(
          result.rows.map((row) => [row.guild_id, normaliseGuildState(row.state_json)])
        )
      };
    } catch (error) {
      console.error('Failed to read database store, falling back to defaults:', error);
      return getDefaultState();
    }
  }

  const filePath = ensureFileStoreExists();

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return normaliseState(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read file store, falling back to defaults:', error);
    return getDefaultState();
  }
}

async function listGuildIds() {
  await ensureStoreInitialised();

  if (shouldUseDatabase()) {
    try {
      const pool = getDatabasePool();
      const result = await pool.query('SELECT guild_id FROM app_state ORDER BY guild_id');
      return result.rows.map((row) => row.guild_id);
    } catch (error) {
      console.error('Failed to list guild IDs from database store:', error);
      return [];
    }
  }

  const state = await readStore();
  return Object.keys(state.guilds || {}).sort();
}

async function readGuildState(guildId) {
  const normalisedGuildId = `${guildId}`.trim();
  if (!normalisedGuildId) {
    return getDefaultGuildState();
  }

  await ensureStoreInitialised();

  if (shouldUseDatabase()) {
    try {
      const pool = getDatabasePool();
      const result = await pool.query(
        'SELECT state_json FROM app_state WHERE guild_id = $1',
        [normalisedGuildId]
      );

      if (result.rows.length === 0) {
        return getDefaultGuildState();
      }

      return normaliseGuildState(result.rows[0].state_json);
    } catch (error) {
      console.error(`Failed to read guild state for ${normalisedGuildId}, falling back to defaults:`, error);
      return getDefaultGuildState();
    }
  }

  const state = await readStore();
  return state.guilds?.[normalisedGuildId] || getDefaultGuildState();
}

async function writeStore(state) {
  await ensureStoreInitialised();
  const nextState = normaliseState(state);

  if (shouldUseDatabase()) {
    const pool = getDatabasePool();

    await pool.query('BEGIN');

    try {
      const existingRows = await pool.query('SELECT guild_id FROM app_state');
      const nextGuildIds = new Set(Object.keys(nextState.guilds));
      const existingGuildIds = existingRows.rows.map((row) => row.guild_id);

      for (const guildId of existingGuildIds) {
        if (!nextGuildIds.has(guildId)) {
          await pool.query('DELETE FROM app_state WHERE guild_id = $1', [guildId]);
        }
      }

      for (const [guildId, guildState] of Object.entries(nextState.guilds)) {
        await pool.query(
          `INSERT INTO app_state (guild_id, state_json, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (guild_id)
           DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
          [guildId, JSON.stringify(normaliseGuildState(guildState))]
        );
      }

      await pool.query('COMMIT');
      return nextState;
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  const filePath = ensureFileStoreExists();
  const tempFilePath = `${filePath}.tmp`;

  fs.writeFileSync(tempFilePath, JSON.stringify(nextState, null, 2));
  fs.renameSync(tempFilePath, filePath);

  return nextState;
}

async function writeGuildState(guildId, guildState) {
  const normalisedGuildId = `${guildId}`.trim();
  if (!normalisedGuildId) {
    throw new Error('A guild ID is required.');
  }

  await ensureStoreInitialised();
  const nextGuildState = normaliseGuildState(guildState);

  if (shouldUseDatabase()) {
    const pool = getDatabasePool();
    await pool.query(
      `INSERT INTO app_state (guild_id, state_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (guild_id)
       DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
      [normalisedGuildId, JSON.stringify(nextGuildState)]
    );

    return nextGuildState;
  }

  const state = await readStore();
  state.guilds[normalisedGuildId] = nextGuildState;
  await writeStore(state);
  return nextGuildState;
}

async function updateStore(updater) {
  const state = await readStore();
  const result = await updater(state);
  await writeStore(state);
  return result;
}

async function updateGuildState(guildId, updater) {
  const normalisedGuildId = `${guildId}`.trim();
  if (!normalisedGuildId) {
    throw new Error('A guild ID is required.');
  }

  await ensureStoreInitialised();

  if (shouldUseDatabase()) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO app_state (guild_id, state_json, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (guild_id) DO NOTHING`,
        [normalisedGuildId, JSON.stringify(getDefaultGuildState())]
      );

      const result = await client.query(
        'SELECT state_json FROM app_state WHERE guild_id = $1 FOR UPDATE',
        [normalisedGuildId]
      );

      const guildState = normaliseGuildState(result.rows[0]?.state_json || getDefaultGuildState());
      const updaterResult = await updater(guildState);
      const nextGuildState = normaliseGuildState(guildState);

      await client.query(
        `UPDATE app_state
         SET state_json = $2::jsonb,
             updated_at = NOW()
         WHERE guild_id = $1`,
        [normalisedGuildId, JSON.stringify(nextGuildState)]
      );

      await client.query('COMMIT');
      return updaterResult;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const guildState = await readGuildState(normalisedGuildId);
  const result = await updater(guildState);
  await writeGuildState(normalisedGuildId, guildState);
  return result;
}

module.exports = {
  getDefaultGuildState,
  getDefaultState,
  listGuildIds,
  readGuildState,
  readStore,
  resolveDataFilePath,
  updateGuildState,
  updateStore,
  writeGuildState,
  writeStore
};