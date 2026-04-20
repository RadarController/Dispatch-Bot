const axios = require('axios');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { config } = require('./config');
const {
  fetchVatsimData,
  getAirportAtis,
  getAirportControllerMatchResult,
  getAirportTopDownCoverage
} = require('./vatsimData');
const { fetchAirportFromAip } = require('./vatsimAip');

const OVERVIEW_EMBED_COLOUR = 0x1f6feb;
const METAR_EMBED_COLOUR = 0x2ecc71;
const ATIS_EMBED_COLOUR = 0xf59e0b;
const ATC_EMBED_COLOUR = 0x1f6feb;
const CHARTS_EMBED_COLOUR = 0x8b949e;

const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
const MAX_ATIS_DESCRIPTION_LENGTH = 3800;

const METAR_CACHE_MS = 60_000;
const metarCache = new Map();

const CHARTFOX_AIRPORT_URL_BASE = 'https://chartfox.org';

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

function normaliseIcaoInput(icao) {
  const value = String(icao || '').trim().toUpperCase();
  return /^[A-Z]{4}$/.test(value) ? value : '';
}

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

function formatDiscordTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }

  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Unknown';
  }

  return `<t:${timestamp}:R>`;
}

function buildChartFoxUrl(icao) {
  return `${CHARTFOX_AIRPORT_URL_BASE}/${encodeURIComponent(icao)}`;
}

function buildVatsimRadarUrl(icao) {
  return `https://vatsim-radar.com/airport/${encodeURIComponent(icao)}?zoom=14.00&aircraft&info=info&weather=metar&columns=prefiles,groundDep,departures,arrivals,groundArr&mode=dashBigMapSmall&controller=1&stats=0&tracks=1`;
}

function buildAirportLinkComponents(icao) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Charts')
      .setStyle(ButtonStyle.Link)
      .setURL(buildChartFoxUrl(icao)),
    new ButtonBuilder()
      .setLabel('Radar')
      .setStyle(ButtonStyle.Link)
      .setURL(buildVatsimRadarUrl(icao))
  );

  return [row];
}

function buildAirportLocation(airport, icao) {
  if (!airport) {
    return icao;
  }

  const parts = [
    airport.name || icao,
    airport.city || null,
    airport.country || null
  ].filter(Boolean);

  return parts.join(' • ');
}

function buildMessageEmbed(title, description, colour = OVERVIEW_EMBED_COLOUR) {
  return new EmbedBuilder()
    .setColor(colour)
    .setTitle(title)
    .setDescription(truncateText(description, DESCRIPTION_LIMIT));
}

function buildErrorMessage(prefix, icao, error) {
  const status = error?.response?.status;
  const detail = status ? ` (HTTP ${status})` : '';
  return `${prefix} unavailable right now for ${icao}${detail}.`;
}

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
  const token = tokens.find((value) => /^(?:\d{3}|VRB)(?:\d{2,3})(?:G\d{2,3})?(?:KT|MPS)$/.test(value) || value === '00000KT');

  if (!token) {
    return 'Not reported';
  }

  if (token === '00000KT') {
    return 'Calm';
  }

  const match = /^(?:([\d]{3}|VRB))(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(token);
  if (!match) {
    return 'Not reported';
  }

  const direction = match[1] === 'VRB' ? 'Variable' : `${match[1]}°`;
  const speed = Number.parseInt(match[2], 10);
  const gust = match[3] ? Number.parseInt(match[3], 10) : null;
  const unit = match[4] === 'MPS' ? 'm/s' : 'kt';

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
    header: icao,
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

function buildMetarEmbed(icao, result) {
  if (result.status !== 'ok') {
    return buildMessageEmbed(`${icao} METAR`, result.message, METAR_EMBED_COLOUR);
  }

  const panel = result.panel;

  return new EmbedBuilder()
    .setColor(FLIGHT_RULE_COLOURS[panel.flightRules] || FLIGHT_RULE_COLOURS.VFR)
    .setTitle(`${icao} METAR`)
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

async function fetchMetarResult(icao) {
  if (!config.metarApiBase) {
    return {
      status: 'not_configured',
      message: `METAR is not configured yet for ${icao}.`
    };
  }

  const now = Date.now();
  const cached = metarCache.get(icao);
  if (cached && (now - cached.cachedAt) < METAR_CACHE_MS) {
    return {
      status: 'ok',
      panel: cached.panel
    };
  }

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
      return {
        status: 'not_found',
        message: `No METAR data was returned for ${icao}.`
      };
    }

    const panel = parseMetarPanel(rawMetar, icao);
    metarCache.set(icao, {
      panel,
      cachedAt: now
    });

    return {
      status: 'ok',
      panel
    };
  } catch (error) {
    if (error.response?.status === 204) {
      return {
        status: 'not_found',
        message: `No METAR found for ${icao}.`
      };
    }

    return {
      status: 'error',
      message: buildErrorMessage('METAR lookup', icao, error)
    };
  }
}

function formatAtisText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'Text ATIS unavailable';
  }

  return lines.join('\n');
}

function buildAtisSectionDescription(label, station) {
  const headingBits = [
    label,
    station.frequency ? `${station.frequency}` : null,
    station.atis_code ? `Info ${station.atis_code}` : null
  ]
    .filter(Boolean)
    .join(' • ');

  return `**${headingBits}**\n\`\`\`\n${formatAtisText(station.text_atis)}\n\`\`\``;
}

function buildAtisSummary(result) {
  if (result.status !== 'ok') {
    return result.message;
  }

  const lines = [];

  if (result.stations.arrival) {
    lines.push(`Arrival: ${result.stations.arrival.frequency || 'Unknown'}${result.stations.arrival.atis_code ? ` • Info ${result.stations.arrival.atis_code}` : ''}`);
  }

  if (result.stations.departure) {
    lines.push(`Departure: ${result.stations.departure.frequency || 'Unknown'}${result.stations.departure.atis_code ? ` • Info ${result.stations.departure.atis_code}` : ''}`);
  }

  if (!result.stations.arrival && !result.stations.departure && result.stations.general) {
    lines.push(`General: ${result.stations.general.frequency || 'Unknown'}${result.stations.general.atis_code ? ` • Info ${result.stations.general.atis_code}` : ''}`);
  }

  return lines.length > 0 ? lines.join('\n') : `No VATSIM ATIS is currently online for ${result.icao}.`;
}

function buildAtisEmbed(icao, result) {
  if (result.status !== 'ok') {
    return buildMessageEmbed(`${icao} ATIS`, result.message, ATIS_EMBED_COLOUR);
  }

  const sections = [];

  if (result.stations.arrival) {
    sections.push(buildAtisSectionDescription('Arrival', result.stations.arrival));
  }

  if (result.stations.departure) {
    sections.push(buildAtisSectionDescription('Departure', result.stations.departure));
  }

  if (!result.stations.arrival && !result.stations.departure && result.stations.general) {
    sections.push(buildAtisSectionDescription('General', result.stations.general));
  }

  return new EmbedBuilder()
    .setColor(ATIS_EMBED_COLOUR)
    .setTitle(`${icao} ATIS`)
    .setDescription(truncateText(sections.join('\n\n'), MAX_ATIS_DESCRIPTION_LENGTH))
    .setFooter({
      text: `${[result.stations.arrival, result.stations.departure, result.stations.general].filter(Boolean).length} ATIS station(s) online`
    });
}

function formatTopDownControllers(controllers) {
  return controllers.map((controller) => `${controller.callsign} (${controller.frequency})`).join(', ');
}

function getLayerStyle(entry) {
  switch (entry.key) {
    case 'center':
      return { icon: '🟨', accent: '◉' };
    case 'approach':
      return { icon: '🟦', accent: '◉' };
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

  return lines.join('\n');
}

function buildAtcEmbed(icao, result) {
  if (result.status !== 'ok') {
    return buildMessageEmbed(`${icao} Online ATC`, result.message, ATC_EMBED_COLOUR);
  }

  const embed = new EmbedBuilder()
    .setColor(ATC_EMBED_COLOUR)
    .setTitle(`${icao} Online ATC`);

  if (result.airport?.name) {
    embed.setDescription(truncateText(buildAirportLocation(result.airport, icao), DESCRIPTION_LIMIT));
  }

  embed.addFields({
    name: 'Top-down coverage',
    value: trimFieldValue(buildGraphicalTopDownBlock(result.topDownCoverage)),
    inline: false
  });

  const footerDetail = result.controllerResult.matchSource === 'aip'
    ? 'Top-down view'
    : 'Fallback top-down view';

  return embed.setFooter({
    text: `${result.controllerResult.controllers.length} matched position(s) online • ${footerDetail}`
  });
}

function buildAtcOverviewValue(result) {
  if (result.status !== 'ok') {
    return result.message;
  }

  return trimFieldValue(buildGraphicalTopDownBlock(result.topDownCoverage));
}

function buildMetarOverviewValue(result) {
  if (result.status !== 'ok') {
    return result.message;
  }

  const panel = result.panel;

  return trimFieldValue([
    `\`${panel.rawMetar}\``,
    `Rules: ${panel.flightRules}`,
    `Wind: ${panel.wind}`,
    `Visibility: ${panel.visibility}`,
    `QNH: ${panel.qnh}`
  ].join('\n'));
}

function buildAirportOverviewEmbed(snapshot) {
  const embed = new EmbedBuilder()
    .setColor(OVERVIEW_EMBED_COLOUR)
    .setTitle(`${snapshot.icao} Airport`)
    .setDescription(buildAirportLocation(snapshot.airport, snapshot.icao))
    .addFields(
      {
        name: 'METAR',
        value: buildMetarOverviewValue(snapshot.metar),
        inline: false
      },
      {
        name: 'ATIS',
        value: trimFieldValue(buildAtisSummary(snapshot.atis)),
        inline: false
      },
      {
        name: 'ATC',
        value: buildAtcOverviewValue(snapshot.atc),
        inline: false
      }
    )
    .setFooter({
      text: 'Use the section option on /airport for a focused METAR, ATIS, ATC, or charts view.'
    });

  return embed;
}

function buildChartsEmbed(snapshot) {
  const descriptionLines = [
    buildAirportLocation(snapshot.airport, snapshot.icao),
    '',
    'Use the buttons below to open ChartFox and VATSIM Radar for this airport.'
  ];

  return new EmbedBuilder()
    .setColor(CHARTS_EMBED_COLOUR)
    .setTitle(`${snapshot.icao} Charts & Radar`)
    .setDescription(descriptionLines.join('\n'));
}

async function fetchAirportSnapshot(icao) {
  const [metarResult, vatsimResult, airportResult] = await Promise.allSettled([
    fetchMetarResult(icao),
    fetchVatsimData(),
    fetchAirportFromAip(icao)
  ]);

  const airport = airportResult.status === 'fulfilled' ? airportResult.value : null;

  const metar = metarResult.status === 'fulfilled'
    ? metarResult.value
    : {
        status: 'error',
        message: buildErrorMessage('METAR lookup', icao, metarResult.reason)
      };

  let atis;
  let atc;

  if (vatsimResult.status !== 'fulfilled') {
    const atisMessage = buildErrorMessage('VATSIM ATIS lookup', icao, vatsimResult.reason);
    const atcMessage = buildErrorMessage('VATSIM ATC lookup', icao, vatsimResult.reason);

    atis = {
      status: 'error',
      icao,
      message: atisMessage
    };

    atc = {
      status: 'error',
      icao,
      airport,
      message: atcMessage
    };
  } else {
    const vatsimData = vatsimResult.value;
    const stations = getAirportAtis(vatsimData, icao);
    const hasAtis = Boolean(stations.arrival || stations.departure || stations.general);

    atis = hasAtis
      ? {
          status: 'ok',
          icao,
          stations
        }
      : {
          status: 'offline',
          icao,
          message: `No VATSIM ATIS is currently online for ${icao}.`
        };

    const controllerResult = getAirportControllerMatchResult(vatsimData, icao, airport);
    const topDownCoverage = getAirportTopDownCoverage(airport, controllerResult.controllers, {
      matchSource: controllerResult.matchSource,
      icao
    });

    if (controllerResult.controllers.length === 0) {
      const message = airport
        ? `The airport was found in the VATSIM AIP, but no matching charted positions are online right now. (${icao})`
        : `No airport-specific VATSIM ATC is currently online for this airport. (${icao})`;

      atc = {
        status: 'offline',
        icao,
        airport,
        controllerResult,
        topDownCoverage,
        message
      };
    } else {
      atc = {
        status: 'ok',
        icao,
        airport,
        controllerResult,
        topDownCoverage
      };
    }
  }

  return {
    icao,
    airport,
    metar,
    atis,
    atc
  };
}

module.exports = {
  buildAirportLinkComponents,
  buildAirportOverviewEmbed,
  buildAtcEmbed,
  buildChartsEmbed,
  buildMetarEmbed,
  buildAtisEmbed,
  buildChartFoxUrl,
  buildVatsimRadarUrl,
  fetchAirportSnapshot,
  normaliseIcaoInput
};