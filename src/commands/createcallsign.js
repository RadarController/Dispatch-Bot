const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { resolveIcaoRoot } = require('../callsignRegistry');
const { recordCreatedCallsign } = require('../callsignHistory');

const PRESERVE_ORIGINAL_NUMERIC_PROBABILITY = 0.05;
const DESTINATION_SUFFIX_MATCH_PROBABILITY = 0.18;
const MAX_GENERATION_ATTEMPTS = 250;
const LETTER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN_WEIGHTED_RANDOM = 'weighted_random';
const DISALLOWED_NUMERIC_SUFFIXES = new Set([
  '1000',
  '1200',
  '2000',
  '2200',
  '7500',
  '7600',
  '7700'
]);

const CALLSIGN_PATTERNS = [
  {
    key: 'one_digit',
    digits: 1,
    letters: 0,
    weight: 4,
    choiceName: '1 digit, e.g. 7'
  },
  {
    key: 'one_digit_one_letter',
    digits: 1,
    letters: 1,
    weight: 4,
    choiceName: '1 digit + 1 letter, e.g. 7A'
  },
  {
    key: 'one_digit_two_letters',
    digits: 1,
    letters: 2,
    weight: 3,
    choiceName: '1 digit + 2 letters, e.g. 7AB'
  },
  {
    key: 'two_digits',
    digits: 2,
    letters: 0,
    weight: 10,
    choiceName: '2 digits, e.g. 45'
  },
  {
    key: 'two_digits_one_letter',
    digits: 2,
    letters: 1,
    weight: 8,
    choiceName: '2 digits + 1 letter, e.g. 45A'
  },
  {
    key: 'two_digits_two_letters',
    digits: 2,
    letters: 2,
    weight: 18,
    choiceName: '2 digits + 2 letters, e.g. 45BC'
  },
  {
    key: 'three_digits',
    digits: 3,
    letters: 0,
    weight: 12,
    choiceName: '3 digits, e.g. 123'
  },
  {
    key: 'three_digits_one_letter',
    digits: 3,
    letters: 1,
    weight: 22,
    choiceName: '3 digits + 1 letter, e.g. 123A'
  },
  {
    key: 'four_digits',
    digits: 4,
    letters: 0,
    weight: 16,
    choiceName: '4 digits, e.g. 1234'
  }
];

const CALLSIGN_PATTERN_BY_KEY = new Map(
  CALLSIGN_PATTERNS.map((pattern) => [pattern.key, pattern])
);

function parseFlightNumber(value) {
  const compactValue = `${value || ''}`.trim().toUpperCase().replace(/[\s-]+/g, '');
  const match = /^([A-Z0-9]{2})([0-9]{1,4}[A-Z]?)$/.exec(compactValue);

  if (!match) {
    return null;
  }

  const numericSuffixMatch = /^(\d{1,4})/.exec(match[2]);

  return {
    input: compactValue,
    iataDesignator: match[1],
    flightDesignator: match[2],
    originalNumericSuffix: numericSuffixMatch ? numericSuffixMatch[1] : ''
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

function randomInt(minimum, maximum) {
  return Math.floor(Math.random() * ((maximum - minimum) + 1)) + minimum;
}

function pickWeightedPattern() {
  const totalWeight = CALLSIGN_PATTERNS.reduce((sum, pattern) => sum + pattern.weight, 0);
  let selection = Math.random() * totalWeight;

  for (const pattern of CALLSIGN_PATTERNS) {
    selection -= pattern.weight;
    if (selection < 0) {
      return pattern;
    }
  }

  return CALLSIGN_PATTERNS[CALLSIGN_PATTERNS.length - 1];
}

function getSelectedPattern(patternKey) {
  if (!patternKey || patternKey === PATTERN_WEIGHTED_RANDOM) {
    return null;
  }

  return CALLSIGN_PATTERN_BY_KEY.get(patternKey) || null;
}

function generateDigitBlock(length) {
  let value = `${randomInt(1, 9)}`;

  while (value.length < length) {
    value += `${randomInt(0, 9)}`;
  }

  return value;
}

function generateLetterBlock(length) {
  let value = '';

  while (value.length < length) {
    value += LETTER_ALPHABET[randomInt(0, LETTER_ALPHABET.length - 1)];
  }

  return value;
}

function isAllowedNumericOnlySuffix(digits) {
  if (!/^[1-9][0-9]{0,3}$/.test(digits)) {
    return false;
  }

  if (digits.endsWith('00')) {
    return false;
  }

  if (DISALLOWED_NUMERIC_SUFFIXES.has(digits)) {
    return false;
  }

  return true;
}

function getSafeNumericFallback(length, originalNumericSuffix) {
  const fallbackByLength = {
    1: ['2', '3', '4'],
    2: ['21', '32', '43'],
    3: ['321', '432', '543'],
    4: ['4321', '5432', '6543']
  };

  const candidates = fallbackByLength[length] || fallbackByLength[3];
  return candidates.find((candidate) => candidate !== originalNumericSuffix) || candidates[0];
}

function buildFallbackSuffix(pattern, originalNumericSuffix) {
  const digits = pattern.letters === 0
    ? getSafeNumericFallback(pattern.digits, originalNumericSuffix)
    : generateDigitBlock(pattern.digits);

  return `${digits}${generateLetterBlock(pattern.letters)}`;
}

function formatPatternDescription(pattern) {
  const numberLabel = pattern.digits === 1 ? 'number' : 'numbers';
  const letterLabel = pattern.letters === 1 ? 'letter' : 'letters';
  return `${pattern.digits} ${numberLabel}, ${pattern.letters} ${letterLabel}`;
}

function generateCallsignSuffix(originalNumericSuffix, destination, patternKey) {
  const selectedPattern = getSelectedPattern(patternKey);
  const destinationLetterPair = destination ? destination.slice(-2) : '';

  if (
    !selectedPattern &&
    originalNumericSuffix &&
    Math.random() < PRESERVE_ORIGINAL_NUMERIC_PROBABILITY &&
    isAllowedNumericOnlySuffix(originalNumericSuffix)
  ) {
    return {
      suffix: originalNumericSuffix,
      wasPreserved: true,
      usedDestinationLetters: false,
      patternDescription: `${originalNumericSuffix.length} ${originalNumericSuffix.length === 1 ? 'number' : 'numbers'}, 0 letters`,
      patternSelection: 'Weighted random'
    };
  }

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const pattern = selectedPattern || pickWeightedPattern();
    const digits = generateDigitBlock(pattern.digits);
    let letters = '';
    let usedDestinationLetters = false;

    if (pattern.letters === 1) {
      letters = generateLetterBlock(1);
    } else if (pattern.letters === 2) {
      if (destinationLetterPair && Math.random() < DESTINATION_SUFFIX_MATCH_PROBABILITY) {
        letters = destinationLetterPair;
        usedDestinationLetters = true;
      } else {
        letters = generateLetterBlock(2);
      }
    }

    if (pattern.letters === 0 && !isAllowedNumericOnlySuffix(digits)) {
      continue;
    }

    if (pattern.letters === 0 && digits === originalNumericSuffix) {
      continue;
    }

    return {
      suffix: `${digits}${letters}`,
      wasPreserved: false,
      usedDestinationLetters,
      patternDescription: formatPatternDescription(pattern),
      patternSelection: selectedPattern ? selectedPattern.choiceName : 'Weighted random'
    };
  }

  return {
    suffix: selectedPattern ? buildFallbackSuffix(selectedPattern, originalNumericSuffix) : '123A',
    wasPreserved: false,
    usedDestinationLetters: false,
    patternDescription: selectedPattern ? formatPatternDescription(selectedPattern) : '3 numbers, 1 letter',
    patternSelection: selectedPattern ? selectedPattern.choiceName : 'Weighted random'
  };
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
    )
    .addStringOption((option) => {
      option
        .setName('pattern')
        .setDescription('Optional callsign suffix pattern to generate')
        .setRequired(false)
        .addChoices(
          { name: 'Weighted random', value: PATTERN_WEIGHTED_RANDOM },
          ...CALLSIGN_PATTERNS.map((pattern) => ({
            name: pattern.choiceName,
            value: pattern.key
          }))
        );

      return option;
    }),

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
    const patternKey = interaction.options.getString('pattern') || PATTERN_WEIGHTED_RANDOM;

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

    const generatedSuffix = generateCallsignSuffix(
      parsedFlightNumber.originalNumericSuffix,
      normalisedDestination,
      patternKey
    );
    const generatedCallsign = `${icaoRoot}${generatedSuffix.suffix}`;
    const routeSummary = buildRouteSummary(normalisedDeparture, normalisedDestination);

    try {
      await recordCreatedCallsign({
        guildId,
        createdByUserId: interaction.user.id,
        inputFlightNumber: parsedFlightNumber.input,
        iataDesignator: parsedFlightNumber.iataDesignator,
        icaoRoot,
        generatedCallsign,
        generatedSuffix: generatedSuffix.suffix,
        departure: normalisedDeparture,
        destination: normalisedDestination,
        wasPreserved: generatedSuffix.wasPreserved,
        usedDestinationLetters: generatedSuffix.usedDestinationLetters,
        patternDescription: generatedSuffix.patternDescription
      });
    } catch (error) {
      console.error('Failed to persist generated callsign:', error);
    }

    await interaction.reply({
      content: [
        '**Generated callsign**',
        `Flight number: \`${parsedFlightNumber.input}\``,
        `Callsign: \`${generatedCallsign}\``,
        `Mapping: \`${parsedFlightNumber.iataDesignator}\` → \`${icaoRoot}\``,
        `Pattern: ${generatedSuffix.patternDescription}`,
        `Pattern selection: ${generatedSuffix.patternSelection}`,
        `Generation: ${generatedSuffix.wasPreserved ? 'Preserved original numeric suffix' : 'Generated variant'}`,
        ...(generatedSuffix.usedDestinationLetters && normalisedDestination
          ? [`Destination suffix bias: matched \`${normalisedDestination.slice(-2)}\` from \`${normalisedDestination}\``]
          : []),
        ...(routeSummary ? [`Route: ${routeSummary}`] : [])
      ].join('\n')
    });
  }
};
