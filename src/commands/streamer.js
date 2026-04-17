const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getLiveConfig, listStreamers, removeStreamer, upsertStreamer } = require('../liveRegistry');

async function syncStreamerRole(guild, guildId, userId, shouldHaveRole) {
  const liveConfig = await getLiveConfig(guildId);

  if (!liveConfig.streamerRoleId) {
    return 'Streamer role is not configured yet.';
  }

  const role = guild.roles.cache.get(liveConfig.streamerRoleId);
  if (!role) {
    return 'The configured streamer role no longer exists.';
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return 'The Discord member could not be found in this server.';
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Dispatch Bot is missing the Manage Roles permission, so the streamer role was not changed.';
  }

  if (role.position >= botMember.roles.highest.position) {
    return `Dispatch Bot cannot manage ${role} because it is at or above the bot’s highest role.`;
  }

  if (shouldHaveRole) {
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role.id, 'Registered as a streamer via Dispatch Bot');
    }
    return `Added ${role}.`;
  }

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role.id, 'Removed from streamer registry via Dispatch Bot');
  }
  return `Removed ${role}.`;
}

function canManageTarget(interaction, targetUser) {
  return targetUser.id === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streamer')
    .setDescription('Register and manage streamers.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Register yourself or another server member as a streamer.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to register. Defaults to you.')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('display_name')
            .setDescription('Optional display name override')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove yourself or another server member from the streamer registry.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to remove. Defaults to you.')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List all registered streamers.')
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const streamers = await listStreamers(guildId);
      await interaction.reply({
        content: streamers.length > 0
          ? ['**Registered streamers**', ...streamers.map((streamer) => {
              const platformCount = Object.values(streamer.channels || {}).filter((channel) => channel?.url).length;
              return `- <@${streamer.discordUserId}> (${streamer.displayName || 'No display name set'}) — ${platformCount} linked channel(s)`;
            })].join('\n')
          : 'No streamers are registered yet.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    if (!canManageTarget(interaction, targetUser)) {
      await interaction.reply({
        content: 'You can only manage your own streamer record unless you have Manage Server permission.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'add') {
      const displayName = interaction.options.getString('display_name') ||
        interaction.guild.members.cache.get(targetUser.id)?.displayName ||
        targetUser.globalName ||
        targetUser.username;

      const streamer = await upsertStreamer(guildId, targetUser.id, { displayName });
      const roleMessage = await syncStreamerRole(interaction.guild, guildId, targetUser.id, true);

      await interaction.reply({
        content: [
          `Registered <@${streamer.discordUserId}> as a streamer.`,
          roleMessage
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const removed = await removeStreamer(guildId, targetUser.id);
    if (!removed) {
      await interaction.reply({
        content: `<@${targetUser.id}> is not currently registered as a streamer.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const roleMessage = await syncStreamerRole(interaction.guild, guildId, targetUser.id, false);
    await interaction.reply({
      content: [
        `Removed <@${targetUser.id}> from the streamer registry.`,
        roleMessage
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }
};