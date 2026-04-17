const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { fetchVatsimData, getAirportAtis } = require('../vatsimData');

const ATIS_EMBED_COLOUR = 0xf59e0b;
const MAX_DESCRIPTION_LENGTH = 3800;

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatAtisText(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return 'Text ATIS unavailable';
    }

    return lines.join('\n');
}

function buildAtisSection(label, station) {
    const headingBits = [label, station.frequency ? `${station.frequency}` : null, station.atis_code ? `Info ${station.atis_code}` : null]
        .filter(Boolean)
        .join(' • ');

    return `**${headingBits}**\n\`\`\`\n${formatAtisText(station.text_atis)}\n\`\`\``;
}

function buildAtisEmbed(icao, stations) {
    const sections = [];

    if (stations.arrival) {
        sections.push(buildAtisSection('Arrival', stations.arrival));
    }

    if (stations.departure) {
        sections.push(buildAtisSection('Departure', stations.departure));
    }

    if (!stations.arrival && !stations.departure && stations.general) {
        sections.push(buildAtisSection('General', stations.general));
    }

    const description = truncateText(sections.join('\n\n'), MAX_DESCRIPTION_LENGTH);
    const onlineCount = [stations.arrival, stations.departure, stations.general].filter(Boolean).length;

    return new EmbedBuilder()
        .setColor(ATIS_EMBED_COLOUR)
        .setTitle(`${icao} ATIS`)
        .setDescription(description)
        .setFooter({ text: `${onlineCount} ATIS station${onlineCount === 1 ? '' : 's'} online` });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('atis')
        .setDescription('Show arrival or departure VATSIM ATIS for an airport ICAO code.')
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
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply();

        try {
            const data = await fetchVatsimData();
            const stations = getAirportAtis(data, icao);

            if (!stations.arrival && !stations.departure && !stations.general) {
                await interaction.editReply(`No VATSIM ATIS is currently online for ${icao}.`);
                return;
            }

            await interaction.editReply({
                embeds: [buildAtisEmbed(icao, stations)]
            });
        } catch (error) {
            const status = error.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`VATSIM ATIS lookup unavailable right now for ${icao}${detail}.`);
        }
    }
};