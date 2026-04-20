const store = require('./store');

function getDefaultWelcomeConfig() {
  return {
    ...store.getDefaultGuildState().welcomeConfig,
    messages: [...store.getDefaultGuildState().welcomeConfig.messages]
  };
}

function cloneWelcomeConfig(config) {
  const defaults = getDefaultWelcomeConfig();

  return {
    ...defaults,
    ...(config || {}),
    messages: Array.isArray(config?.messages) ? [...config.messages] : [...defaults.messages]
  };
}

async function getWelcomeConfig(guildId) {
  const guildState = await store.readGuildState(guildId);
  return cloneWelcomeConfig(guildState.welcomeConfig);
}

async function setWelcomeConfig(guildId, patch) {
  return store.updateGuildState(guildId, (guildState) => {
    guildState.welcomeConfig = {
      ...getDefaultWelcomeConfig(),
      ...(guildState.welcomeConfig || {}),
      ...patch,
      messages: Array.isArray(patch?.messages)
        ? [...patch.messages]
        : Array.isArray(guildState.welcomeConfig?.messages)
          ? [...guildState.welcomeConfig.messages]
          : []
    };

    return cloneWelcomeConfig(guildState.welcomeConfig);
  });
}

async function listWelcomeMessages(guildId) {
  return (await getWelcomeConfig(guildId)).messages;
}

async function addWelcomeMessage(guildId, message) {
  const trimmedMessage = `${message}`.trim();

  if (!trimmedMessage) {
    throw new Error('Welcome message cannot be empty.');
  }

  return store.updateGuildState(guildId, (guildState) => {
    const currentConfig = cloneWelcomeConfig(guildState.welcomeConfig);

    currentConfig.messages.push(trimmedMessage);
    guildState.welcomeConfig = currentConfig;

    return cloneWelcomeConfig(guildState.welcomeConfig);
  });
}

async function removeWelcomeMessage(guildId, zeroBasedIndex) {
  return store.updateGuildState(guildId, (guildState) => {
    const currentConfig = cloneWelcomeConfig(guildState.welcomeConfig);

    if (
      !Number.isInteger(zeroBasedIndex) ||
      zeroBasedIndex < 0 ||
      zeroBasedIndex >= currentConfig.messages.length
    ) {
      return null;
    }

    const nextMessages = [...currentConfig.messages];
    const [removed] = nextMessages.splice(zeroBasedIndex, 1);

    guildState.welcomeConfig = {
      ...currentConfig,
      messages: nextMessages
    };

    return {
      removed,
      config: cloneWelcomeConfig(guildState.welcomeConfig)
    };
  });
}

async function clearWelcomeMessages(guildId) {
  return store.updateGuildState(guildId, (guildState) => {
    const currentConfig = cloneWelcomeConfig(guildState.welcomeConfig);

    guildState.welcomeConfig = {
      ...currentConfig,
      messages: []
    };

    return cloneWelcomeConfig(guildState.welcomeConfig);
  });
}

module.exports = {
  addWelcomeMessage,
  clearWelcomeMessages,
  getWelcomeConfig,
  listWelcomeMessages,
  removeWelcomeMessage,
  setWelcomeConfig
};