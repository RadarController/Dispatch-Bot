const { ChannelType } = require('discord.js');
const { config } = require('./config');
const { checkLiveChannel, PLATFORM_LABELS, PLATFORMS } = require('./liveProviders');
const store = require('./store');

let liveMonitorHandle = null;
let tickInProgress = false;

const OFFLINE_CONFIRMATION_POLLS = 3;

const liveMonitorStatus = {
  running: false,
  tickInProgress: false,
  startedAt: null,
  intervalMs: config.livePollIntervalMs,
  lastTickStartedAt: null,
  lastTickCompletedAt: null,
  lastTickDurationMs: null,
  lastTickGuildCount: 0,
  lastTickStreamerCount: 0,
  lastTickError: ''
};

function getLiveMonitorStatus() {
  return {
    ...liveMonitorStatus
  };
}

function hasAnyLivePlatform(platformStates) {
  return Object.values(platformStates).some((state) => state?.isLive);
}

function canonicaliseLiveUrl(url) {
  const raw = `${url || ''}`.trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';

    let pathname = parsed.pathname || '/';
    pathname = pathname.replace(/\/+$/, '');
    parsed.pathname = pathname || '/';

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function buildStablePlatformSummary(streamer, platformStates) {
  return Object.fromEntries(
    Object.entries(platformStates)
      .filter(([, state]) => state?.isLive)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([platform, state]) => {
        const configuredUrl = streamer.channels?.[platform]?.url || '';
        const stableUrl = canonicaliseLiveUrl(state.liveUrl || configuredUrl);

        return [platform, {
          liveUrl: stableUrl
        }];
      })
  );
}

function buildAnnouncementHash(streamer, platformStates) {
  return JSON.stringify(buildStablePlatformSummary(streamer, platformStates));
}

function buildAnnouncementPayload(streamer, liveConfig, session, includePing) {
  const displayName = streamer.displayName || `Streamer ${streamer.discordUserId}`;
  const lines = [];

  if (includePing && liveConfig.livePingRoleId) {
    lines.push(`<@&${liveConfig.livePingRoleId}>`);
    lines.push('');
  }

  lines.push(`**${displayName} is now live**`);
  lines.push(`Registered streamer: <@${streamer.discordUserId}>`);
  lines.push(`Started: <t:${Math.floor(new Date(session.startedAt).getTime() / 1000)}:R>`);
  lines.push('');
  lines.push('**Platforms currently live**');

  for (const platform of PLATFORMS) {
    const state = session.platforms?.[platform];
    if (!state?.isLive) {
      continue;
    }

    lines.push(`- ${PLATFORM_LABELS[platform]}: ${state.liveUrl}`);
    if (state.title) {
      lines.push(`  Title: ${state.title}`);
    }
  }

  lines.push('');
  lines.push(`Last checked: <t:${Math.floor(Date.now() / 1000)}:R>`);

  return {
    content: lines.join('\n'),
    allowedMentions: includePing && liveConfig.livePingRoleId
      ? { roles: [liveConfig.livePingRoleId] }
      : { parse: [] }
  };
}

async function getAnnouncementChannel(client, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
    return null;
  }

  return channel;
}

async function saveLiveSession(guildId, discordUserId, session) {
  await store.updateGuildState(guildId, (guildState) => {
    guildState.liveSessions = guildState.liveSessions || {};
    guildState.liveSessions[discordUserId] = session;
    return guildState.liveSessions[discordUserId];
  });
}

async function clearLiveSession(guildId, discordUserId) {
  await store.updateGuildState(guildId, (guildState) => {
    guildState.liveSessions = guildState.liveSessions || {};
    delete guildState.liveSessions[discordUserId];
    return null;
  });
}

async function processStreamer(client, guildId, streamer) {
  const guildState = await store.readGuildState(guildId);
  const liveConfig = guildState.liveConfig || {};
  const announcementChannel = await getAnnouncementChannel(client, liveConfig.liveAnnouncementsChannelId);

  if (!announcementChannel) {
    return;
  }

  if (announcementChannel.guild?.id !== guildId) {
    return;
  }

  const platformStates = {};

  for (const platform of PLATFORMS) {
    const channel = streamer.channels?.[platform];
    if (channel?.url) {
      platformStates[platform] = await checkLiveChannel(channel);
    }
  }

  const isActive = hasAnyLivePlatform(platformStates);
  const existingSession = guildState.liveSessions?.[streamer.discordUserId] || null;

  if (!isActive) {
    if (!existingSession) {
      return;
    }

    const nextOfflineMissCount = Number(existingSession.offlineMissCount || 0) + 1;

    if (nextOfflineMissCount < OFFLINE_CONFIRMATION_POLLS) {
      await saveLiveSession(guildId, streamer.discordUserId, {
        ...existingSession,
        updatedAt: new Date().toISOString(),
        offlineMissCount: nextOfflineMissCount
      });
      return;
    }

    await clearLiveSession(guildId, streamer.discordUserId);
    return;
  }

  const nowIso = new Date().toISOString();
  const nextSession = existingSession
    ? { ...existingSession }
    : {
        startedAt: nowIso,
        announcementChannelId: announcementChannel.id,
        announcementMessageId: ''
      };

  nextSession.platforms = platformStates;
  nextSession.updatedAt = nowIso;
  nextSession.offlineMissCount = 0;

  const nextHash = buildAnnouncementHash(streamer, platformStates);
  const shouldCreateMessage = !nextSession.announcementMessageId;
  const shouldUpdateMessage = !shouldCreateMessage && nextHash !== existingSession?.lastAnnouncementHash;

  if (shouldCreateMessage) {
    const payload = buildAnnouncementPayload(streamer, liveConfig, nextSession, true);
    const message = await announcementChannel.send(payload);
    nextSession.announcementMessageId = message.id;
    nextSession.announcementChannelId = message.channelId;
  } else if (shouldUpdateMessage) {
    const payload = buildAnnouncementPayload(streamer, liveConfig, nextSession, false);
    const message = await announcementChannel.messages.fetch(nextSession.announcementMessageId).catch(() => null);

    if (message) {
      await message.edit(payload);
    } else {
      console.warn(
        `Could not fetch existing announcement message ${nextSession.announcementMessageId} for streamer ${streamer.discordUserId} in guild ${guildId}; keeping current session without posting a replacement.`
      );
    }
  }

  nextSession.lastAnnouncementHash = nextHash;
  await saveLiveSession(guildId, streamer.discordUserId, nextSession);
}

async function runLiveMonitorTick(client) {
  if (tickInProgress) {
    return;
  }

  tickInProgress = true;
  liveMonitorStatus.tickInProgress = true;
  liveMonitorStatus.lastTickStartedAt = new Date().toISOString();
  liveMonitorStatus.lastTickError = '';

  const tickStartedAtMs = Date.now();
  let guildCount = 0;
  let streamerCount = 0;

  try {
    const guildIds = await store.listGuildIds();
    guildCount = guildIds.length;

    for (const guildId of guildIds) {
      const state = await store.readGuildState(guildId);
      const streamers = Object.values(state.streamers || {});
      streamerCount += streamers.length;

      if (streamers.length === 0) {
        continue;
      }

      for (const streamer of streamers) {
        await processStreamer(client, guildId, streamer);
      }
    }
  } catch (error) {
    liveMonitorStatus.lastTickError = error.message || String(error);
    console.error('Live monitor tick failed:', error);
  } finally {
    liveMonitorStatus.lastTickGuildCount = guildCount;
    liveMonitorStatus.lastTickStreamerCount = streamerCount;
    liveMonitorStatus.lastTickCompletedAt = new Date().toISOString();
    liveMonitorStatus.lastTickDurationMs = Date.now() - tickStartedAtMs;
    liveMonitorStatus.tickInProgress = false;
    tickInProgress = false;
  }
}

async function startLiveMonitor(client) {
  if (liveMonitorHandle) {
    return;
  }

  liveMonitorStatus.running = true;
  liveMonitorStatus.startedAt = liveMonitorStatus.startedAt || new Date().toISOString();
  liveMonitorStatus.intervalMs = config.livePollIntervalMs;

  await runLiveMonitorTick(client);

  liveMonitorHandle = setInterval(() => {
    runLiveMonitorTick(client).catch((error) => {
      console.error('Scheduled live monitor tick failed:', error);
    });
  }, config.livePollIntervalMs);

  if (typeof liveMonitorHandle.unref === 'function') {
    liveMonitorHandle.unref();
  }

  console.log(`Started live monitor with a ${config.livePollIntervalMs}ms interval.`);
}

module.exports = {
  getLiveMonitorStatus,
  startLiveMonitor
};