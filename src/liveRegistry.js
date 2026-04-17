const { PLATFORMS } = require('./liveProviders');
const { getDefaultGuildState, readStore, updateStore } = require('./store');

function createEmptyChannels() {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, null]));
}

function normaliseStreamerRecord(record, discordUserId) {
  return {
    discordUserId,
    displayName: record?.displayName || '',
    channels: {
      ...createEmptyChannels(),
      ...(record?.channels || {})
    },
    addedAt: record?.addedAt || null,
    updatedAt: record?.updatedAt || null
  };
}

async function getGuildState(guildId) {
  const state = await readStore();
  return state.guilds?.[guildId] || getDefaultGuildState();
}

async function getLiveConfig(guildId) {
  return (await getGuildState(guildId)).liveConfig;
}

async function setLiveConfig(guildId, patch) {
  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();
    state.guilds[guildId].liveConfig = {
      ...state.guilds[guildId].liveConfig,
      ...patch
    };

    return state.guilds[guildId].liveConfig;
  });
}

async function listStreamers(guildId) {
  const guildState = await getGuildState(guildId);

  return Object.entries(guildState.streamers)
    .map(([discordUserId, record]) => normaliseStreamerRecord(record, discordUserId))
    .sort((left, right) => left.discordUserId.localeCompare(right.discordUserId));
}

async function getStreamer(guildId, discordUserId) {
  const guildState = await getGuildState(guildId);
  const record = guildState.streamers[discordUserId];
  return record ? normaliseStreamerRecord(record, discordUserId) : null;
}

async function upsertStreamer(guildId, discordUserId, patch = {}) {
  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();

    const existing = normaliseStreamerRecord(state.guilds[guildId].streamers[discordUserId], discordUserId);
    const next = {
      ...existing,
      ...patch,
      discordUserId,
      channels: {
        ...existing.channels,
        ...(patch.channels || {})
      },
      addedAt: existing.addedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.guilds[guildId].streamers[discordUserId] = next;
    return next;
  });
}

async function removeStreamer(guildId, discordUserId) {
  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();

    const existing = state.guilds[guildId].streamers[discordUserId]
      ? normaliseStreamerRecord(state.guilds[guildId].streamers[discordUserId], discordUserId)
      : null;

    delete state.guilds[guildId].streamers[discordUserId];
    delete state.guilds[guildId].liveSessions[discordUserId];

    return existing;
  });
}

async function setStreamerChannel(guildId, discordUserId, platform, channel) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();

    const existing = normaliseStreamerRecord(state.guilds[guildId].streamers[discordUserId], discordUserId);
    existing.channels[platform] = channel;
    existing.addedAt = existing.addedAt || new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    state.guilds[guildId].streamers[discordUserId] = existing;
    return existing;
  });
}

async function removeStreamerChannel(guildId, discordUserId, platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();

    const existing = state.guilds[guildId].streamers[discordUserId]
      ? normaliseStreamerRecord(state.guilds[guildId].streamers[discordUserId], discordUserId)
      : null;

    if (!existing) {
      return null;
    }

    existing.channels[platform] = null;
    existing.updatedAt = new Date().toISOString();
    state.guilds[guildId].streamers[discordUserId] = existing;
    return existing;
  });
}

async function getLiveSession(guildId, discordUserId) {
  return (await getGuildState(guildId)).liveSessions[discordUserId] || null;
}

async function setLiveSession(guildId, discordUserId, session) {
  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();
    state.guilds[guildId].liveSessions[discordUserId] = session;
    return state.guilds[guildId].liveSessions[discordUserId];
  });
}

async function clearLiveSession(guildId, discordUserId) {
  return updateStore((state) => {
    state.guilds[guildId] = state.guilds[guildId] || getDefaultGuildState();
    const existing = state.guilds[guildId].liveSessions[discordUserId] || null;
    delete state.guilds[guildId].liveSessions[discordUserId];
    return existing;
  });
}

module.exports = {
  clearLiveSession,
  getLiveConfig,
  getLiveSession,
  getStreamer,
  listStreamers,
  removeStreamer,
  removeStreamerChannel,
  setLiveConfig,
  setLiveSession,
  setStreamerChannel,
  upsertStreamer
};