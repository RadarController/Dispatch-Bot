const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getStreamer, removeStreamerChannel, setStreamerChannel, upsertStreamer } = require('../liveRegistry');
const { normaliseChannelInput, PLATFORM_LABELS, PLATFORMS } = require('../liveProviders');

function canManageTarget(interaction, targetUser) {
  return targetUser.id === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function getTargetDisplayName(interaction, targetUser) {
  return interaction.guild.members.cache.get(targetUser.id)?.displayName || targetUser.globalName || targetUser.username;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Manage linked streaming channels.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add or update a linked channel for a registered streamer.')
        .addStringOption((option) =>
          option
            .setName('platform')
            .setDescription('Streaming platform')
            .setRequired(true)
            .addChoices(...PLATFORMS.map((platform) => ({ name: PLATFORM_LABELS[platform], value: platform })))
        )
        .addStringOption((option) =>
          option
            .setName('url')
            .setDescription('Channel URL')
            .setRequired(true)
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Streamer to update. Defaults to you.')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a linked channel from a streamer.')
        .addStringOption((option) =>
          option
            .setName('platform')
            .setDescription('Streaming platform')
            .setRequired(true)
            .addChoices(...PLATFORMS.map((platform) => ({ name: PLATFORM_LABELS[platform], value: platform })))
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Streamer to update. Defaults to you.')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List the linked channels for a streamer.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Streamer to view. Defaults to you.')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!canManageTarget(interaction, targetUser)) {
      await interaction.reply({
        content: 'You can only manage your own linked channels unless you have Manage Server permission.',
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'list') {
      const streamer = await getStreamer(guildId, targetUser.id);
      if (!streamer) {
        await interaction.reply({
          content: `<@${targetUser.id}> is not registered as a streamer yet.`,
          ephemeral: true
        });
        return;
      }

      const lines = ['**Linked channels**'];
      for (const platform of PLATFORMS) {
        const channel = streamer.channels?.[platform];
        lines.push(`- ${PLATFORM_LABELS[platform]}: ${channel?.url || 'Not linked'}`);
      }

      await interaction.reply({
        content: lines.join('\n'),
        ephemeral: true
      });
      return;
    }

    const platform = interaction.options.getString('platform', true);

    if (subcommand === 'remove') {
      const streamer = await getStreamer(guildId, targetUser.id);
      if (!streamer) {
        await interaction.reply({
          content: `<@${targetUser.id}> is not registered as a streamer yet.`,
          ephemeral: true
        });
        return;
      }

      const existingChannel = streamer.channels?.[platform];
      if (!existingChannel?.url) {
        await interaction.reply({
          content: `${PLATFORM_LABELS[platform]} is not currently linked for <@${targetUser.id}>.`,
          ephemeral: true
        });
        return;
      }

      await removeStreamerChannel(guildId, targetUser.id, platform);
      await interaction.reply({
        content: `Removed the ${PLATFORM_LABELS[platform]} channel for <@${targetUser.id}>.`,
        ephemeral: true
      });
      return;
    }

    const rawUrl = interaction.options.getString('url', true);

    let normalisedChannel;
    try {
      normalisedChannel = normaliseChannelInput(platform, rawUrl);
    } catch (error) {
      await interaction.reply({
        content: error.message || 'That channel URL is not valid.',
        ephemeral: true
      });
      return;
    }

    if (!await getStreamer(guildId, targetUser.id)) {
      await upsertStreamer(guildId, targetUser.id, { displayName: getTargetDisplayName(interaction, targetUser) });
    }

    await setStreamerChannel(guildId, targetUser.id, platform, normalisedChannel);

    await interaction.reply({
      content: `Saved the ${PLATFORM_LABELS[platform]} channel for <@${targetUser.id}>: ${normalisedChannel.url}`,
      ephemeral: true
    });
  }
};
