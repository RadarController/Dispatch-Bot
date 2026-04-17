const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { resolveIcaoRoot } = require('../callsignRegistry');

const PRESERVE_ORIGINAL_NUMERIC_PROBABILITY = 0.05;
const DESTINATION_SUFFIX_MATCH_PROBABILITY = 0.18;
const MAX_GENERATION_ATTEMPTS = 250;
const LETTER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
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
    { digits: 1, letters: 0, weight: 6 },
    { digits: 1, letters: 1, weight: 6 },
    { digits: 1, letters: 2, weight: 4 },
    { digits: 2, letters: 0, weight: 16 },
    { digits: 2, letters: 1, weight: 12 },
    { digits: 2, letters: 2, weight: 8 },
    { digits: 3, letters: 0, weight: 18 },
    { digits: 3, letters: 1, weight: 10 },
    { digits: 4, letters: 0, weight: 8 }
];

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

function formatPatternDescription(pattern) {
    const numberLabel = pattern.digits === 1 ? 'number' : 'numbers';
    const letterLabel = pattern.letters === 1 ? 'letter' : 'letters';
    return `${pattern.digits} ${numberLabel}, ${pattern.letters} ${letterLabel}`;
}

function generateCallsignSuffix(originalNumericSuffix, destination) {
    const destinationLetterPair = destination ? destination.slice(-2) : '';

    if (
        originalNumericSuffix &&
        Math.random() < PRESERVE_ORIGINAL_NUMERIC_PROBABILITY &&
        isAllowedNumericOnlySuffix(originalNumericSuffix)
    ) {
        return {
            suffix: originalNumericSuffix,
            wasPreserved: true,
            usedDestinationLetters: false,
            patternDescription: `${originalNumericSuffix.length} ${originalNumericSuffix.length === 1 ? 'number' : 'numbers'}, 0 letters`
        };
    }

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
        const pattern = pickWeightedPattern();
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
            patternDescription: formatPatternDescription(pattern)
        };
    }

    return {
        suffix: '21A',
        wasPreserved: false,
        usedDestinationLetters: false,
        patternDescription: '2 numbers, 1 letter'
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

        const generatedSuffix = generateCallsignSuffix(
            parsedFlightNumber.originalNumericSuffix,
            normalisedDestination
        );
        const generatedCallsign = `${icaoRoot}${generatedSuffix.suffix}`;
        const routeSummary = buildRouteSummary(normalisedDeparture, normalisedDestination);

        await interaction.reply({
            content: [
                '**Generated callsign**',
                `Flight number: \`${parsedFlightNumber.input}\``,
                `Callsign: \`${generatedCallsign}\``,
                `Mapping: \`${parsedFlightNumber.iataDesignator}\` → \`${icaoRoot}\``,
                `Pattern: ${generatedSuffix.patternDescription}`,
                `Generation: ${generatedSuffix.wasPreserved ? 'Preserved original numeric suffix' : 'Generated variant'}`,
                ...(generatedSuffix.usedDestinationLetters && normalisedDestination
                    ? [`Destination suffix bias: matched \`${normalisedDestination.slice(-2)}\` from \`${normalisedDestination}\``]
                    : []),
                ...(routeSummary ? [`Route: ${routeSummary}`] : [])
            ].join('\n')
        });
    }
};