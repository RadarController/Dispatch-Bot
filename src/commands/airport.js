const { SlashCommandBuilder } = require('discord.js');
const {
  buildAirportLinkComponents,
  buildAirportOverviewEmbed,
  buildAtcEmbed,
  buildChartsEmbed,
  buildMetarEmbed,
  buildAtisEmbed,
  fetchAirportSnapshot,
  normaliseIcaoInput
} = require('../airportService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('airport')
    .setDescription('Show combined airport information, including METAR, ATIS, ATC, charts, and radar links.')
    .addStringOption((option) =>
      option
        .setName('icao')
        .setDescription('Four-letter ICAO code, for example EGCC')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('section')
        .setDescription('Optional focused section view')
        .setRequired(false)
        .addChoices(
          { name: 'Overview', value: 'overview' },
          { name: 'METAR', value: 'metar' },
          { name: 'ATIS', value: 'atis' },
          { name: 'ATC', value: 'atc' },
          { name: 'Charts', value: 'charts' }
        )
    ),

  async execute(interaction) {
    const icao = normaliseIcaoInput(interaction.options.getString('icao', true));
    const section = interaction.options.getString('section') || 'overview';

    if (!icao) {
      await interaction.reply('Please provide a valid four-letter ICAO code.');
      return;
    }

    await interaction.deferReply();

    const snapshot = await fetchAirportSnapshot(icao);

    let embed;
    switch (section) {
      case 'metar':
        embed = buildMetarEmbed(icao, snapshot.metar);
        break;
      case 'atis':
        embed = buildAtisEmbed(icao, snapshot.atis);
        break;
      case 'atc':
        embed = buildAtcEmbed(icao, snapshot.atc);
        break;
      case 'charts':
        embed = buildChartsEmbed(snapshot);
        break;
      default:
        embed = buildAirportOverviewEmbed(snapshot);
        break;
    }

    await interaction.editReply({
      embeds: [embed],
      components: buildAirportLinkComponents(icao)
    });
  }
};