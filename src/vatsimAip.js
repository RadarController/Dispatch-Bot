const axios = require('axios');
const { config } = require('./config');

const CACHE_MS = 6 * 60 * 60 * 1000;

const airportCache = new Map();
const inFlightAirports = new Map();
const airportDebug = new Map();

function getAipBaseUrl() {
    return config.vatsimAipBaseUrl || 'https://vatsim.dev/api/aip-api';
}

function buildAipAirportUrl(icao) {
    return `${getAipBaseUrl().replace(/\/$/, '')}/airports/${encodeURIComponent(normaliseIcao(icao))}`;
}

function setAirportFetchDebug(icao, details) {
    airportDebug.set(normaliseIcao(icao), {
        icao: normaliseIcao(icao),
        ...details
    });
}

function getAirportFetchDebug(icao) {
    return airportDebug.get(normaliseIcao(icao)) || null;
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
        const existingDebug = getAirportFetchDebug(normalisedIcao);
        const url = buildAipAirportUrl(normalisedIcao);
        const httpResult = existingDebug?.httpResult
            ? `${existingDebug.httpResult} (cached)`
            : (cached.airport ? '200 (cached)' : 'unknown (cached)');

        setAirportFetchDebug(normalisedIcao, {
            url,
            httpResult,
            cached: true,
            airportFound: Boolean(cached.airport),
            airportIcao: cached.airport?.icao || null,
            airportIata: cached.airport?.iata || null,
            stationCount: cached.airport?.stations?.length || 0
        });

        console.log('[ATC_AIP_FETCH]', {
            icao: normalisedIcao,
            url,
            httpResult,
            cached: true,
            airportFound: Boolean(cached.airport),
            airportIcao: cached.airport?.icao || null,
            airportIata: cached.airport?.iata || null,
            stationCount: cached.airport?.stations?.length || 0
        });
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
            setAirportFetchDebug(normalisedIcao, {
                url: requestUrl,
                httpResult: '404',
                cached: false,
                airportFound: false,
                airportIcao: null,
                airportIata: null,
                stationCount: 0
            });
            console.log('[ATC_AIP_FETCH]', {
                icao: normalisedIcao,
                url: requestUrl,
                httpResult: '404',
                cached: false,
                airportFound: false
            });
            return null;
        }

        const airport = normaliseAirport(response.data?.data || response.data);
        airportCache.set(normalisedIcao, {
            airport,
            cachedAt: Date.now()
        });
        setAirportFetchDebug(normalisedIcao, {
            url: requestUrl,
            httpResult: String(response.status),
            cached: false,
            airportFound: Boolean(airport),
            airportIcao: airport?.icao || null,
            airportIata: airport?.iata || null,
            stationCount: airport?.stations?.length || 0
        });
        console.log('[ATC_AIP_FETCH]', {
            icao: normalisedIcao,
            url: requestUrl,
            httpResult: String(response.status),
            cached: false,
            airportFound: Boolean(airport),
            airportIcao: airport?.icao || null,
            airportIata: airport?.iata || null,
            stationCount: airport?.stations?.length || 0
        });
        return airport;
    }).catch((error) => {
        setAirportFetchDebug(normalisedIcao, {
            url: requestUrl,
            httpResult: 'error',
            cached: false,
            airportFound: false,
            airportIcao: null,
            airportIata: null,
            stationCount: 0,
            errorMessage: error?.message || 'Unknown error'
        });
        console.log('[ATC_AIP_FETCH]', {
            icao: normalisedIcao,
            url: requestUrl,
            httpResult: 'error',
            cached: false,
            airportFound: false,
            errorMessage: error?.message || 'Unknown error'
        });
        throw error;
    }).finally(() => {
        inFlightAirports.delete(normalisedIcao);
    });

    inFlightAirports.set(normalisedIcao, request);
    return request;
}

module.exports = {
    fetchAirportFromAip,
    getAirportFetchDebug,
    normaliseCallsign,
    normaliseFrequency,
    normaliseIcao
};
