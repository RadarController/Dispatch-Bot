const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { config } = require('./config');

const STORE_VERSION = 2;
const STORE_STATE_KEY = 'dispatch-bot';

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
    streamers: raw?.streamers && typeof raw.streamers === 'object' ? raw.streamers : {},
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
      state_key TEXT PRIMARY KEY,
      state_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(
    `INSERT INTO app_state (state_key, state_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (state_key) DO NOTHING`,
    [STORE_STATE_KEY, JSON.stringify(getDefaultState())]
  );
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
        'SELECT state_json FROM app_state WHERE state_key = $1',
        [STORE_STATE_KEY]
      );

      if (result.rows.length === 0) {
        const defaults = getDefaultState();
        await writeStore(defaults);
        return defaults;
      }

      return normaliseState(result.rows[0].state_json);
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

async function writeStore(state) {
  await ensureStoreInitialised();
  const nextState = normaliseState(state);

  if (shouldUseDatabase()) {
    const pool = getDatabasePool();
    await pool.query(
      `INSERT INTO app_state (state_key, state_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (state_key)
       DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
      [STORE_STATE_KEY, JSON.stringify(nextState)]
    );

    return nextState;
  }

  const filePath = ensureFileStoreExists();
  const tempFilePath = `${filePath}.tmp`;

  fs.writeFileSync(tempFilePath, JSON.stringify(nextState, null, 2));
  fs.renameSync(tempFilePath, filePath);

  return nextState;
}

async function updateStore(updater) {
  const state = await readStore();
  const result = await updater(state);
  await writeStore(state);
  return result;
}

module.exports = {
  getDefaultGuildState,
  getDefaultState,
  readStore,
  resolveDataFilePath,
  updateStore,
  writeStore
};
