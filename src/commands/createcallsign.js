const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  listCallsignMappings,
  normaliseIataDesignator,
  normaliseIcaoRoot,
  removeCallsignMapping,
  resolveIcaoRoot,
  setCallsignMapping
} = require('../callsignRegistry');

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

function canManageMappings(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcallsign')
    .setDescription('Generate an ICAO callsign from an IATA flight number.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('generate')
        .setDescription('Generate a callsign from an IATA flight number.')
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
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-mapping')
        .setDescription('Set an IATA to ICAO root mapping for this server.')
        .addStringOption((option) =>
          option
            .setName('iata')
            .setDescription('Two-character IATA airline designator, for example BA')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('icao_root')
            .setDescription('Three-letter ICAO callsign root, for example BAW')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove-mapping')
        .setDescription('Remove an IATA to ICAO root mapping from this server.')
        .addStringOption((option) =>
          option
            .setName('iata')
            .setDescription('Two-character IATA airline designator, for example BA')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list-mappings')
        .setDescription('List the configured IATA to ICAO root mappings for this server.')
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list-mappings') {
      const mappings = await listCallsignMappings(guildId);

      await interaction.reply({
        content: mappings.length > 0
          ? [
              '**Configured callsign mappings**',
              ...mappings.map((mapping) => `- \`${mapping.iataDesignator}\` → \`${mapping.icaoRoot}\``)
            ].join('\n')
          : 'No callsign mappings are configured for this server yet.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'set-mapping') {
      if (!canManageMappings(interaction)) {
        await interaction.reply({
          content: 'You need Manage Server permission to change callsign mappings.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const iataDesignator = normaliseIataDesignator(interaction.options.getString('iata', true));
      const icaoRoot = normaliseIcaoRoot(interaction.options.getString('icao_root', true));

      if (!iataDesignator) {
        await interaction.reply({
          content: 'Please provide a valid two-character IATA airline designator, for example BA.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!icaoRoot) {
        await interaction.reply({
          content: 'Please provide a valid three-letter ICAO root, for example BAW.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const mapping = await setCallsignMapping(guildId, iataDesignator, icaoRoot);
      await interaction.reply({
        content: `Saved mapping \`${mapping.iataDesignator}\` → \`${mapping.icaoRoot}\` for this server.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'remove-mapping') {
      if (!canManageMappings(interaction)) {
        await interaction.reply({
          content: 'You need Manage Server permission to change callsign mappings.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const iataDesignator = normaliseIataDesignator(interaction.options.getString('iata', true));
      if (!iataDesignator) {
        await interaction.reply({
          content: 'Please provide a valid two-character IATA airline designator, for example BA.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const removed = await removeCallsignMapping(guildId, iataDesignator);
      await interaction.reply({
        content: removed
          ? `Removed mapping \`${removed.iataDesignator}\` → \`${removed.icaoRoot}\`.`
          : `No mapping is currently configured for \`${iataDesignator}\`.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

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
          `Use \`/createcallsign set-mapping iata:${parsedFlightNumber.iataDesignator} icao_root:XXX\` first.`
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
