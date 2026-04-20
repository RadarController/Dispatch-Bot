const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { DEFAULT_WELCOME_MESSAGES } = require('../welcomeMessages');
const {
  addWelcomeMessage,
  clearWelcomeMessages,
  getWelcomeConfig,
  listWelcomeMessages,
  removeWelcomeMessage,
  setWelcomeConfig
} = require('../welcomeRegistry');
const { buildWelcomePreview } = require('../welcomeService');

function formatChannelMention(channelId) {
  return channelId ? `<#${channelId}>` : 'Not configured';
}

function formatEnabled(value) {
  return value ? 'Enabled' : 'Disabled';
}

function buildChunks(title, lines, maxLength = 1800) {
  const chunks = [];
  let current = title;

  for (const line of lines) {
    if ((current + '\n' + line).length > maxLength) {
      chunks.push(current);
      current = `${title}\n${line}`;
      continue;
    }

    current += `\n${line}`;
  }

  chunks.push(current);
  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure aviation-themed welcome messages.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show the current welcome message configuration.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enable')
        .setDescription('Enable welcome messages for this server.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setDescription('Disable welcome messages for this server.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-channel')
        .setDescription('Set the channel used for welcome messages.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Welcome message channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-rules-channel')
        .setDescription('Set the rules or info channel referenced by welcome messages.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Rules or info channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear-rules-channel')
        .setDescription('Clear the configured rules or info channel.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-mentions')
        .setDescription('Choose whether welcome messages mention the new member.')
        .addBooleanOption((option) =>
          option
            .setName('enabled')
            .setDescription('Whether the new member should be mentioned')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a custom welcome message.')
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('Message template. Supports {user}, {server}, {rules}, {count}')
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a custom welcome message by number.')
        .addIntegerOption((option) =>
          option
            .setName('index')
            .setDescription('Custom message number from /welcome list')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List the active welcome messages.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear-custom')
        .setDescription('Clear all custom welcome messages and fall back to the built-in list.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('test')
        .setDescription('Preview a welcome message without posting it.')
        .addUserOption((option) =>
          option
            .setName('member')
            .setDescription('Member to preview the welcome message for')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
      const config = await getWelcomeConfig(guildId);
      const usingCustomMessages = config.messages.length > 0;
      const activeMessageCount = usingCustomMessages ? config.messages.length : DEFAULT_WELCOME_MESSAGES.length;

      await interaction.reply({
        content: [
          '**Welcome configuration**',
          `Status: ${formatEnabled(config.enabled)}`,
          `Welcome channel: ${formatChannelMention(config.channelId)}`,
          `Rules channel: ${formatChannelMention(config.rulesChannelId)}`,
          `Mentions: ${formatEnabled(config.useMentions)}`,
          `Message source: ${usingCustomMessages ? 'Custom messages' : 'Built-in defaults'}`,
          `Active message count: ${activeMessageCount}`,
          `Stored custom messages: ${config.messages.length}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'enable') {
      const config = await setWelcomeConfig(guildId, { enabled: true });

      await interaction.reply({
        content: [
          'Welcome messages enabled.',
          `Welcome channel: ${formatChannelMention(config.channelId)}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'disable') {
      await setWelcomeConfig(guildId, { enabled: false });

      await interaction.reply({
        content: 'Welcome messages disabled.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'set-channel') {
      const channel = interaction.options.getChannel('channel', true);
      const config = await setWelcomeConfig(guildId, { channelId: channel.id });

      await interaction.reply({
        content: `Welcome channel set to ${formatChannelMention(config.channelId)}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'set-rules-channel') {
      const channel = interaction.options.getChannel('channel', true);
      const config = await setWelcomeConfig(guildId, { rulesChannelId: channel.id });

      await interaction.reply({
        content: `Rules channel set to ${formatChannelMention(config.rulesChannelId)}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'clear-rules-channel') {
      await setWelcomeConfig(guildId, { rulesChannelId: '' });

      await interaction.reply({
        content: 'Rules channel cleared.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'set-mentions') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const config = await setWelcomeConfig(guildId, { useMentions: enabled });

      await interaction.reply({
        content: `Member mentions ${config.useMentions ? 'enabled' : 'disabled'} for welcome messages.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'add') {
      const message = interaction.options.getString('message', true);
      const config = await addWelcomeMessage(guildId, message);

      await interaction.reply({
        content: `Custom welcome message added. Total custom messages: ${config.messages.length}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'remove') {
      const customMessages = await listWelcomeMessages(guildId);

      if (customMessages.length === 0) {
        await interaction.reply({
          content: 'There are no custom welcome messages to remove. The bot is currently using the built-in list.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const index = interaction.options.getInteger('index', true);
      const result = await removeWelcomeMessage(guildId, index - 1);

      if (!result) {
        await interaction.reply({
          content: `Custom welcome message ${index} does not exist.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: `Removed custom welcome message ${index}: ${result.removed}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'list') {
      const customMessages = await listWelcomeMessages(guildId);
      const usingCustomMessages = customMessages.length > 0;
      const messages = usingCustomMessages ? customMessages : DEFAULT_WELCOME_MESSAGES;
      const title = usingCustomMessages
        ? '**Custom welcome messages**'
        : '**Built-in welcome messages**';

      const lines = messages.map((message, index) => `${index + 1}. ${message}`);
      const chunks = buildChunks(title, lines);

      for (let index = 0; index < chunks.length; index += 1) {
        if (index === 0) {
          await interaction.reply({
            content: chunks[index],
            flags: MessageFlags.Ephemeral
          });
        } else {
          await interaction.followUp({
            content: chunks[index],
            flags: MessageFlags.Ephemeral
          });
        }
      }

      return;
    }

    if (subcommand === 'clear-custom') {
      const customMessages = await listWelcomeMessages(guildId);
      await clearWelcomeMessages(guildId);

      await interaction.reply({
        content: customMessages.length > 0
          ? `Cleared ${customMessages.length} custom welcome message(s). The bot will now use the built-in aviation-themed list.`
          : 'No custom welcome messages were stored. The bot is already using the built-in aviation-themed list.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'test') {
      const targetUser = interaction.options.getUser('member') || interaction.user;

      let member;
      try {
        member = await interaction.guild.members.fetch(targetUser.id);
      } catch (error) {
        await interaction.reply({
          content: 'That user is not currently a member of this server.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const preview = await buildWelcomePreview(member);

      if (!preview) {
        await interaction.reply({
          content: 'No welcome message could be generated.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: [
          '**Welcome preview**',
          `Target channel: ${formatChannelMention(preview.config.channelId)}`,
          '',
          preview.content
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};