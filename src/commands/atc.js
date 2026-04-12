const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { fetchVatsimData, getAirportControllers } = require('../vatsimData');

const ATC_EMBED_COLOUR = 0x1f6feb;

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildAtcDescription(controllers) {
    return controllers.map((controller) => {
        const infoLine = Array.isArray(controller.text_atis) && controller.text_atis.length > 0
            ? ` — ${truncateText(controller.text_atis[0], 120)}`
            : '';

        return `• **${controller.callsign}** — ${controller.frequency}${infoLine}`;
    }).join('\n');
}

function buildAtcEmbed(icao, controllers) {
    return new EmbedBuilder()
        .setColor(ATC_EMBED_COLOUR)
        .setTitle(`${icao} Online ATC`)
        .setDescription(buildAtcDescription(controllers))
        .setFooter({ text: `${controllers.length} position${controllers.length === 1 ? '' : 's'} online` });
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
            const data = await fetchVatsimData();
            const controllers = getAirportControllers(data, icao);

            if (controllers.length === 0) {
                await interaction.editReply(`No airport-specific VATSIM ATC is currently online for ${icao}.`);
                return;
            }

            await interaction.editReply({
                embeds: [buildAtcEmbed(icao, controllers)]
            });
        } catch (error) {
            const status = error.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`VATSIM ATC lookup unavailable right now for ${icao}${detail}.`);
        }
    }
};
