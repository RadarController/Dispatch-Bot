const store = require('./store');

function normaliseIataDesignator(value) {
  const normalised = `${value || ''}`.trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(normalised) ? normalised : '';
}

function normaliseIcaoRoot(value) {
  const normalised = `${value || ''}`.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalised) ? normalised : '';
}

async function getGuildState(guildId) {
  return store.readGuildState(guildId);
}

async function getCallsignConfig(guildId) {
  return (await getGuildState(guildId)).callsignConfig;
}

async function listCallsignMappings(guildId) {
  const config = await getCallsignConfig(guildId);

  return Object.entries(config.iataMappings || {})
    .map(([iataDesignator, icaoRoot]) => ({ iataDesignator, icaoRoot }))
    .sort((left, right) => left.iataDesignator.localeCompare(right.iataDesignator));
}

async function resolveIcaoRoot(guildId, iataDesignator) {
  const normalisedIataDesignator = normaliseIataDesignator(iataDesignator);
  if (!normalisedIataDesignator) {
    return '';
  }

  const config = await getCallsignConfig(guildId);
  return config.iataMappings?.[normalisedIataDesignator] || '';
}

async function setCallsignMapping(guildId, iataDesignator, icaoRoot) {
  const normalisedIataDesignator = normaliseIataDesignator(iataDesignator);
  const normalisedIcaoRoot = normaliseIcaoRoot(icaoRoot);

  if (!normalisedIataDesignator) {
    throw new Error('IATA designator must be two alphanumeric characters.');
  }

  if (!normalisedIcaoRoot) {
    throw new Error('ICAO root must be three letters.');
  }

  return store.updateGuildState(guildId, (guildState) => {
    guildState.callsignConfig = guildState.callsignConfig || store.getDefaultGuildState().callsignConfig;
    guildState.callsignConfig.iataMappings = guildState.callsignConfig.iataMappings || {};
    guildState.callsignConfig.iataMappings[normalisedIataDesignator] = normalisedIcaoRoot;

    return {
      iataDesignator: normalisedIataDesignator,
      icaoRoot: normalisedIcaoRoot
    };
  });
}

async function removeCallsignMapping(guildId, iataDesignator) {
  const normalisedIataDesignator = normaliseIataDesignator(iataDesignator);

  if (!normalisedIataDesignator) {
    throw new Error('IATA designator must be two alphanumeric characters.');
  }

  return store.updateGuildState(guildId, (guildState) => {
    guildState.callsignConfig = guildState.callsignConfig || store.getDefaultGuildState().callsignConfig;
    guildState.callsignConfig.iataMappings = guildState.callsignConfig.iataMappings || {};

    const existingIcaoRoot = guildState.callsignConfig.iataMappings[normalisedIataDesignator] || '';
    if (!existingIcaoRoot) {
      return null;
    }

    delete guildState.callsignConfig.iataMappings[normalisedIataDesignator];

    return {
      iataDesignator: normalisedIataDesignator,
      icaoRoot: existingIcaoRoot
    };
  });
}

module.exports = {
  getCallsignConfig,
  listCallsignMappings,
  normaliseIataDesignator,
  normaliseIcaoRoot,
  removeCallsignMapping,
  resolveIcaoRoot,
  setCallsignMapping
};