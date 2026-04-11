const axios = require('axios');
const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');

function normaliseMetarPayload(data) {
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  if (data && Array.isArray(data.data) && data.data.length > 0) {
    return data.data[0];
  }

  if (data && typeof data === 'object') {
    return data;
  }

  return null;
}

function extractRawMetar(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return (
    payload.raw ||
    payload.raw_text ||
    payload.metar ||
    payload.report ||
    payload.text ||
    ''
  );
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

    await interaction.deferReply();

    try {
      const headers = {};

      if (config.metarApiKey) {
        headers.Authorization = `Bearer ${config.metarApiKey}`;
        headers['X-API-Key'] = config.metarApiKey;
      }

      const response = await axios.get(config.metarApiBase, {
        headers,
        params: { icao },
        timeout: 10000
      });

      const payload = normaliseMetarPayload(response.data);
      const rawMetar = extractRawMetar(payload);

      if (!rawMetar) {
        await interaction.editReply(`No METAR data was returned for ${icao}.`);
        return;
      }

      await interaction.editReply(`**${icao}**\n\`${rawMetar}\``);
    } catch (error) {
      const status = error.response?.status;
      const detail = status ? ` (HTTP ${status})` : '';
      await interaction.editReply(`Failed to retrieve METAR for ${icao}${detail}.`);
    }
  }
};
