const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  addConfiguredRoleId,
  clearRolePanelConfig,
  ensureRolePanel,
  formatRoleMentions,
  getConfiguredRoleIds,
  getConfiguredRoles,
  getRolePanelChannelId,
  getRolePanelConfig,
  removeConfiguredRoleId,
  setRolePanelChannelId
} = require('../rolesPanel');

async function getGuildMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

async function getBotMember(interaction) {
  return interaction.guild.members.fetchMe();
}

function buildRoleConfigStatus(config, guild) {
  const roleMentions = formatRoleMentions(config.roleIds || [], guild);

  return [
    '**Role panel configuration**',
    `Panel channel: ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}`,
    `Self-assignable roles: ${roleMentions.length > 0 ? roleMentions.join(', ') : 'None configured'}`
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('View and manage self-assignable roles.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List all self-assignable roles.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add one of the approved self-assignable roles to yourself.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to add')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove one of the approved self-assignable roles from yourself.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to remove')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('toggle')
        .setDescription('Toggle one of the approved self-assignable roles on yourself.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to toggle')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('panel')
        .setDescription('Create or refresh the managed role panel in the configured channel.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config-status')
        .setDescription('Show the current role panel configuration for this server.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config-set-channel')
        .setDescription('Set the channel used for the managed role panel in this server.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Role panel channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config-add-role')
        .setDescription('Add a self-assignable role for this server.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to make self-assignable')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config-remove-role')
        .setDescription('Remove a self-assignable role for this server.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to remove from the self-assignable list')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config-clear')
        .setDescription('Clear the role panel channel and self-assignable roles for this server.')
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand.startsWith('config-')) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({
          content: 'You need the Manage Roles permission to change the role panel configuration.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'config-status') {
        const config = await getRolePanelConfig(guildId);
        await interaction.reply({
          content: buildRoleConfigStatus(config, interaction.guild),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'config-set-channel') {
        const channel = interaction.options.getChannel('channel', true);
        const config = await setRolePanelChannelId(guildId, channel.id);

        await ensureRolePanel(interaction.client, guildId).catch(() => null);

        await interaction.reply({
          content: [
            `Role panel channel set to <#${config.channelId}>.`,
            buildRoleConfigStatus(config, interaction.guild)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'config-add-role') {
        const role = interaction.options.getRole('role', true);
        const config = await addConfiguredRoleId(guildId, role.id);

        await ensureRolePanel(interaction.client, guildId).catch(() => null);

        await interaction.reply({
          content: [
            `Added ${role} to the self-assignable role list.`,
            buildRoleConfigStatus(config, interaction.guild)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (subcommand === 'config-remove-role') {
        const role = interaction.options.getRole('role', true);
        const config = await removeConfiguredRoleId(guildId, role.id);

        await ensureRolePanel(interaction.client, guildId).catch(() => null);

        await interaction.reply({
          content: [
            `Removed ${role} from the self-assignable role list.`,
            buildRoleConfigStatus(config, interaction.guild)
          ].join('\n\n'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const config = await clearRolePanelConfig(guildId);
      await interaction.reply({
        content: [
          'Cleared the role panel configuration for this server.',
          buildRoleConfigStatus(config, interaction.guild)
        ].join('\n\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const configuredRoleIds = await getConfiguredRoleIds(guildId);

    if (configuredRoleIds.length === 0) {
      await interaction.reply({
        content: 'No self-assignable roles are configured yet. Use `/roles config-add-role` first.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({
          content: 'You need the Manage Roles permission to refresh the role panel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const channelId = await getRolePanelChannelId(guildId);
      if (!channelId) {
        await interaction.reply({
          content: 'No role panel channel is configured yet. Use `/roles config-set-channel` first.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const message = await ensureRolePanel(interaction.client, guildId);
      if (!message) {
        await interaction.reply({
          content: 'I could not create or refresh the role panel. Check the configured channel, roles, and bot permissions.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: `Role panel refreshed in <#${message.channelId}>.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const configuredRoles = await getConfiguredRoles(interaction.guild);

    if (subcommand === 'list') {
      const roleMentions = formatRoleMentions(configuredRoles.map((role) => role.id), interaction.guild);

      await interaction.reply({
        content: roleMentions.length > 0
          ? `Available self-assignable roles:\n${roleMentions.join('\n')}`
          : 'No configured self-assignable roles are currently available in this server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const role = interaction.options.getRole('role', true);

    if (!configuredRoleIds.includes(role.id)) {
      await interaction.reply({
        content: `${role} is not in the self-assignable role list.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (role.managed || role.id === interaction.guild.id) {
      await interaction.reply({
        content: `${role} cannot be self-assigned.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const member = await getGuildMember(interaction);
    const botMember = await getBotMember(interaction);

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: 'Dispatch Bot is missing the Manage Roles permission.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content: `I cannot manage ${role} because it is at or above my highest role. Move the bot role higher in Server Settings > Roles.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const hasRole = member.roles.cache.has(role.id);

    if (subcommand === 'add') {
      if (hasRole) {
        await interaction.reply({
          content: `You already have ${role}.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await member.roles.add(role.id, 'Self-assigned via Dispatch Bot');
      await interaction.reply({
        content: `Added ${role}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'remove') {
      if (!hasRole) {
        await interaction.reply({
          content: `You do not currently have ${role}.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await member.roles.remove(role.id, 'Self-removed via Dispatch Bot');
      await interaction.reply({
        content: `Removed ${role}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (hasRole) {
      await member.roles.remove(role.id, 'Self-toggled via Dispatch Bot');
      await interaction.reply({
        content: `Removed ${role}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await member.roles.add(role.id, 'Self-toggled via Dispatch Bot');
    await interaction.reply({
      content: `Added ${role}.`,
      flags: MessageFlags.Ephemeral
    });
  }
};