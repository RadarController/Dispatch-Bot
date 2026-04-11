const axios = require('axios');
const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');

const cache = new Map();
const CACHE_MS = 60_000;

function normaliseRawMetar(text) {
    if (typeof text !== 'string') {
        return '';
    }

    const trimmed = text.trim();
    if (!trimmed) {
        return '';
    }

    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() || '';
    return firstLine;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('metar')
        .setDescription('Get the latest METAR for an airport ICAO code.')
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

        if (!config.metarApiBase) {
            await interaction.reply({
                content: 'METAR is not configured yet. Add METAR_API_BASE in Railway first.',
                ephemeral: true
            });
            return;
        }

        const now = Date.now();
        const cached = cache.get(icao);
        if (cached && (now - cached.cachedAt) < CACHE_MS) {
            await interaction.reply(`**${icao}**\n\`${cached.raw}\``);
            return;
        }

        await interaction.deferReply();

        try {
            const response = await axios.get(config.metarApiBase, {
                headers: {
                    Accept: 'text/plain',
                    'User-Agent': 'Dispatch Bot/1.0'
                },
                params: {
                    ids: icao,
                    format: 'raw'
                },
                timeout: 10000
            });

            const rawMetar = normaliseRawMetar(response.data);

            if (!rawMetar) {
                await interaction.editReply(`No METAR data was returned for ${icao}.`);
                return;
            }

            cache.set(icao, {
                raw: rawMetar,
                cachedAt: now
            });

            await interaction.editReply(`**${icao}**\n\`${rawMetar}\``);
        } catch (error) {
            const status = error.response?.status;

            if (status === 204) {
                await interaction.editReply(`No METAR found for ${icao}.`);
                return;
            }

            const detail = status ? ` (HTTP ${status})` : '';
            await interaction.editReply(`METAR lookup unavailable right now for ${icao}${detail}.`);
        }
    }
};