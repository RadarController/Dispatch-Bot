const { ChannelType } = require('discord.js');
const { config } = require('./config');
const { checkLiveChannel, PLATFORM_LABELS, PLATFORMS } = require('./liveProviders');
const { listGuildIds, readGuildState, writeGuildState } = require('./store');

let liveMonitorHandle = null;
let tickInProgress = false;

function hasAnyLivePlatform(platformStates) {
  return Object.values(platformStates).some((state) => state?.isLive);
}

function buildAnnouncementHash(platformStates) {
  const summary = Object.fromEntries(
    Object.entries(platformStates)
      .filter(([, state]) => state?.isLive)
      .map(([platform, state]) => [platform, {
        liveUrl: state.liveUrl || '',
        title: state.title || ''
      }])
  );

  return JSON.stringify(summary);
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

async function processStreamer(client, guildId, state, streamer) {
  const liveConfig = state.liveConfig || {};
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
  const existingSession = state.liveSessions[streamer.discordUserId] || null;

  if (!isActive) {
    if (existingSession) {
      delete state.liveSessions[streamer.discordUserId];
    }
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

  const nextHash = buildAnnouncementHash(platformStates);
  const shouldCreateMessage = !nextSession.announcementMessageId;
  const shouldUpdateMessage = shouldCreateMessage || nextHash !== existingSession?.lastAnnouncementHash;

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
      const replacement = await announcementChannel.send(payload);
      nextSession.announcementMessageId = replacement.id;
      nextSession.announcementChannelId = replacement.channelId;
    }
  }

  nextSession.lastAnnouncementHash = nextHash;
  state.liveSessions[streamer.discordUserId] = nextSession;
}

async function runLiveMonitorTick(client) {
  if (tickInProgress) {
    return;
  }

  tickInProgress = true;

  try {
    const guildIds = await listGuildIds();

    if (guildIds.length === 0) {
      return;
    }

    for (const guildId of guildIds) {
      const state = await readGuildState(guildId);
      const streamers = Object.values(state.streamers || {});

      if (streamers.length === 0) {
        continue;
      }

      for (const streamer of streamers) {
        await processStreamer(client, guildId, state, streamer);
      }

      await writeGuildState(guildId, state);
    }
  } catch (error) {
    console.error('Live monitor tick failed:', error);
  } finally {
    tickInProgress = false;
  }
}

async function startLiveMonitor(client) {
  if (liveMonitorHandle) {
    return;
  }

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
  startLiveMonitor
};