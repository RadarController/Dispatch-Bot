const { MessageFlags, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that Dispatch Bot is online.'),

  async execute(interaction) {
    await interaction.reply({
      content: 'Dispatch Bot is online and responding.',
      flags: MessageFlags.Ephemeral
    });
  }
};