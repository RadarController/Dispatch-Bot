const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

function getConfiguredRoleIds() {
  return new Set(
    (process.env.SELF_ASSIGNABLE_ROLE_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function formatRoleList(roleIds, guild) {
  const items = [];

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (role) {
      items.push(`${role} (${role.name})`);
    }
  }

  return items;
}

async function getGuildMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

async function getBotMember(interaction) {
  return interaction.guild.members.fetchMe();
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
    ),

  async execute(interaction) {
    const configuredRoleIds = getConfiguredRoleIds();

    if (configuredRoleIds.size === 0) {
      await interaction.reply({
        content: 'No self-assignable roles are configured yet. Add SELF_ASSIGNABLE_ROLE_IDS in Railway first.',
        ephemeral: true
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const roleItems = formatRoleList(configuredRoleIds, interaction.guild);

      await interaction.reply({
        content: roleItems.length > 0
          ? `Available self-assignable roles:\n${roleItems.join('\n')}`
          : 'No configured self-assignable roles are currently available in this server.',
        ephemeral: true
      });
      return;
    }

    const role = interaction.options.getRole('role', true);

    if (!configuredRoleIds.has(role.id)) {
      await interaction.reply({
        content: `${role} is not in the self-assignable role list.`,
        ephemeral: true
      });
      return;
    }

    if (role.managed || role.id === interaction.guild.id) {
      await interaction.reply({
        content: `${role} cannot be self-assigned.`,
        ephemeral: true
      });
      return;
    }

    const member = await getGuildMember(interaction);
    const botMember = await getBotMember(interaction);

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: 'Dispatch Bot is missing the Manage Roles permission.',
        ephemeral: true
      });
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content: `I cannot manage ${role} because it is at or above my highest role. Move the bot role higher in Server Settings > Roles.`,
        ephemeral: true
      });
      return;
    }

    const hasRole = member.roles.cache.has(role.id);

    if (subcommand === 'add') {
      if (hasRole) {
        await interaction.reply({
          content: `You already have ${role}.`,
          ephemeral: true
        });
        return;
      }

      await member.roles.add(role.id, 'Self-assigned via Dispatch Bot');
      await interaction.reply({
        content: `Added ${role}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'remove') {
      if (!hasRole) {
        await interaction.reply({
          content: `You do not currently have ${role}.`,
          ephemeral: true
        });
        return;
      }

      await member.roles.remove(role.id, 'Self-removed via Dispatch Bot');
      await interaction.reply({
        content: `Removed ${role}.`,
        ephemeral: true
      });
      return;
    }

    if (hasRole) {
      await member.roles.remove(role.id, 'Self-toggled via Dispatch Bot');
      await interaction.reply({
        content: `Removed ${role}.`,
        ephemeral: true
      });
      return;
    }

    await member.roles.add(role.id, 'Self-toggled via Dispatch Bot');
    await interaction.reply({
      content: `Added ${role}.`,
      ephemeral: true
    });
  }
};
