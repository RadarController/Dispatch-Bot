const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  getBotStatus,
  getGuildLiveStatus,
  getGuildStatus
} = require('../statusService');

const STATUS_EMBED_COLOUR = 0x1f6feb;
const FIELD_LIMIT = 1024;

function formatChannelMention(channelId) {
  return channelId ? `<#${channelId}>` : 'Not configured';
}

function formatRoleMention(roleId) {
  return roleId ? `<@&${roleId}>` : 'Not configured';
}

function formatBoolean(value, trueLabel = 'Yes', falseLabel = 'No') {
  return value ? trueLabel : falseLabel;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'Unavailable';
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDiscordTimestamp(value) {
  if (!value) {
    return 'Never';
  }

  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Never';
  }

  return `<t:${timestamp}:R>`;
}

function truncateText(text, maxLength = FIELD_LIMIT) {
  const value = String(text || '');
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function joinLinesWithinLimit(lines, maxLength = FIELD_LIMIT) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'None';
  }

  let output = '';
  let included = 0;

  for (const line of lines) {
    const next = output ? `${output}\n${line}` : line;

    if (next.length > maxLength) {
      break;
    }

    output = next;
    included += 1;
  }

  const remaining = lines.length - included;
  if (remaining > 0) {
    const suffix = `\n…and ${remaining} more`;
    if ((output + suffix).length <= maxLength) {
      output += suffix;
    }
  }

  return output || 'None';
}

function buildBotStatusEmbed(status) {
  const embed = new EmbedBuilder()
    .setColor(STATUS_EMBED_COLOUR)
    .setTitle('Dispatch Bot status')
    .addFields(
      {
        name: 'Runtime',
        value: [
          `Uptime: ${formatDuration(status.uptimeMs)}`,
          `Connected guilds: ${status.guildCount}`,
          `Loaded commands: ${status.commandCount}`,
          `Guild Members intent: ${formatBoolean(status.intents.guildMembers, 'Enabled', 'Disabled')}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Store',
        value: [
          `Mode: ${status.storeStatus.mode === 'database' ? 'Postgres' : 'File'}`,
          `Healthy: ${formatBoolean(status.storeStatus.healthy)}`,
          `Stored guild states: ${status.storeStatus.guildCount}`,
          status.storeStatus.filePath ? `File path: ${truncateText(status.storeStatus.filePath, 250)}` : null,
          status.storeStatus.error ? `Last error: ${truncateText(status.storeStatus.error, 250)}` : null
        ].filter(Boolean).join('\n'),
        inline: false
      },
      {
        name: 'Live monitor',
        value: [
          `Running: ${formatBoolean(status.liveMonitorStatus.running)}`,
          `Tick in progress: ${formatBoolean(status.liveMonitorStatus.tickInProgress)}`,
          `Poll interval: ${formatDuration(status.integrations.livePollIntervalMs)}`,
          `Started: ${formatDiscordTimestamp(status.liveMonitorStatus.startedAt)}`,
          `Last completed tick: ${formatDiscordTimestamp(status.liveMonitorStatus.lastTickCompletedAt)}`,
          `Last tick duration: ${formatDuration(status.liveMonitorStatus.lastTickDurationMs)}`,
          `Last tick guilds: ${status.liveMonitorStatus.lastTickGuildCount}`,
          `Last tick streamers: ${status.liveMonitorStatus.lastTickStreamerCount}`,
          `Last tick error: ${status.liveMonitorStatus.lastTickError ? truncateText(status.liveMonitorStatus.lastTickError, 200) : 'None'}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Integrations',
        value: [
          `METAR configured: ${formatBoolean(status.integrations.metarConfigured)}`,
          `VATSIM data URL: ${truncateText(status.integrations.vatsimDataUrl, 250)}`,
          `VATSIM AIP URL: ${truncateText(status.integrations.vatsimAipBaseUrl, 250)}`
        ].join('\n'),
        inline: false
      }
    );

  return embed;
}

function buildGuildStatusEmbed(status) {
  const welcomeMessageSource = status.welcomeConfig.customMessageCount > 0
    ? 'Custom messages'
    : 'Built-in defaults';

  return new EmbedBuilder()
    .setColor(STATUS_EMBED_COLOUR)
    .setTitle(`${status.guildName} status`)
    .addFields(
      {
        name: 'Live announcements',
        value: [
          `Registered streamers: ${status.streamerCount}`,
          `Currently live: ${status.liveSessionCount}`,
          `Announcement channel: ${formatChannelMention(status.liveConfig.liveAnnouncementsChannelId)}`,
          `Alert role: ${formatRoleMention(status.liveConfig.livePingRoleId)}`,
          `Streamer role: ${formatRoleMention(status.liveConfig.streamerRoleId)}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Welcome',
        value: [
          `Enabled: ${formatBoolean(status.welcomeConfig.enabled)}`,
          `Channel: ${formatChannelMention(status.welcomeConfig.channelId)}`,
          `Rules channel: ${formatChannelMention(status.welcomeConfig.rulesChannelId)}`,
          `Mentions: ${formatBoolean(status.welcomeConfig.useMentions)}`,
          `Message source: ${welcomeMessageSource}`,
          `Custom messages: ${status.welcomeConfig.customMessageCount}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Role panel',
        value: [
          `Channel: ${formatChannelMention(status.rolePanelConfig.channelId)}`,
          `Configured roles: ${status.rolePanelConfig.roleIds.length}`
        ].join('\n'),
        inline: false
      }
    );
}

function buildLiveStatusEmbed(status) {
  const liveLines = status.sessions.map((session) => {
    const platforms = session.platforms.length > 0 ? session.platforms.join(', ') : 'Unknown platform';
    return `- **${session.displayName}** (<@${session.discordUserId}>) — ${platforms} • started ${formatDiscordTimestamp(session.startedAt)}`;
  });

  return new EmbedBuilder()
    .setColor(STATUS_EMBED_COLOUR)
    .setTitle(`${status.guildName} live status`)
    .addFields(
      {
        name: 'Monitor',
        value: [
          `Running: ${formatBoolean(status.liveMonitorStatus.running)}`,
          `Tick in progress: ${formatBoolean(status.liveMonitorStatus.tickInProgress)}`,
          `Poll interval: ${formatDuration(status.liveMonitorStatus.intervalMs)}`,
          `Last completed tick: ${formatDiscordTimestamp(status.liveMonitorStatus.lastTickCompletedAt)}`,
          `Last tick duration: ${formatDuration(status.liveMonitorStatus.lastTickDurationMs)}`,
          `Last tick error: ${status.liveMonitorStatus.lastTickError ? truncateText(status.liveMonitorStatus.lastTickError, 200) : 'None'}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Guild live summary',
        value: [
          `Announcement channel: ${formatChannelMention(status.announcementChannelId)}`,
          `Registered streamers: ${status.registeredStreamerCount}`,
          `Active live sessions: ${status.sessions.length}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Currently live',
        value: joinLinesWithinLimit(liveLines),
        inline: false
      }
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View Dispatch Bot status and diagnostics.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bot')
        .setDescription('Show bot runtime and store status.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('guild')
        .setDescription('Show configuration and feature status for this server.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('live')
        .setDescription('Show live monitor status and who is currently live in this server.')
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'bot') {
      const status = await getBotStatus(client);

      await interaction.reply({
        embeds: [buildBotStatusEmbed(status)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'guild') {
      const status = await getGuildStatus(interaction.guild);

      await interaction.reply({
        embeds: [buildGuildStatusEmbed(status)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const status = await getGuildLiveStatus(interaction.guild);

    await interaction.reply({
      embeds: [buildLiveStatusEmbed(status)],
      flags: MessageFlags.Ephemeral
    });
  }
};