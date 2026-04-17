const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { fetchVatsimData, findCallsignRecord } = require('../vatsimData');

const LIVE_EMBED_COLOUR = 0x2ea043;
const PREFILE_EMBED_COLOUR = 0x8b949e;
const MAX_ROUTE_LENGTH = 3900;

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatFlightRules(value) {
    if (value === 'I') {
        return 'IFR';
    }

    if (value === 'V') {
        return 'VFR';
    }

    return value || 'Unknown';
}

function formatValue(value) {
    return value ? String(value) : 'Unknown';
}

function buildRouteDescription(route) {
    const routeText = route || 'Route not filed';
    return `\`\`\`\n${truncateText(routeText, MAX_ROUTE_LENGTH)}\n\`\`\``;
}

function buildCallsignEmbed(source, record) {
    const flightPlan = record.flight_plan || {};
    const isLive = source === 'live';

    return new EmbedBuilder()
        .setColor(isLive ? LIVE_EMBED_COLOUR : PREFILE_EMBED_COLOUR)
        .setTitle(record.callsign || 'Unknown Callsign')
        .setDescription(buildRouteDescription(flightPlan.route))
        .addFields(
            { name: 'Status', value: isLive ? 'Live on VATSIM' : 'Prefile', inline: true },
            { name: 'Type', value: formatValue(flightPlan.aircraft_short || flightPlan.aircraft), inline: true },
            { name: 'Rules', value: formatFlightRules(flightPlan.flight_rules), inline: true },
            { name: 'Departure', value: formatValue(flightPlan.departure), inline: true },
            { name: 'Arrival', value: formatValue(flightPlan.arrival), inline: true },
            { name: 'Alternate', value: formatValue(flightPlan.alternate), inline: true }
        )
        .setFooter({ text: isLive ? 'Matched against live pilots first, then prefiles' : 'Matched from VATSIM prefiles' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('callsign')
        .setDescription('Show the aircraft type and filed route for a VATSIM callsign.')
        .addStringOption((option) =>
            option
                .setName('callsign')
                .setDescription('Aircraft callsign, for example BAW123')
                .setRequired(true)
        ),

    async execute(interaction) {
        const callsign = interaction.options.getString('callsign', true).trim().toUpperCase().replace(/\s+/g, '');

        if (!/^[A-Z0-9]{2,10}$/.test(callsign)) {
            await interaction.reply({
                content: 'Please provide a valid callsign, for example BAW123.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply();

        try {
            const data = await fetchVatsimData();
            const match = findCallsignRecord(data, callsign);

            if (!match) {
                await interaction.editReply(`No live VATSIM pilot or prefile was found for ${callsign}.`);
                return;
            }

            await interaction.editReply({
                embeds: [buildCallsignEmbed(match.source, match.record)]
            });
        } catch (error) {
            const status = error.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`VATSIM callsign lookup unavailable right now for ${callsign}${detail}.`);
        }
    }
};