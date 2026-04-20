const { PLATFORMS } = require('./liveProviders');
const { readGuildState, updateGuildState } = require('./store');

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

function normaliseDiscordUserId(discordUserId) {
  const normalised = `${discordUserId || ''}`.trim();
  if (!/^\d{17,20}$/.test(normalised)) {
    throw new Error('A valid Discord user ID is required.');
  }

  return normalised;
}

async function getGuildState(guildId) {
  return readGuildState(guildId);
}

async function getLiveConfig(guildId) {
  return (await getGuildState(guildId)).liveConfig;
}

async function setLiveConfig(guildId, patch) {
  return updateGuildState(guildId, (guildState) => {
    guildState.liveConfig = {
      ...guildState.liveConfig,
      ...patch
    };

    return guildState.liveConfig;
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
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);
  const record = guildState.streamers[normalisedDiscordUserId];
  return record ? normaliseStreamerRecord(record, normalisedDiscordUserId) : null;
}

async function upsertStreamer(guildId, discordUserId, patch = {}) {
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.streamers = guildState.streamers || {};

    const existing = normaliseStreamerRecord(guildState.streamers[normalisedDiscordUserId], normalisedDiscordUserId);
    const next = {
      ...existing,
      ...patch,
      discordUserId: normalisedDiscordUserId,
      channels: {
        ...existing.channels,
        ...(patch.channels || {})
      },
      addedAt: existing.addedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    guildState.streamers[normalisedDiscordUserId] = next;
    return next;
  });
}

async function removeStreamer(guildId, discordUserId) {
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.streamers = guildState.streamers || {};
    guildState.liveSessions = guildState.liveSessions || {};

    const existing = guildState.streamers[normalisedDiscordUserId]
      ? normaliseStreamerRecord(guildState.streamers[normalisedDiscordUserId], normalisedDiscordUserId)
      : null;

    delete guildState.streamers[normalisedDiscordUserId];
    delete guildState.liveSessions[normalisedDiscordUserId];

    return existing;
  });
}

async function setStreamerChannel(guildId, discordUserId, platform, channel) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.streamers = guildState.streamers || {};

    const existing = normaliseStreamerRecord(guildState.streamers[normalisedDiscordUserId], normalisedDiscordUserId);
    existing.channels[platform] = channel;
    existing.addedAt = existing.addedAt || new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    guildState.streamers[normalisedDiscordUserId] = existing;
    return existing;
  });
}

async function removeStreamerChannel(guildId, discordUserId, platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.streamers = guildState.streamers || {};

    const existing = guildState.streamers[normalisedDiscordUserId]
      ? normaliseStreamerRecord(guildState.streamers[normalisedDiscordUserId], normalisedDiscordUserId)
      : null;

    if (!existing) {
      return null;
    }

    existing.channels[platform] = null;
    existing.updatedAt = new Date().toISOString();
    guildState.streamers[normalisedDiscordUserId] = existing;
    return existing;
  });
}

async function getLiveSession(guildId, discordUserId) {
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);
  return (await getGuildState(guildId)).liveSessions[normalisedDiscordUserId] || null;
}

async function setLiveSession(guildId, discordUserId, session) {
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.liveSessions = guildState.liveSessions || {};
    guildState.liveSessions[normalisedDiscordUserId] = session;
    return guildState.liveSessions[normalisedDiscordUserId];
  });
}

async function clearLiveSession(guildId, discordUserId) {
  const normalisedDiscordUserId = normaliseDiscordUserId(discordUserId);

  return updateGuildState(guildId, (guildState) => {
    guildState.liveSessions = guildState.liveSessions || {};
    const existing = guildState.liveSessions[normalisedDiscordUserId] || null;
    delete guildState.liveSessions[normalisedDiscordUserId];
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
