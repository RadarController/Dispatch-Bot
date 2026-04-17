const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { resolveIcaoRoot } = require('../callsignRegistry');

function parseFlightNumber(value) {
  const compactValue = `${value || ''}`.trim().toUpperCase().replace(/[\s-]+/g, '');
  const match = /^([A-Z0-9]{2})([0-9]{1,4}[A-Z]?)$/.exec(compactValue);

  if (!match) {
    return null;
  }

  return {
    input: compactValue,
    iataDesignator: match[1],
    flightDesignator: match[2]
  };
}

function normaliseAirportCode(value) {
  if (!value) {
    return '';
  }

  const normalised = `${value}`.trim().toUpperCase();
  return /^[A-Z0-9]{3,4}$/.test(normalised) ? normalised : '';
}

function buildRouteSummary(departure, destination) {
  if (departure && destination) {
    return `${departure} → ${destination}`;
  }

  if (departure) {
    return `Departure ${departure}`;
  }

  if (destination) {
    return `Destination ${destination}`;
  }

  return '';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcallsign')
    .setDescription('Generate an ICAO callsign from an IATA flight number.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('flight_number')
        .setDescription('IATA flight number, for example BA123 or U21234')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('departure')
        .setDescription('Optional departure airport, for example EGLL or LHR')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('destination')
        .setDescription('Optional destination airport, for example KJFK or JFK')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const parsedFlightNumber = parseFlightNumber(interaction.options.getString('flight_number', true));

    if (!parsedFlightNumber) {
      await interaction.reply({
        content: 'Please provide a valid IATA flight number, for example BA123, BA0123 or U21234.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const departure = interaction.options.getString('departure');
    const destination = interaction.options.getString('destination');

    const normalisedDeparture = normaliseAirportCode(departure);
    const normalisedDestination = normaliseAirportCode(destination);

    if (departure && !normalisedDeparture) {
      await interaction.reply({
        content: 'Please provide a valid departure airport code, for example EGLL or LHR.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (destination && !normalisedDestination) {
      await interaction.reply({
        content: 'Please provide a valid destination airport code, for example KJFK or JFK.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const icaoRoot = await resolveIcaoRoot(guildId, parsedFlightNumber.iataDesignator);
    if (!icaoRoot) {
      await interaction.reply({
        content: [
          `No ICAO root is configured for \`${parsedFlightNumber.iataDesignator}\` in this server.`,
          `A server admin can add one with \`/callsignconfig set-mapping iata:${parsedFlightNumber.iataDesignator} icao_root:XXX\`.`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const generatedCallsign = `${icaoRoot}${parsedFlightNumber.flightDesignator}`;
    const routeSummary = buildRouteSummary(normalisedDeparture, normalisedDestination);

    await interaction.reply({
      content: [
        '**Generated callsign**',
        `Flight number: \`${parsedFlightNumber.input}\``,
        `Callsign: \`${generatedCallsign}\``,
        `Mapping: \`${parsedFlightNumber.iataDesignator}\` → \`${icaoRoot}\``,
        ...(routeSummary ? [`Route: ${routeSummary}`] : [])
      ].join('\n')
    });
  }
};
