const { PLATFORMS } = require('./liveProviders');
const { readStore, updateStore } = require('./store');

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

function getLiveConfig() {
  return readStore().liveConfig;
}

function setLiveConfig(patch) {
  return updateStore((state) => {
    state.liveConfig = {
      ...state.liveConfig,
      ...patch
    };

    return state.liveConfig;
  });
}

function listStreamers() {
  const state = readStore();

  return Object.entries(state.streamers)
    .map(([discordUserId, record]) => normaliseStreamerRecord(record, discordUserId))
    .sort((a, b) => a.discordUserId.localeCompare(b.discordUserId));
}

function getStreamer(discordUserId) {
  const state = readStore();
  const record = state.streamers[discordUserId];
  return record ? normaliseStreamerRecord(record, discordUserId) : null;
}

function upsertStreamer(discordUserId, patch = {}) {
  return updateStore((state) => {
    const existing = normaliseStreamerRecord(state.streamers[discordUserId], discordUserId);
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

    state.streamers[discordUserId] = next;
    return next;
  });
}

function removeStreamer(discordUserId) {
  return updateStore((state) => {
    const existing = state.streamers[discordUserId]
      ? normaliseStreamerRecord(state.streamers[discordUserId], discordUserId)
      : null;

    delete state.streamers[discordUserId];
    delete state.liveSessions[discordUserId];

    return existing;
  });
}

function setStreamerChannel(discordUserId, platform, channel) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return updateStore((state) => {
    const existing = normaliseStreamerRecord(state.streamers[discordUserId], discordUserId);
    existing.channels[platform] = channel;
    existing.addedAt = existing.addedAt || new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    state.streamers[discordUserId] = existing;
    return existing;
  });
}

function removeStreamerChannel(discordUserId, platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return updateStore((state) => {
    const existing = state.streamers[discordUserId]
      ? normaliseStreamerRecord(state.streamers[discordUserId], discordUserId)
      : null;

    if (!existing) {
      return null;
    }

    existing.channels[platform] = null;
    existing.updatedAt = new Date().toISOString();
    state.streamers[discordUserId] = existing;
    return existing;
  });
}

function getLiveSession(discordUserId) {
  return readStore().liveSessions[discordUserId] || null;
}

function setLiveSession(discordUserId, session) {
  return updateStore((state) => {
    state.liveSessions[discordUserId] = session;
    return state.liveSessions[discordUserId];
  });
}

function clearLiveSession(discordUserId) {
  return updateStore((state) => {
    const existing = state.liveSessions[discordUserId] || null;
    delete state.liveSessions[discordUserId];
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
