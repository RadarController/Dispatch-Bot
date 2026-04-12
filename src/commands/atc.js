const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
    fetchVatsimData,
    getAirportControllerMatchResult,
    getAirportTopDownCoverage
} = require('../vatsimData');
const { fetchAirportFromAip } = require('../vatsimAip');

const ATC_EMBED_COLOUR = 0x1f6feb;
const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
const GRAPH_WIDTH = 38;

function truncateText(text, maxLength) {
    const stringValue = String(text || '');
    if (stringValue.length <= maxLength) {
        return stringValue;
    }

    return `${stringValue.slice(0, Math.max(0, maxLength - 1))}…`;
}

function trimFieldValue(value) {
    return truncateText(value, FIELD_LIMIT);
}

function centerText(text, width) {
    const value = String(text || '').trim();
    if (value.length >= width) {
        return value.slice(0, width);
    }

    const totalPadding = width - value.length;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return `${' '.repeat(leftPadding)}${value}${' '.repeat(rightPadding)}`;
}

function wrapText(text, width) {
    const value = String(text || '').trim();
    if (!value) {
        return [''];
    }

    const words = value.split(/\s+/);
    const lines = [];
    let current = '';

    for (const word of words) {
        if (word.length > width) {
            if (current) {
                lines.push(current);
                current = '';
            }

            for (let index = 0; index < word.length; index += width) {
                lines.push(word.slice(index, index + width));
            }
            continue;
        }

        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= width) {
            current = candidate;
            continue;
        }

        lines.push(current);
        current = word;
    }

    if (current) {
        lines.push(current);
    }

    return lines.length > 0 ? lines : [''];
}

function formatTopDownControllers(controllers) {
    return controllers.map((controller) => `${controller.callsign} (${controller.frequency})`).join(', ');
}

function getCoverageText(entry) {
    if (entry.status === 'online') {
        return `Online: ${formatTopDownControllers(entry.controllers)}`;
    }

    if (entry.status === 'covered') {
        return `Covered by: ${formatTopDownControllers(entry.controllers)}`;
    }

    return 'Unstaffed';
}

function buildGraphicalTopDownBlock(topDownCoverage) {
    if (!topDownCoverage || !Array.isArray(topDownCoverage.entries) || topDownCoverage.entries.length === 0) {
        return 'None';
    }

    const lines = [];
    const border = '─'.repeat(GRAPH_WIDTH);

    topDownCoverage.entries.forEach((entry, index) => {
        const topBorder = index === 0 ? `┌${border}┐` : `├${border}┤`;
        lines.push(topBorder);
        lines.push(`│${centerText(entry.label.toUpperCase(), GRAPH_WIDTH)}│`);

        for (const wrappedLine of wrapText(getCoverageText(entry), GRAPH_WIDTH)) {
            lines.push(`│${wrappedLine.padEnd(GRAPH_WIDTH, ' ')}│`);
        }
    });

    lines.push(`└${border}┘`);
    return `\`\`\`text\n${lines.join('\n')}\n\`\`\``;
}

function buildAtcEmbed(icao, airport, controllerResult, topDownCoverage) {
    const embed = new EmbedBuilder()
        .setColor(ATC_EMBED_COLOUR)
        .setTitle(`${icao} Online ATC`);

    if (airport?.name) {
        const summaryParts = [airport.name];
        if (airport.city) {
            summaryParts.push(airport.city);
        }
        if (airport.country) {
            summaryParts.push(airport.country);
        }

        embed.setDescription(truncateText(summaryParts.join(' • '), DESCRIPTION_LIMIT));
    }

    embed.addFields({
        name: 'Top-down coverage',
        value: trimFieldValue(buildGraphicalTopDownBlock(topDownCoverage)),
        inline: false
    });

    const footerDetail = controllerResult.matchSource === 'aip'
        ? 'Top-down view'
        : 'Fallback top-down view';

    return embed.setFooter({
        text: `${controllerResult.controllers.length} matched position${controllerResult.controllers.length === 1 ? '' : 's'} online • ${footerDetail}`
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('atc')
        .setDescription('List online VATSIM ATC for an airport ICAO code.')
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
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        try {
            const [data, airport] = await Promise.all([
                fetchVatsimData(),
                fetchAirportFromAip(icao)
            ]);

            const controllerResult = getAirportControllerMatchResult(data, icao, airport);
            const topDownCoverage = getAirportTopDownCoverage(airport, controllerResult.controllers, {
                matchSource: controllerResult.matchSource,
                icao
            });

            if (controllerResult.controllers.length === 0) {
                const sourceDetail = airport
                    ? 'The airport was found in the VATSIM AIP, but no matching charted positions are online right now.'
                    : 'No airport-specific VATSIM ATC is currently online for this airport.';
                await interaction.editReply(`${sourceDetail} (${icao})`);
                return;
            }

            await interaction.editReply({
                embeds: [buildAtcEmbed(icao, airport, controllerResult, topDownCoverage)]
            });
        } catch (error) {
            const status = error.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`VATSIM ATC lookup unavailable right now for ${icao}${detail}.`);
        }
    }
};
