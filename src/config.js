const dotenv = require('dotenv');

dotenv.config();

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || '',
  metarApiBase: process.env.METAR_API_BASE || '',
  metarApiKey: process.env.METAR_API_KEY || ''
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
