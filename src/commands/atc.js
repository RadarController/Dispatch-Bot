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

function formatTopDownControllers(controllers) {
    return controllers.map((controller) => `${controller.callsign} (${controller.frequency})`).join(', ');
}

function getLayerStyle(entry) {
    switch (entry.key) {
        case 'center':
            return { icon: '🟨', accent: '◉' };
        case 'approach':
            return { icon: '🟩', accent: '◉' };
        case 'directorFinal':
            return { icon: '🟦', accent: '✦' };
        case 'tower':
            return { icon: '🟥', accent: '▲' };
        case 'ground':
            return { icon: '🟩', accent: '▣' };
        case 'delivery':
            return { icon: '🟪', accent: '✎' };
        default:
            return { icon: '⬜', accent: '•' };
    }
}

function getControllerDisplayLine(controller) {
    return `\`${controller.callsign}\` (\`${controller.frequency}\`)`;
}

function getControllerInfoLine(controller) {
    const info = Array.isArray(controller?.text_atis) ? controller.text_atis[0] : '';
    return truncateText(String(info || '').trim(), 68);
}

function buildEntryLines(entry) {
    const style = getLayerStyle(entry);
    const lines = [`${style.icon} **${entry.label.toUpperCase()}**`];

    if (entry.status === 'online') {
        const [primaryController] = entry.controllers;
        if (primaryController) {
            lines.push(`   ${style.accent} ${getControllerDisplayLine(primaryController)}`);
            const infoLine = getControllerInfoLine(primaryController);
            if (infoLine) {
                lines.push(`   ${infoLine}`);
            }

            if (entry.controllers.length > 1) {
                const additional = entry.controllers.slice(1).map((controller) => `${controller.callsign} (${controller.frequency})`);
                lines.push(`   + ${truncateText(additional.join(', '), 70)}`);
            }
        }
    } else if (entry.status === 'covered') {
        lines.push(`   ↳ covered top-down by ${truncateText(formatTopDownControllers(entry.controllers), 62)}`);
    } else {
        lines.push('   — Unstaffed');
    }

    return lines;
}

function buildGraphicalTopDownBlock(topDownCoverage) {
    if (!topDownCoverage || !Array.isArray(topDownCoverage.entries) || topDownCoverage.entries.length === 0) {
        return 'None';
    }

    const lines = [];

    topDownCoverage.entries.forEach((entry, index) => {
        lines.push(...buildEntryLines(entry));

        if (index < topDownCoverage.entries.length - 1) {
            lines.push('   │');
        }
    });

    lines.push('');
    lines.push('`Top-down coverage`');

    return lines.join('\n');
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
