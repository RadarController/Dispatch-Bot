const { GatewayIntentBits } = require('discord.js');
const { config } = require('./config');
const { PLATFORM_LABELS, PLATFORMS } = require('./liveProviders');
const { getLiveMonitorStatus } = require('./liveService');
const store = require('./store');

function buildLiveSessionSummaries(guildState) {
  return Object.entries(guildState.liveSessions || {})
    .map(([discordUserId, session]) => {
      const streamer = guildState.streamers?.[discordUserId] || null;
      const activePlatforms = PLATFORMS
        .filter((platform) => session?.platforms?.[platform]?.isLive)
        .map((platform) => PLATFORM_LABELS[platform]);

      return {
        discordUserId,
        displayName: streamer?.displayName || `Streamer ${discordUserId}`,
        platforms: activePlatforms,
        startedAt: session?.startedAt || null,
        updatedAt: session?.updatedAt || null
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function getBotStatus(client) {
  const storeStatus = await store.getStoreStatus();
  const liveMonitorStatus = getLiveMonitorStatus();

  return {
    uptimeMs: client.uptime || 0,
    guildCount: client.guilds.cache.size,
    commandCount: client.commands?.size || 0,
    storeStatus,
    liveMonitorStatus,
    intents: {
      guildMembers: typeof client.options?.intents?.has === 'function'
        ? client.options.intents.has(GatewayIntentBits.GuildMembers)
        : false
    },
    integrations: {
      metarConfigured: Boolean(config.metarApiBase),
      vatsimDataUrl: config.vatsimDataUrl || '',
      vatsimAipBaseUrl: config.vatsimAipBaseUrl || '',
      livePollIntervalMs: config.livePollIntervalMs
    }
  };
}

async function getGuildStatus(guild) {
  const guildState = await store.readGuildState(guild.id);
  const liveConfig = guildState.liveConfig || {};
  const rolePanelConfig = guildState.rolePanelConfig || {};
  const welcomeConfig = guildState.welcomeConfig || store.getDefaultGuildState().welcomeConfig;

  return {
    guildId: guild.id,
    guildName: guild.name,
    streamerCount: Object.keys(guildState.streamers || {}).length,
    liveSessionCount: Object.keys(guildState.liveSessions || {}).length,
    liveConfig: {
      streamerRoleId: liveConfig.streamerRoleId || '',
      livePingRoleId: liveConfig.livePingRoleId || '',
      liveAnnouncementsChannelId: liveConfig.liveAnnouncementsChannelId || ''
    },
    rolePanelConfig: {
      channelId: rolePanelConfig.channelId || '',
      roleIds: Array.isArray(rolePanelConfig.roleIds) ? rolePanelConfig.roleIds : []
    },
    welcomeConfig: {
      enabled: welcomeConfig.enabled === true,
      channelId: welcomeConfig.channelId || '',
      rulesChannelId: welcomeConfig.rulesChannelId || '',
      useMentions: welcomeConfig.useMentions !== false,
      customMessageCount: Array.isArray(welcomeConfig.messages) ? welcomeConfig.messages.length : 0
    }
  };
}

async function getGuildLiveStatus(guild) {
  const guildState = await store.readGuildState(guild.id);
  const liveConfig = guildState.liveConfig || {};

  return {
    guildId: guild.id,
    guildName: guild.name,
    announcementChannelId: liveConfig.liveAnnouncementsChannelId || '',
    registeredStreamerCount: Object.keys(guildState.streamers || {}).length,
    liveMonitorStatus: getLiveMonitorStatus(),
    sessions: buildLiveSessionSummaries(guildState)
  };
}

module.exports = {
  getBotStatus,
  getGuildLiveStatus,
  getGuildStatus
};