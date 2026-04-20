const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { config } = require('./config');

const STORE_VERSION = 2;
const LEGACY_STORE_STATE_KEY = 'dispatch-bot';
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

let databasePool = null;
let storeInitialisationPromise = null;

function getDefaultWelcomeConfig() {
  return {
    enabled: false,
    channelId: '',
    rulesChannelId: '',
    useMentions: true,
    messages: []
  };
}

function getDefaultScheduleConfig() {
  return {
    channelId: '',
    mode: 'forum_post',
    creatorRoleId: '',
    titleFormat: 'Schedule | {displayName}'
  };
}

function getDefaultScheduleEntries() {
  return {
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: ''
  };
}

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
    welcomeConfig: getDefaultWelcomeConfig(),
    scheduleConfig: getDefaultScheduleConfig(),
    schedules: {},
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

function normaliseWelcomeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((value) => `${value}`.trim())
    .filter(Boolean);
}

function normaliseWelcomeConfig(raw) {
  const defaults = getDefaultWelcomeConfig();

  return {
    enabled: raw?.enabled === true,
    channelId: normaliseSnowflake(raw?.channelId),
    rulesChannelId: normaliseSnowflake(raw?.rulesChannelId),
    useMentions: raw?.useMentions === undefined ? defaults.useMentions : Boolean(raw.useMentions),
    messages: normaliseWelcomeMessages(raw?.messages || defaults.messages)
  };
}

function normaliseScheduleEntries(entries) {
  const defaults = getDefaultScheduleEntries();

  return {
    monday: typeof entries?.monday === 'string' ? entries.monday.trim() : defaults.monday,
    tuesday: typeof entries?.tuesday === 'string' ? entries.tuesday.trim() : defaults.tuesday,
    wednesday: typeof entries?.wednesday === 'string' ? entries.wednesday.trim() : defaults.wednesday,
    thursday: typeof entries?.thursday === 'string' ? entries.thursday.trim() : defaults.thursday,
    friday: typeof entries?.friday === 'string' ? entries.friday.trim() : defaults.friday,
    saturday: typeof entries?.saturday === 'string' ? entries.saturday.trim() : defaults.saturday,
    sunday: typeof entries?.sunday === 'string' ? entries.sunday.trim() : defaults.sunday
  };
}

function normaliseScheduleConfig(raw) {
  const defaults = getDefaultScheduleConfig();
  const mode = raw?.mode === 'thread' ? 'thread' : defaults.mode;
  const titleFormat = typeof raw?.titleFormat === 'string' && raw.titleFormat.trim()
    ? raw.titleFormat.trim().slice(0, 100)
    : defaults.titleFormat;

  return {
    channelId: normaliseSnowflake(raw?.channelId),
    mode,
    creatorRoleId: normaliseSnowflake(raw?.creatorRoleId),
    titleFormat
  };
}

function normaliseScheduleRecord(record, ownerUserId) {
  const normalisedOwnerUserId = normaliseSnowflake(record?.ownerUserId || ownerUserId);
  if (!normalisedOwnerUserId) {
    return null;
  }

  return {
    ownerUserId: normalisedOwnerUserId,
    displayName: typeof record?.displayName === 'string' ? record.displayName.trim() : '',
    threadId: normaliseSnowflake(record?.threadId),
    rootMessageId: normaliseSnowflake(record?.rootMessageId),
    entries: normaliseScheduleEntries(record?.entries),
    updatedAt: typeof record?.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : null
  };
}

function normaliseSchedules(schedules) {
  if (!schedules || typeof schedules !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schedules)
      .map(([ownerUserId, record]) => {
        const normalised = normaliseScheduleRecord(record, ownerUserId);
        return normalised ? [normalised.ownerUserId, normalised] : null;
      })
      .filter(Boolean)
  );
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
    welcomeConfig: normaliseWelcomeConfig(raw?.welcomeConfig),
    scheduleConfig: normaliseScheduleConfig(raw?.scheduleConfig),
    schedules: normaliseSchedules(raw?.schedules),
    streamers: normaliseStreamers(raw?.streamers),
    liveSessions: raw?.liveSessions && typeof raw?.liveSessions === 'object' ? raw.liveSessions : {}
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

async function tableExists(db, tableName) {
  const result = await db.query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists`,
    [tableName]
  );

  return result.rows[0]?.exists === true;
}

async function createNormalisedTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_live_config (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
      streamer_role_id TEXT NOT NULL DEFAULT '',
      live_ping_role_id TEXT NOT NULL DEFAULT '',
      live_announcements_channel_id TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_role_panel_config (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_role_panel_roles (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_callsign_mappings (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      iata_designator TEXT NOT NULL,
      icao_root TEXT NOT NULL,
      PRIMARY KEY (guild_id, iata_designator)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_welcome_config (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      channel_id TEXT NOT NULL DEFAULT '',
      rules_channel_id TEXT NOT NULL DEFAULT '',
      use_mentions BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_welcome_messages (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      message TEXT NOT NULL,
      PRIMARY KEY (guild_id, sort_order)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_schedule_config (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'forum_post',
      creator_role_id TEXT NOT NULL DEFAULT '',
      title_format TEXT NOT NULL DEFAULT 'Schedule | {displayName}'
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_schedules (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      owner_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      root_message_id TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NULL,
      PRIMARY KEY (guild_id, owner_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_schedule_entries (
      guild_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      entry_text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, owner_user_id, day_of_week),
      FOREIGN KEY (guild_id, owner_user_id)
        REFERENCES guild_schedules(guild_id, owner_user_id)
        ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_streamers (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      added_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NULL,
      PRIMARY KEY (guild_id, discord_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_streamer_channels (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      identifier TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, discord_user_id, platform),
      FOREIGN KEY (guild_id, discord_user_id)
        REFERENCES guild_streamers(guild_id, discord_user_id)
        ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_live_sessions (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NULL,
      announcement_channel_id TEXT NOT NULL DEFAULT '',
      announcement_message_id TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NULL,
      last_announcement_hash TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, discord_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_live_session_platforms (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      state_json JSONB NOT NULL,
      PRIMARY KEY (guild_id, discord_user_id, platform),
      FOREIGN KEY (guild_id, discord_user_id)
        REFERENCES guild_live_sessions(guild_id, discord_user_id)
        ON DELETE CASCADE
    )
  `);
}

async function countNormalisedGuilds(db) {
  const result = await db.query('SELECT COUNT(*)::int AS guild_count FROM guilds');
  return Number(result.rows[0]?.guild_count || 0);
}

async function readLegacyAppState(db) {
  const exists = await tableExists(db, 'app_state');
  if (!exists) {
    return getDefaultState();
  }

  const columnResult = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_state'
  `);

  const columns = new Set(columnResult.rows.map((row) => row.column_name));

  if (columns.has('state_key') && columns.has('state_json')) {
    const result = await db.query(
      'SELECT state_json FROM app_state WHERE state_key = $1',
      [LEGACY_STORE_STATE_KEY]
    );

    if (result.rows.length === 0) {
      return getDefaultState();
    }

    return normaliseState(result.rows[0].state_json);
  }

  if (columns.has('guild_id') && columns.has('state_json')) {
    const result = await db.query('SELECT guild_id, state_json FROM app_state');

    return {
      version: STORE_VERSION,
      guilds: Object.fromEntries(
        result.rows.map((row) => [row.guild_id, normaliseGuildState(row.state_json)])
      )
    };
  }

  return getDefaultState();
}

async function writeGuildStateToDatabase(db, guildId, guildState) {
  const nextGuildState = normaliseGuildState(guildState);

  await db.query(
    `INSERT INTO guilds (guild_id, updated_at)
     VALUES ($1, NOW())
     ON CONFLICT (guild_id)
     DO UPDATE SET updated_at = NOW()`,
    [guildId]
  );

  await db.query(
    `INSERT INTO guild_live_config (
       guild_id,
       streamer_role_id,
       live_ping_role_id,
       live_announcements_channel_id
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id)
     DO UPDATE SET
       streamer_role_id = EXCLUDED.streamer_role_id,
       live_ping_role_id = EXCLUDED.live_ping_role_id,
       live_announcements_channel_id = EXCLUDED.live_announcements_channel_id`,
    [
      guildId,
      nextGuildState.liveConfig.streamerRoleId || '',
      nextGuildState.liveConfig.livePingRoleId || '',
      nextGuildState.liveConfig.liveAnnouncementsChannelId || ''
    ]
  );

  await db.query(
    `INSERT INTO guild_role_panel_config (guild_id, channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id)
     DO UPDATE SET channel_id = EXCLUDED.channel_id`,
    [guildId, nextGuildState.rolePanelConfig.channelId || '']
  );

  await db.query('DELETE FROM guild_role_panel_roles WHERE guild_id = $1', [guildId]);
  for (const roleId of nextGuildState.rolePanelConfig.roleIds || []) {
    await db.query(
      `INSERT INTO guild_role_panel_roles (guild_id, role_id)
       VALUES ($1, $2)`,
      [guildId, roleId]
    );
  }

  await db.query('DELETE FROM guild_callsign_mappings WHERE guild_id = $1', [guildId]);
  for (const [iataDesignator, icaoRoot] of Object.entries(nextGuildState.callsignConfig.iataMappings || {})) {
    await db.query(
      `INSERT INTO guild_callsign_mappings (guild_id, iata_designator, icao_root)
       VALUES ($1, $2, $3)`,
      [guildId, iataDesignator, icaoRoot]
    );
  }

  await db.query(
    `INSERT INTO guild_welcome_config (
       guild_id,
       enabled,
       channel_id,
       rules_channel_id,
       use_mentions
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       channel_id = EXCLUDED.channel_id,
       rules_channel_id = EXCLUDED.rules_channel_id,
       use_mentions = EXCLUDED.use_mentions`,
    [
      guildId,
      nextGuildState.welcomeConfig.enabled === true,
      nextGuildState.welcomeConfig.channelId || '',
      nextGuildState.welcomeConfig.rulesChannelId || '',
      nextGuildState.welcomeConfig.useMentions !== false
    ]
  );

  await db.query('DELETE FROM guild_welcome_messages WHERE guild_id = $1', [guildId]);
  for (const [index, message] of (nextGuildState.welcomeConfig.messages || []).entries()) {
    await db.query(
      `INSERT INTO guild_welcome_messages (guild_id, sort_order, message)
       VALUES ($1, $2, $3)`,
      [guildId, index, message]
    );
  }

  await db.query(
    `INSERT INTO guild_schedule_config (
       guild_id,
       channel_id,
       mode,
       creator_role_id,
       title_format
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id)
     DO UPDATE SET
       channel_id = EXCLUDED.channel_id,
       mode = EXCLUDED.mode,
       creator_role_id = EXCLUDED.creator_role_id,
       title_format = EXCLUDED.title_format`,
    [
      guildId,
      nextGuildState.scheduleConfig.channelId || '',
      nextGuildState.scheduleConfig.mode || 'forum_post',
      nextGuildState.scheduleConfig.creatorRoleId || '',
      nextGuildState.scheduleConfig.titleFormat || 'Schedule | {displayName}'
    ]
  );

  await db.query('DELETE FROM guild_schedule_entries WHERE guild_id = $1', [guildId]);
  await db.query('DELETE FROM guild_schedules WHERE guild_id = $1', [guildId]);

  for (const [ownerUserId, record] of Object.entries(nextGuildState.schedules || {})) {
    const schedule = normaliseScheduleRecord(record, ownerUserId);
    if (!schedule) {
      continue;
    }

    await db.query(
      `INSERT INTO guild_schedules (
         guild_id,
         owner_user_id,
         display_name,
         thread_id,
         root_message_id,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        guildId,
        schedule.ownerUserId,
        schedule.displayName || '',
        schedule.threadId || '',
        schedule.rootMessageId || '',
        schedule.updatedAt
      ]
    );

    for (const dayOfWeek of DAY_ORDER) {
      const entryText = schedule.entries?.[dayOfWeek] || '';
      if (!entryText) {
        continue;
      }

      await db.query(
        `INSERT INTO guild_schedule_entries (
           guild_id,
           owner_user_id,
           day_of_week,
           entry_text
         )
         VALUES ($1, $2, $3, $4)`,
        [guildId, schedule.ownerUserId, dayOfWeek, entryText]
      );
    }
  }

  await db.query('DELETE FROM guild_streamer_channels WHERE guild_id = $1', [guildId]);
  await db.query('DELETE FROM guild_streamers WHERE guild_id = $1', [guildId]);

  for (const [discordUserId, record] of Object.entries(nextGuildState.streamers || {})) {
    const streamer = normaliseStreamerRecord(record, discordUserId);

    await db.query(
      `INSERT INTO guild_streamers (
         guild_id,
         discord_user_id,
         display_name,
         added_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        guildId,
        streamer.discordUserId,
        streamer.displayName || '',
        streamer.addedAt,
        streamer.updatedAt
      ]
    );

    for (const [platform, channel] of Object.entries(streamer.channels || {})) {
      if (!channel?.url) {
        continue;
      }

      await db.query(
        `INSERT INTO guild_streamer_channels (
           guild_id,
           discord_user_id,
           platform,
           url,
           identifier
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          guildId,
          streamer.discordUserId,
          platform,
          channel.url,
          channel.identifier || ''
        ]
      );
    }
  }

  await db.query('DELETE FROM guild_live_session_platforms WHERE guild_id = $1', [guildId]);
  await db.query('DELETE FROM guild_live_sessions WHERE guild_id = $1', [guildId]);

  for (const [discordUserId, session] of Object.entries(nextGuildState.liveSessions || {})) {
    await db.query(
      `INSERT INTO guild_live_sessions (
         guild_id,
         discord_user_id,
         started_at,
         announcement_channel_id,
         announcement_message_id,
         updated_at,
         last_announcement_hash
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        guildId,
        discordUserId,
        session?.startedAt || null,
        session?.announcementChannelId || '',
        session?.announcementMessageId || '',
        session?.updatedAt || null,
        session?.lastAnnouncementHash || ''
      ]
    );

    for (const [platform, platformState] of Object.entries(session?.platforms || {})) {
      await db.query(
        `INSERT INTO guild_live_session_platforms (
           guild_id,
           discord_user_id,
           platform,
           state_json
         )
         VALUES ($1, $2, $3, $4::jsonb)`,
        [guildId, discordUserId, platform, JSON.stringify(platformState || {})]
      );
    }
  }

  return nextGuildState;
}

async function readGuildStateFromDatabase(db, guildId) {
  const state = getDefaultGuildState();

  const liveConfigResult = await db.query(
    `SELECT streamer_role_id, live_ping_role_id, live_announcements_channel_id
     FROM guild_live_config
     WHERE guild_id = $1`,
    [guildId]
  );

  if (liveConfigResult.rows[0]) {
    state.liveConfig = {
      streamerRoleId: liveConfigResult.rows[0].streamer_role_id || '',
      livePingRoleId: liveConfigResult.rows[0].live_ping_role_id || '',
      liveAnnouncementsChannelId: liveConfigResult.rows[0].live_announcements_channel_id || ''
    };
  }

  const rolePanelConfigResult = await db.query(
    `SELECT channel_id
     FROM guild_role_panel_config
     WHERE guild_id = $1`,
    [guildId]
  );

  const rolePanelRolesResult = await db.query(
    `SELECT role_id
     FROM guild_role_panel_roles
     WHERE guild_id = $1
     ORDER BY role_id`,
    [guildId]
  );

  state.rolePanelConfig = {
    channelId: rolePanelConfigResult.rows[0]?.channel_id || '',
    roleIds: rolePanelRolesResult.rows.map((row) => row.role_id)
  };

  const callsignMappingsResult = await db.query(
    `SELECT iata_designator, icao_root
     FROM guild_callsign_mappings
     WHERE guild_id = $1`,
    [guildId]
  );

  state.callsignConfig = {
    iataMappings: Object.fromEntries(
      callsignMappingsResult.rows.map((row) => [row.iata_designator, row.icao_root])
    )
  };

  const welcomeConfigResult = await db.query(
    `SELECT enabled, channel_id, rules_channel_id, use_mentions
     FROM guild_welcome_config
     WHERE guild_id = $1`,
    [guildId]
  );

  const welcomeMessagesResult = await db.query(
    `SELECT message
     FROM guild_welcome_messages
     WHERE guild_id = $1
     ORDER BY sort_order ASC`,
    [guildId]
  );

  state.welcomeConfig = {
    ...getDefaultWelcomeConfig(),
    enabled: welcomeConfigResult.rows[0]?.enabled === true,
    channelId: welcomeConfigResult.rows[0]?.channel_id || '',
    rulesChannelId: welcomeConfigResult.rows[0]?.rules_channel_id || '',
    useMentions: welcomeConfigResult.rows[0]?.use_mentions === undefined
      ? true
      : welcomeConfigResult.rows[0].use_mentions === true,
    messages: welcomeMessagesResult.rows.map((row) => row.message)
  };

  const scheduleConfigResult = await db.query(
    `SELECT channel_id, mode, creator_role_id, title_format
     FROM guild_schedule_config
     WHERE guild_id = $1`,
    [guildId]
  );

  state.scheduleConfig = {
    ...getDefaultScheduleConfig(),
    channelId: scheduleConfigResult.rows[0]?.channel_id || '',
    mode: scheduleConfigResult.rows[0]?.mode || 'forum_post',
    creatorRoleId: scheduleConfigResult.rows[0]?.creator_role_id || '',
    titleFormat: scheduleConfigResult.rows[0]?.title_format || 'Schedule | {displayName}'
  };

  const schedulesResult = await db.query(
    `SELECT owner_user_id, display_name, thread_id, root_message_id, updated_at
     FROM guild_schedules
     WHERE guild_id = $1`,
    [guildId]
  );

  const scheduleEntriesResult = await db.query(
    `SELECT owner_user_id, day_of_week, entry_text
     FROM guild_schedule_entries
     WHERE guild_id = $1`,
    [guildId]
  );

  const schedules = {};
  for (const row of schedulesResult.rows) {
    schedules[row.owner_user_id] = {
      ownerUserId: row.owner_user_id,
      displayName: row.display_name || '',
      threadId: row.thread_id || '',
      rootMessageId: row.root_message_id || '',
      entries: getDefaultScheduleEntries(),
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null
    };
  }

  for (const row of scheduleEntriesResult.rows) {
    if (!schedules[row.owner_user_id]) {
      schedules[row.owner_user_id] = {
        ownerUserId: row.owner_user_id,
        displayName: '',
        threadId: '',
        rootMessageId: '',
        entries: getDefaultScheduleEntries(),
        updatedAt: null
      };
    }

    if (DAY_ORDER.includes(row.day_of_week)) {
      schedules[row.owner_user_id].entries[row.day_of_week] = row.entry_text || '';
    }
  }

  state.schedules = schedules;

  const streamersResult = await db.query(
    `SELECT discord_user_id, display_name, added_at, updated_at
     FROM guild_streamers
     WHERE guild_id = $1`,
    [guildId]
  );

  const streamerChannelsResult = await db.query(
    `SELECT discord_user_id, platform, url, identifier
     FROM guild_streamer_channels
     WHERE guild_id = $1`,
    [guildId]
  );

  const streamers = {};
  for (const row of streamersResult.rows) {
    streamers[row.discord_user_id] = {
      discordUserId: row.discord_user_id,
      displayName: row.display_name || '',
      channels: {
        twitch: null,
        tiktok: null,
        youtube: null
      },
      addedAt: row.added_at ? row.added_at.toISOString() : null,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null
    };
  }

  for (const row of streamerChannelsResult.rows) {
    if (!streamers[row.discord_user_id]) {
      streamers[row.discord_user_id] = {
        discordUserId: row.discord_user_id,
        displayName: '',
        channels: {
          twitch: null,
          tiktok: null,
          youtube: null
        },
        addedAt: null,
        updatedAt: null
      };
    }

    streamers[row.discord_user_id].channels[row.platform] = {
      platform: row.platform,
      url: row.url,
      identifier: row.identifier || ''
    };
  }

  state.streamers = streamers;

  const liveSessionsResult = await db.query(
    `SELECT
       discord_user_id,
       started_at,
       announcement_channel_id,
       announcement_message_id,
       updated_at,
       last_announcement_hash
     FROM guild_live_sessions
     WHERE guild_id = $1`,
    [guildId]
  );

  const liveSessionPlatformsResult = await db.query(
    `SELECT discord_user_id, platform, state_json
     FROM guild_live_session_platforms
     WHERE guild_id = $1`,
    [guildId]
  );

  const liveSessions = {};
  for (const row of liveSessionsResult.rows) {
    liveSessions[row.discord_user_id] = {
      startedAt: row.started_at ? row.started_at.toISOString() : null,
      announcementChannelId: row.announcement_channel_id || '',
      announcementMessageId: row.announcement_message_id || '',
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
      lastAnnouncementHash: row.last_announcement_hash || '',
      platforms: {}
    };
  }

  for (const row of liveSessionPlatformsResult.rows) {
    if (!liveSessions[row.discord_user_id]) {
      liveSessions[row.discord_user_id] = {
        startedAt: null,
        announcementChannelId: '',
        announcementMessageId: '',
        updatedAt: null,
        lastAnnouncementHash: '',
        platforms: {}
      };
    }

    liveSessions[row.discord_user_id].platforms[row.platform] = row.state_json || {};
  }

  state.liveSessions = liveSessions;

  return normaliseGuildState(state);
}

async function migrateLegacyDatabaseStore(db) {
  const normalisedGuildCount = await countNormalisedGuilds(db);
  if (normalisedGuildCount > 0) {
    return;
  }

  const legacyState = await readLegacyAppState(db);
  if (!legacyState.guilds || Object.keys(legacyState.guilds).length === 0) {
    return;
  }

  await db.query('BEGIN');

  try {
    for (const [guildId, guildState] of Object.entries(legacyState.guilds)) {
      await writeGuildStateToDatabase(db, guildId, guildState);
    }

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function initialiseDatabaseStore() {
  const pool = getDatabasePool();
  if (!pool) {
    return;
  }

  await createNormalisedTables(pool);
  await migrateLegacyDatabaseStore(pool);
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
      const guildIds = await listGuildIds();

      const guilds = {};
      for (const guildId of guildIds) {
        guilds[guildId] = await readGuildStateFromDatabase(pool, guildId);
      }

      return {
        version: STORE_VERSION,
        guilds
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
      const result = await pool.query('SELECT guild_id FROM guilds ORDER BY guild_id');
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
      return await readGuildStateFromDatabase(getDatabasePool(), normalisedGuildId);
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
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingGuildIdsResult = await client.query('SELECT guild_id FROM guilds');
      const existingGuildIds = new Set(existingGuildIdsResult.rows.map((row) => row.guild_id));
      const nextGuildIds = new Set(Object.keys(nextState.guilds));

      for (const guildId of existingGuildIds) {
        if (!nextGuildIds.has(guildId)) {
          await client.query('DELETE FROM guilds WHERE guild_id = $1', [guildId]);
        }
      }

      for (const [guildId, guildState] of Object.entries(nextState.guilds)) {
        await writeGuildStateToDatabase(client, guildId, guildState);
      }

      await client.query('COMMIT');
      return nextState;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
    await writeGuildStateToDatabase(getDatabasePool(), normalisedGuildId, nextGuildState);
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
        `INSERT INTO guilds (guild_id, updated_at)
         VALUES ($1, NOW())
         ON CONFLICT (guild_id)
         DO UPDATE SET updated_at = NOW()`,
        [normalisedGuildId]
      );

      await client.query(
        'SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE',
        [normalisedGuildId]
      );

      const guildState = await readGuildStateFromDatabase(client, normalisedGuildId);
      const result = await updater(guildState);
      await writeGuildStateToDatabase(client, normalisedGuildId, guildState);

      await client.query('COMMIT');
      return result;
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

async function getStoreStatus() {
  const mode = shouldUseDatabase() ? 'database' : 'file';

  try {
    await ensureStoreInitialised();

    if (shouldUseDatabase()) {
      const pool = getDatabasePool();
      const guildCount = await countNormalisedGuilds(pool);

      return {
        mode,
        healthy: true,
        guildCount,
        filePath: '',
        error: ''
      };
    }

    const filePath = ensureFileStoreExists();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = normaliseState(JSON.parse(raw));

    return {
      mode,
      healthy: true,
      guildCount: Object.keys(state.guilds || {}).length,
      filePath,
      error: ''
    };
  } catch (error) {
    return {
      mode,
      healthy: false,
      guildCount: 0,
      filePath: mode === 'file' ? resolveDataFilePath() : '',
      error: error.message || String(error)
    };
  }
}

module.exports = {
  getDefaultGuildState,
  getDefaultState,
  getStoreStatus,
  listGuildIds,
  readGuildState,
  readStore,
  resolveDataFilePath,
  updateGuildState,
  updateStore,
  writeGuildState,
  writeStore
};