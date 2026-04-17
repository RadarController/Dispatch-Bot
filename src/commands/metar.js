const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');

const cache = new Map();
const CACHE_MS = 60_000;

const FLIGHT_RULE_SEVERITY = {
    VFR: 0,
    MVFR: 1,
    IFR: 2,
    LIFR: 3
};

const FLIGHT_RULE_COLOURS = {
    VFR: 0x2ecc71,
    MVFR: 0x3498db,
    IFR: 0xe74c3c,
    LIFR: 0x9b59b6
};

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

function formatAirportHeader(icao) {
    return icao;
}

function parseObservationDate(token) {
    if (!/^\d{6}Z$/.test(token || '')) {
        return null;
    }

    const day = Number.parseInt(token.slice(0, 2), 10);
    const hour = Number.parseInt(token.slice(2, 4), 10);
    const minute = Number.parseInt(token.slice(4, 6), 10);

    if (!Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute)) {
        return null;
    }

    const now = new Date();
    const nowUtcDay = now.getUTCDate();
    const monthOffset = day > (nowUtcDay + 15) ? -1 : day < (nowUtcDay - 15) ? 1 : 0;

    const observed = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + monthOffset,
        day,
        hour,
        minute,
        0,
        0
    ));

    return Number.isNaN(observed.getTime()) ? null : observed;
}

function formatObservationFooter(rawMetar) {
    const tokens = rawMetar.split(/\s+/);
    const observationToken = tokens.find((token) => /^\d{6}Z$/.test(token));

    if (!observationToken) {
        return 'Observed time unavailable';
    }

    const observed = parseObservationDate(observationToken);
    if (!observed) {
        return `Observed ${observationToken}`;
    }

    const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(observed);

    return `Observed ${formatted}Z`;
}

function formatNumber(value) {
    return new Intl.NumberFormat('en-GB').format(value);
}

function fractionToNumber(text) {
    const match = /^(\d+)\/(\d+)$/.exec(text || '');
    if (!match) {
        return null;
    }

    const numerator = Number.parseInt(match[1], 10);
    const denominator = Number.parseInt(match[2], 10);

    if (!denominator) {
        return null;
    }

    return numerator / denominator;
}

function formatMilesValue(miles) {
    if (!Number.isFinite(miles)) {
        return 'Unknown';
    }

    if (Number.isInteger(miles)) {
        return `${miles} sm`;
    }

    const rounded = Math.round(miles * 100) / 100;
    return `${rounded} sm`;
}

function parseWind(tokens) {
    const token = tokens.find((value) => /^(\d{3}|VRB)(\d{2,3})(G\d{2,3})?(KT|MPS)$/.test(value) || value === '00000KT');

    if (!token) {
        return 'Not reported';
    }

    if (token === '00000KT') {
        return 'Calm';
    }

    const match = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/.exec(token);
    if (!match) {
        return 'Not reported';
    }

    const direction = match[1] === 'VRB' ? 'Variable' : `${match[1]}°`;
    const speed = Number.parseInt(match[2], 10);
    const gust = match[4] ? Number.parseInt(match[4], 10) : null;
    const unit = match[5] === 'MPS' ? 'm/s' : 'kt';

    let text = `${direction} at ${speed} ${unit}`;
    if (gust !== null) {
        text += `, gusting ${gust} ${unit}`;
    }

    const variationToken = tokens.find((value) => /^\d{3}V\d{3}$/.test(value));
    if (variationToken && match[1] !== 'VRB') {
        const from = variationToken.slice(0, 3);
        const to = variationToken.slice(4, 7);
        text += ` (${from}°-${to}° variable)`;
    }

    return text;
}

function parseVisibility(tokens) {
    if (tokens.includes('CAVOK')) {
        return {
            text: '10 km or more',
            meters: 10000
        };
    }

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];

        if (/^\d{4}$/.test(token)) {
            const meters = Number.parseInt(token, 10);
            if (!Number.isNaN(meters)) {
                if (meters >= 10000) {
                    return { text: '10 km or more', meters };
                }

                if (meters >= 1000) {
                    return { text: `${(meters / 1000).toFixed(1).replace(/\.0$/, '')} km`, meters };
                }

                return { text: `${formatNumber(meters)} m`, meters };
            }
        }

        const integerSmMatch = /^(M|P)?(\d+)SM$/.exec(token);
        if (integerSmMatch) {
            const miles = Number.parseInt(integerSmMatch[2], 10);
            const meters = Math.round(miles * 1609.344);
            const prefix = integerSmMatch[1] === 'M' ? '< ' : integerSmMatch[1] === 'P' ? '> ' : '';

            return {
                text: `${prefix}${formatMilesValue(miles)}`,
                meters
            };
        }

        const fractionSmMatch = /^(M)?(\d+)\/(\d+)SM$/.exec(token);
        if (fractionSmMatch) {
            const fraction = fractionToNumber(`${fractionSmMatch[2]}/${fractionSmMatch[3]}`);
            if (fraction !== null) {
                const wholePart = /^\d+$/.test(tokens[index - 1] || '') ? Number.parseInt(tokens[index - 1], 10) : 0;
                const miles = wholePart + fraction;
                const meters = Math.round(miles * 1609.344);
                const prefix = fractionSmMatch[1] === 'M' ? '< ' : '';

                return {
                    text: `${prefix}${formatMilesValue(miles)}`,
                    meters
                };
            }
        }
    }

    return {
        text: 'Not reported',
        meters: null
    };
}

function parseCloud(tokens) {
    if (tokens.includes('CAVOK')) {
        return {
            text: 'No significant cloud',
            ceilingFeet: null
        };
    }

    const clearToken = tokens.find((token) => ['NSC', 'NCD', 'SKC', 'CLR'].includes(token));
    if (clearToken) {
        const mapping = {
            NSC: 'No significant cloud',
            NCD: 'No cloud detected',
            SKC: 'Sky clear',
            CLR: 'Clear'
        };

        return {
            text: mapping[clearToken] || 'Clear',
            ceilingFeet: null
        };
    }

    const layers = [];
    let ceilingFeet = null;

    for (const token of tokens) {
        const match = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(token);
        if (!match) {
            continue;
        }

        const layerType = match[1];
        const baseToken = match[2];
        const cloudType = match[3] ? ` ${match[3]}` : '';
        const baseFeet = baseToken === '///' ? null : Number.parseInt(baseToken, 10) * 100;

        const text = baseFeet === null
            ? `${layerType} unknown${cloudType}`
            : `${layerType} ${formatNumber(baseFeet)} ft${cloudType}`;

        layers.push(text);

        if (baseFeet !== null && ['BKN', 'OVC', 'VV'].includes(layerType)) {
            ceilingFeet = ceilingFeet === null ? baseFeet : Math.min(ceilingFeet, baseFeet);
        }
    }

    return {
        text: layers.length > 0 ? layers.join(' • ') : 'Not reported',
        ceilingFeet
    };
}

function formatSignedTemperature(value) {
    if (value === '//' || !value) {
        return '?';
    }

    if (value.startsWith('M')) {
        return `-${Number.parseInt(value.slice(1), 10)}°C`;
    }

    return `${Number.parseInt(value, 10)}°C`;
}

function parseTemperature(tokens) {
    const token = tokens.find((value) => /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)$/.test(value));

    if (!token) {
        return 'Not reported';
    }

    const [temperature, dewPoint] = token.split('/');
    return `${formatSignedTemperature(temperature)} / ${formatSignedTemperature(dewPoint)}`;
}

function parseQnh(tokens) {
    const qnhToken = tokens.find((value) => /^Q\d{4}$/.test(value));
    if (qnhToken) {
        return `${qnhToken.slice(1)} hPa`;
    }

    const altimeterToken = tokens.find((value) => /^A\d{4}$/.test(value));
    if (altimeterToken) {
        const inchesHg = (Number.parseInt(altimeterToken.slice(1), 10) / 100).toFixed(2);
        return `${inchesHg} inHg`;
    }

    return 'Not reported';
}

function classifyCeiling(ceilingFeet) {
    if (ceilingFeet === null) {
        return 'VFR';
    }

    if (ceilingFeet < 500) {
        return 'LIFR';
    }

    if (ceilingFeet < 1000) {
        return 'IFR';
    }

    if (ceilingFeet <= 3000) {
        return 'MVFR';
    }

    return 'VFR';
}

function classifyVisibility(meters) {
    if (meters === null) {
        return 'VFR';
    }

    if (meters < 1600) {
        return 'LIFR';
    }

    if (meters < 4800) {
        return 'IFR';
    }

    if (meters <= 8000) {
        return 'MVFR';
    }

    return 'VFR';
}

function pickMostRestrictiveCategory(...categories) {
    return categories.reduce((current, next) => (
        FLIGHT_RULE_SEVERITY[next] > FLIGHT_RULE_SEVERITY[current] ? next : current
    ), 'VFR');
}

function parseMetarPanel(rawMetar, icao) {
    const tokens = rawMetar.split(/\s+/);
    const visibility = parseVisibility(tokens);
    const cloud = parseCloud(tokens);
    const flightRules = pickMostRestrictiveCategory(
        classifyVisibility(visibility.meters),
        classifyCeiling(cloud.ceilingFeet)
    );

    return {
        header: formatAirportHeader(icao),
        rawMetar,
        wind: parseWind(tokens),
        visibility: visibility.text,
        cloud: cloud.text,
        temperature: parseTemperature(tokens),
        qnh: parseQnh(tokens),
        flightRules,
        observedFooter: formatObservationFooter(rawMetar)
    };
}

function buildMetarEmbed(panel) {
    return new EmbedBuilder()
        .setColor(FLIGHT_RULE_COLOURS[panel.flightRules] || FLIGHT_RULE_COLOURS.VFR)
        .setTitle(panel.header)
        .setDescription(`\`\`\`${panel.rawMetar}\`\`\``)
        .addFields(
            { name: 'Flight Rules', value: panel.flightRules, inline: true },
            { name: 'Wind', value: panel.wind, inline: true },
            { name: 'Visibility', value: panel.visibility, inline: true },
            { name: 'Cloud', value: panel.cloud, inline: true },
            { name: 'Temp / Dewpoint', value: panel.temperature, inline: true },
            { name: 'QNH', value: panel.qnh, inline: true }
        )
        .setFooter({ text: panel.observedFooter });
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
            await interaction.reply({
                embeds: [buildMetarEmbed(cached.panel)]
            });
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

            const panel = parseMetarPanel(rawMetar, icao);

            cache.set(icao, {
                panel,
                cachedAt: now
            });

            await interaction.editReply({
                embeds: [buildMetarEmbed(panel)]
            });
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