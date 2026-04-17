const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  listCallsignMappings,
  normaliseIataDesignator,
  normaliseIcaoRoot,
  removeCallsignMapping,
  setCallsignMapping
} = require('../callsignRegistry');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callsignconfig')
    .setDescription('Configure IATA to ICAO callsign mappings for this server.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
  }
};
