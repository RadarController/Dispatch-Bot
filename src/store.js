const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');

const STORE_VERSION = 1;

function getDefaultState() {
  return {
    version: STORE_VERSION,
    liveConfig: {
      streamerRoleId: '',
      livePingRoleId: '',
      liveAnnouncementsChannelId: ''
    },
    streamers: {},
    liveSessions: {}
  };
}

function resolveDataFilePath() {
  return config.dataFilePath || path.join(process.cwd(), 'data', 'dispatch-bot.json');
}

function ensureStoreFile() {
  const filePath = resolveDataFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(getDefaultState(), null, 2));
  }

  return filePath;
}

function normaliseState(raw) {
  const defaults = getDefaultState();

  return {
    version: STORE_VERSION,
    liveConfig: {
      ...defaults.liveConfig,
      ...(raw?.liveConfig || {})
    },
    streamers: raw?.streamers && typeof raw.streamers === 'object' ? raw.streamers : {},
    liveSessions: raw?.liveSessions && typeof raw.liveSessions === 'object' ? raw.liveSessions : {}
  };
}

function readStore() {
  const filePath = ensureStoreFile();

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return normaliseState(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read store, falling back to defaults:', error);
    return getDefaultState();
  }
}

function writeStore(state) {
  const filePath = ensureStoreFile();
  const nextState = normaliseState(state);
  const tempFilePath = `${filePath}.tmp`;

  fs.writeFileSync(tempFilePath, JSON.stringify(nextState, null, 2));
  fs.renameSync(tempFilePath, filePath);

  return nextState;
}

function updateStore(updater) {
  const state = readStore();
  const result = updater(state);
  writeStore(state);
  return result;
}

module.exports = {
  getDefaultState,
  readStore,
  resolveDataFilePath,
  updateStore,
  writeStore
};
