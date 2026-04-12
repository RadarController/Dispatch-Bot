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

function formatControllerLine(controller) {
    const infoLine = Array.isArray(controller.text_atis) && controller.text_atis.length > 0
        ? ` — ${truncateText(controller.text_atis[0], 100)}`
        : '';

    return `• **${controller.callsign}** — ${controller.frequency}${infoLine}`;
}

function buildControllerBlock(controllers) {
    if (!Array.isArray(controllers) || controllers.length === 0) {
        return 'None';
    }

    return controllers.map((controller) => formatControllerLine(controller)).join('\n');
}

function formatTopDownControllers(controllers) {
    return controllers.map((controller) => `**${controller.callsign}** (${controller.frequency})`).join(', ');
}

function buildTopDownBlock(topDownCoverage) {
    if (!topDownCoverage || !Array.isArray(topDownCoverage.entries) || topDownCoverage.entries.length === 0) {
        return 'None';
    }

    return topDownCoverage.entries.map((entry) => {
        if (entry.status === 'online') {
            return `• **${entry.label}** — ${formatTopDownControllers(entry.controllers)}`;
        }

        if (entry.status === 'covered') {
            return `• **${entry.label}** — covered top-down by ${formatTopDownControllers(entry.controllers)}`;
        }

        return `• **${entry.label}** — Unstaffed`;
    }).join('\n');
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

    if (controllerResult.matchSource === 'aip' && topDownCoverage) {
        embed.addFields(
            {
                name: 'Top-down coverage',
                value: trimFieldValue(buildTopDownBlock(topDownCoverage)),
                inline: false
            },
            {
                name: 'AIP positions online',
                value: trimFieldValue(buildControllerBlock(controllerResult.controllers)),
                inline: false
            }
        );

        return embed.setFooter({
            text: `${controllerResult.controllers.length} AIP position${controllerResult.controllers.length === 1 ? '' : 's'} online • Top-down view`
        });
    }

    embed.addFields({
        name: 'Local positions online',
        value: trimFieldValue(buildControllerBlock(controllerResult.controllers)),
        inline: false
    });

    return embed.setFooter({
        text: `${controllerResult.controllers.length} position${controllerResult.controllers.length === 1 ? '' : 's'} online • Fallback airport-prefix match`
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
            const topDownCoverage = controllerResult.matchSource === 'aip'
                ? getAirportTopDownCoverage(airport, controllerResult.controllers)
                : null;

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
