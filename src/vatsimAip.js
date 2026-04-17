const axios = require('axios');
const { config } = require('./config');

const CACHE_MS = 6 * 60 * 60 * 1000;

const airportCache = new Map();
const inFlightAirports = new Map();

function getAipBaseUrl() {
    return config.vatsimAipBaseUrl || 'https://my.vatsim.net/api/v2/aip';
}

function buildAipAirportUrl(icao) {
    return `${getAipBaseUrl().replace(/\/$/, '')}/airports/${encodeURIComponent(normaliseIcao(icao))}`;
}

function normaliseIcao(icao) {
    return String(icao || '').trim().toUpperCase();
}

function normaliseCallsign(callsign) {
    return String(callsign || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normaliseFrequency(frequency) {
    if (frequency === null || frequency === undefined || frequency === '') {
        return '';
    }

    const numeric = Number.parseFloat(String(frequency));
    if (!Number.isFinite(numeric)) {
        return String(frequency).trim();
    }

    return numeric.toFixed(3);
}

function normaliseAirport(airport) {
    if (!airport || typeof airport !== 'object') {
        return null;
    }

    const stations = Array.isArray(airport.stations)
        ? airport.stations.map((station) => ({
            callsign: normaliseCallsign(station?.callsign),
            name: String(station?.name || '').trim(),
            frequency: normaliseFrequency(station?.frequency),
            ctaf: Boolean(station?.ctaf)
        })).filter((station) => station.callsign)
        : [];

    return {
        icao: normaliseIcao(airport.icao),
        iata: String(airport.iata || '').trim().toUpperCase(),
        name: String(airport.name || '').trim(),
        city: String(airport.city || '').trim(),
        country: String(airport.country || '').trim(),
        divisionId: String(airport.division_id || '').trim().toUpperCase(),
        stations
    };
}

async function fetchAirportFromAip(icao) {
    const normalisedIcao = normaliseIcao(icao);
    if (!normalisedIcao) {
        return null;
    }

    const now = Date.now();
    const cached = airportCache.get(normalisedIcao);
    if (cached && (now - cached.cachedAt) < CACHE_MS) {
        return cached.airport;
    }

    if (inFlightAirports.has(normalisedIcao)) {
        return inFlightAirports.get(normalisedIcao);
    }

    const requestUrl = buildAipAirportUrl(normalisedIcao);

    const request = axios.get(requestUrl, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Dispatch Bot/1.0'
        },
        timeout: 10000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404
    }).then((response) => {
        if (response.status === 404) {
            return null;
        }

        const airport = normaliseAirport(response.data?.data || response.data);
        if (airport) {
            airportCache.set(normalisedIcao, {
                airport,
                cachedAt: Date.now()
            });
        }

        return airport;
    }).finally(() => {
        inFlightAirports.delete(normalisedIcao);
    });

    inFlightAirports.set(normalisedIcao, request);
    return request;
}

module.exports = {
    fetchAirportFromAip,
    normaliseCallsign,
    normaliseFrequency,
    normaliseIcao
};
