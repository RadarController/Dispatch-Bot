const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getLiveConfig, setLiveConfig } = require('../liveRegistry');

function formatRoleMention(roleId) {
  return roleId ? `<@&${roleId}>` : 'Not configured';
}

function formatChannelMention(channelId) {
  return channelId ? `<#${channelId}>` : 'Not configured';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('liveconfig')
    .setDescription('Configure live announcement settings.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show the current live announcement configuration.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-streamer-role')
        .setDescription('Set the Discord role automatically assigned to registered streamers.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Streamer role')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-alert-role')
        .setDescription('Set the role to ping when someone goes live.')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Live alert role')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-channel')
        .setDescription('Set the channel used for live announcements.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Live announcement channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
      const liveConfig = getLiveConfig();
      await interaction.reply({
        content: [
          '**Live configuration**',
          `Streamer role: ${formatRoleMention(liveConfig.streamerRoleId)}`,
          `Alert role: ${formatRoleMention(liveConfig.livePingRoleId)}`,
          `Announcement channel: ${formatChannelMention(liveConfig.liveAnnouncementsChannelId)}`
        ].join('\n'),
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'set-streamer-role') {
      const role = interaction.options.getRole('role', true);
      const liveConfig = setLiveConfig({ streamerRoleId: role.id });
      await interaction.reply({
        content: `Streamer role set to ${formatRoleMention(liveConfig.streamerRoleId)}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'set-alert-role') {
      const role = interaction.options.getRole('role', true);
      const liveConfig = setLiveConfig({ livePingRoleId: role.id });
      await interaction.reply({
        content: `Live alert role set to ${formatRoleMention(liveConfig.livePingRoleId)}.`,
        ephemeral: true
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const liveConfig = setLiveConfig({ liveAnnouncementsChannelId: channel.id });
    await interaction.reply({
      content: `Live announcement channel set to ${formatChannelMention(liveConfig.liveAnnouncementsChannelId)}.`,
      ephemeral: true
    });
  }
};
