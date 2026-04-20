const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  DAY_ORDER,
  DAY_LABELS,
  buildScheduleStatusText,
  clearCreatorScheduleEntries,
  clearScheduleConfig,
  ensureCreatorSchedule,
  formatModeLabel,
  getCreatorSchedule,
  getScheduleConfig,
  publishCreatorSchedule,
  refreshCreatorSchedule,
  removeCreatorScheduleEntry,
  setCreatorScheduleEntry,
  setScheduleConfig
} = require('../scheduleService');

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
}

async function getInvokingMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

function hasCreatorAccess(member, scheduleConfig) {
  if (!scheduleConfig.creatorRoleId) {
    return false;
  }

  return member.roles.cache.has(scheduleConfig.creatorRoleId);
}

function formatChannelMention(channelId) {
  return channelId ? `<#${channelId}>` : 'Not configured';
}

function formatRoleMention(roleId) {
  return roleId ? `<@&${roleId}>` : 'Not configured';
}

function buildAdminScheduleConfigStatus(config) {
  return [
    '**Schedule configuration**',
    `Channel: ${formatChannelMention(config.channelId)}`,
    `Mode: ${formatModeLabel(config.mode)}`,
    `Creator role: ${formatRoleMention(config.creatorRoleId)}`,
    `Title format: ${config.titleFormat || 'Not configured'}`
  ].join('\n');
}

function getDayChoices() {
  return DAY_ORDER.map((day) => ({
    name: DAY_LABELS[day],
    value: day
  }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Create and manage creator schedule posts.')
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName('config')
        .setDescription('Admin configuration for schedule posting.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('status')
            .setDescription('Show the current schedule configuration.')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-channel')
            .setDescription('Set the channel where creator schedules will be posted.')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Forum, text, or announcement channel')
                .addChannelTypes(ChannelType.GuildForum, ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-mode')
            .setDescription('Set whether schedules are created as forum posts or message threads.')
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('Schedule post mode')
                .setRequired(true)
                .addChoices(
                  { name: 'Forum post', value: 'forum_post' },
                  { name: 'Thread from message', value: 'thread' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-creator-role')
            .setDescription('Set the role that allows members to manage their own schedule.')
            .addRoleOption((option) =>
              option
                .setName('role')
                .setDescription('Creator role')
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-title-format')
            .setDescription('Set the schedule title format. Supported tokens: {displayName}, {username}')
            .addStringOption((option) =>
              option
                .setName('format')
                .setDescription('Title format')
                .setRequired(true)
                .setMaxLength(100)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('clear')
            .setDescription('Clear the schedule configuration for this server.')
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show your schedule status.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create your schedule post or thread.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Set one day of your schedule.')
        .addStringOption((option) => {
          option
            .setName('day')
            .setDescription('Schedule day')
            .setRequired(true);

          for (const choice of getDayChoices()) {
            option.addChoices(choice);
          }

          return option;
        })
        .addStringOption((option) =>
          option
            .setName('text')
            .setDescription('Schedule text for that day')
            .setRequired(true)
            .setMaxLength(300)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Clear one day from your schedule.')
        .addStringOption((option) => {
          option
            .setName('day')
            .setDescription('Schedule day')
            .setRequired(true);

          for (const choice of getDayChoices()) {
            option.addChoices(choice);
          }

          return option;
        })
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Clear all of your saved schedule entries.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('publish')
        .setDescription('Create or update your schedule post or thread.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh your existing schedule post or thread.')
    ),

  async execute(interaction, client) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const member = await getInvokingMember(interaction);
    const scheduleConfig = await getScheduleConfig(guildId);
    const admin = isAdmin(interaction);
    const creator = hasCreatorAccess(member, scheduleConfig);

    if (group === 'config') {
      if (!admin) {
        await interaction.reply({
          content: 'You need the Manage Server permission to change schedule configuration.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'status') {
        await interaction.reply({
          content: buildAdminScheduleConfigStatus(scheduleConfig),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'set-channel') {
        const channel = interaction.options.getChannel('channel', true);
        const nextConfig = await setScheduleConfig(guildId, { channelId: channel.id });

        await interaction.reply({
          content: [
            `Schedule channel set to ${formatChannelMention(nextConfig.channelId)}.`,
            buildAdminScheduleConfigStatus(nextConfig)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'set-mode') {
        const mode = interaction.options.getString('mode', true);
        const nextConfig = await setScheduleConfig(guildId, { mode });

        await interaction.reply({
          content: [
            `Schedule mode set to **${formatModeLabel(nextConfig.mode)}**.`,
            buildAdminScheduleConfigStatus(nextConfig)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'set-creator-role') {
        const role = interaction.options.getRole('role', true);
        const nextConfig = await setScheduleConfig(guildId, { creatorRoleId: role.id });

        await interaction.reply({
          content: [
            `Creator role set to ${formatRoleMention(nextConfig.creatorRoleId)}.`,
            buildAdminScheduleConfigStatus(nextConfig)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'set-title-format') {
        const format = interaction.options.getString('format', true);
        const nextConfig = await setScheduleConfig(guildId, { titleFormat: format });

        await interaction.reply({
          content: [
            `Schedule title format updated to \`${nextConfig.titleFormat}\`.`,
            buildAdminScheduleConfigStatus(nextConfig)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const nextConfig = await clearScheduleConfig(guildId);
      await interaction.reply({
        content: [
          'Schedule configuration cleared.',
          buildAdminScheduleConfigStatus(nextConfig)
        ].join('\n\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!admin && !creator) {
      await interaction.reply({
        content: scheduleConfig.creatorRoleId
          ? `You need the configured creator role ${formatRoleMention(scheduleConfig.creatorRoleId)} to manage your schedule.`
          : 'No creator role has been configured yet. Ask an admin to run `/schedule config set-creator-role` first.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const displayName = member.displayName || interaction.user.globalName || interaction.user.username;
    const existingSchedule = await getCreatorSchedule(guildId, interaction.user.id);

    if (subcommand === 'status') {
      await interaction.reply({
        content: buildScheduleStatusText(scheduleConfig, existingSchedule),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'create') {
      await ensureCreatorSchedule(guildId, interaction.user.id, displayName);
      const result = await publishCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);

      await interaction.reply({
        content: [
          'Your schedule post has been created or updated.',
          `Post/thread: ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'Unavailable'}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'set') {
      const day = interaction.options.getString('day', true);
      const text = interaction.options.getString('text', true);

      const schedule = await setCreatorScheduleEntry(guildId, interaction.user.id, displayName, day, text);

      let publishMessage = 'Your schedule entry was saved.';
      if (schedule.threadId) {
        const result = await publishCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);
        publishMessage = `Your schedule post was updated in ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'its schedule thread'}.`;
      }

      await interaction.reply({
        content: [
          `Set **${DAY_LABELS[day]}** to: ${text}`,
          publishMessage
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'remove') {
      const day = interaction.options.getString('day', true);
      const schedule = await removeCreatorScheduleEntry(guildId, interaction.user.id, day);

      let publishMessage = 'Your schedule entry was cleared.';
      if (schedule.threadId) {
        const result = await publishCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);
        publishMessage = `Your schedule post was updated in ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'its schedule thread'}.`;
      }

      await interaction.reply({
        content: [
          `Cleared **${DAY_LABELS[day]}** from your schedule.`,
          publishMessage
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'clear') {
      const schedule = await clearCreatorScheduleEntries(guildId, interaction.user.id);

      let publishMessage = 'All of your schedule entries were cleared.';
      if (schedule.threadId) {
        const result = await publishCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);
        publishMessage = `Your schedule post was updated in ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'its schedule thread'}.`;
      }

      await interaction.reply({
        content: publishMessage,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'publish') {
      await ensureCreatorSchedule(guildId, interaction.user.id, displayName);
      const result = await publishCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);

      await interaction.reply({
        content: [
          'Your schedule post was published or updated.',
          `Post/thread: ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'Unavailable'}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const result = await refreshCreatorSchedule(client, interaction.guild, interaction.user.id, displayName);

    await interaction.reply({
      content: [
        'Your schedule post was refreshed.',
        `Post/thread: ${result.schedule.threadId ? `<#${result.schedule.threadId}>` : 'Unavailable'}`
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }
};