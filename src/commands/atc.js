const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
    fetchVatsimData,
    getAirportControllerMatchResult,
    getRelatedEnrouteControllers
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

function trimFieldValue(value) {
    return truncateText(value, FIELD_LIMIT);
}

function buildAtcEmbed(icao, airport, controllers, relatedEnrouteControllers, usedAipMatch) {
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
        name: 'Local positions online',
        value: trimFieldValue(buildControllerBlock(controllers)),
        inline: false
    });

    if (relatedEnrouteControllers.length > 0) {
        embed.addFields({
            name: 'Possible area coverage',
            value: trimFieldValue(buildControllerBlock(relatedEnrouteControllers)),
            inline: false
        });
    }

    const footerParts = [`${controllers.length} local position${controllers.length === 1 ? '' : 's'} online`];
    if (relatedEnrouteControllers.length > 0) {
        footerParts.push(`${relatedEnrouteControllers.length} area position${relatedEnrouteControllers.length === 1 ? '' : 's'} matched`);
    }
    footerParts.push(usedAipMatch ? 'Matched against VATSIM AIP stations' : 'Fallback airport-prefix match');

    return embed.setFooter({ text: footerParts.join(' • ') });
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
            const controllers = controllerResult.controllers;
            const relatedEnrouteControllers = airport
                ? getRelatedEnrouteControllers(data, icao, airport, controllers)
                : [];

            if (controllers.length === 0 && relatedEnrouteControllers.length === 0) {
                const sourceDetail = airport
                    ? 'The airport was found in the VATSIM AIP, but no matching local or area positions are online right now.'
                    : 'No airport-specific VATSIM ATC is currently online for this airport.';
                await interaction.editReply(`${sourceDetail} (${icao})`);
                return;
            }

            await interaction.editReply({
                embeds: [buildAtcEmbed(
                    icao,
                    airport,
                    controllers,
                    relatedEnrouteControllers,
                    controllerResult.matchSource === 'aip'
                )]
            });
        } catch (error) {
            const status = error.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`VATSIM ATC lookup unavailable right now for ${icao}${detail}.`);
        }
    }
};
