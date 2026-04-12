const dotenv = require('dotenv');

dotenv.config();

const requestedLivePollIntervalMs = Number.parseInt(process.env.LIVE_POLL_INTERVAL_MS || '60000', 10);

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || '',
  metarApiBase: process.env.METAR_API_BASE || '',
  metarApiKey: process.env.METAR_API_KEY || '',
  vatsimDataUrl: process.env.VATSIM_DATA_URL || 'https://data.vatsim.net/v3/vatsim-data.json',
  vatsimAipBaseUrl: process.env.VATSIM_AIP_API_BASE || 'https://my.vatsim.net/api/v2/aip',
  dataFilePath: process.env.DISPATCH_BOT_DATA_FILE || '',
  livePollIntervalMs: Number.isInteger(requestedLivePollIntervalMs) && requestedLivePollIntervalMs >= 15000
    ? requestedLivePollIntervalMs
    : 60000
};

function getMissingRequiredConfig() {
  const missing = [];

  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.discordClientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.discordGuildId) missing.push('DISCORD_GUILD_ID');

  return missing;
}

module.exports = {
  config,
  getMissingRequiredConfig
};
