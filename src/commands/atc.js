const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('atc')
    .setDescription('Deprecated. Use /airport instead.')
    .addStringOption((option) =>
      option
        .setName('icao')
        .setDescription('Four-letter ICAO code, for example EGCC')
        .setRequired(true)
    ),

  async execute(interaction) {
    const icao = interaction.options.getString('icao', true).trim().toUpperCase();

    if (!/^[A-Z]{4}$/.test(icao)) {
      await interaction.reply({
        content: 'Please provide a valid four-letter ICAO code.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('Command deprecated')
      .setDescription([
        '`/atc` has been deprecated.',
        '',
        `Use \`/airport icao:${icao}\` for the combined airport panel, or \`/airport icao:${icao} section:atc\` for an ATC-only panel.`
      ].join('\n'));

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};