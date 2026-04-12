const axios = require('axios');
const { config } = require('./config');

const CACHE_MS = 15_000;

let cachedData = null;
let cachedAt = 0;
let inFlightPromise = null;

function getDataUrl() {
    return config.vatsimDataUrl || 'https://data.vatsim.net/v3/vatsim-data.json';
}

function normaliseIcao(icao) {
    return String(icao || '').trim().toUpperCase();
}

function normaliseCallsign(callsign) {
    return String(callsign || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function fetchVatsimData() {
    const now = Date.now();

    if (cachedData && (now - cachedAt) < CACHE_MS) {
        return cachedData;
    }

    if (inFlightPromise) {
        return inFlightPromise;
    }

    inFlightPromise = axios.get(getDataUrl(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Dispatch Bot/1.0'
        },
        timeout: 10000
    }).then((response) => {
        cachedData = response.data || {};
        cachedAt = Date.now();
        return cachedData;
    }).finally(() => {
        inFlightPromise = null;
    });

    return inFlightPromise;
}

function sortControllers(controllers) {
    const typeOrder = {
        DEL: 0,
        GND: 1,
        TWR: 2,
        APP: 3,
        DEP: 4,
        FSS: 5,
        CTR: 6
    };

    return [...controllers].sort((left, right) => {
        const leftParts = String(left.callsign || '').split('_');
        const rightParts = String(right.callsign || '').split('_');
        const leftType = leftParts[leftParts.length - 1] || '';
        const rightType = rightParts[rightParts.length - 1] || '';
        const leftRank = typeOrder[leftType] ?? 99;
        const rightRank = typeOrder[rightType] ?? 99;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return String(left.callsign || '').localeCompare(String(right.callsign || ''));
    });
}

function getAirportControllers(data, icao) {
    const normalisedIcao = normaliseIcao(icao);
    const prefix = `${normalisedIcao}_`;
    const controllers = Array.isArray(data?.controllers) ? data.controllers : [];

    return sortControllers(controllers.filter((controller) => {
        const callsign = normaliseCallsign(controller?.callsign);
        return callsign.startsWith(prefix) && !callsign.endsWith('_ATIS');
    }));
}

function getAirportAtis(data, icao) {
    const normalisedIcao = normaliseIcao(icao);
    const atisStations = Array.isArray(data?.atis) ? data.atis : [];

    const exactMatches = new Map();
    for (const station of atisStations) {
        const callsign = normaliseCallsign(station?.callsign);
        if (callsign.startsWith(`${normalisedIcao}_`)) {
            exactMatches.set(callsign, station);
        }
    }

    return {
        arrival: exactMatches.get(`${normalisedIcao}_A_ATIS`) || null,
        departure: exactMatches.get(`${normalisedIcao}_D_ATIS`) || null,
        general: exactMatches.get(`${normalisedIcao}_ATIS`) || null
    };
}

function mergeFlightPlans(primaryPlan, fallbackPlan) {
    if (!primaryPlan && !fallbackPlan) {
        return null;
    }

    return {
        ...(fallbackPlan || {}),
        ...(primaryPlan || {})
    };
}

function findCallsignRecord(data, callsign) {
    const normalisedCallsign = normaliseCallsign(callsign);
    const pilots = Array.isArray(data?.pilots) ? data.pilots : [];
    const prefiles = Array.isArray(data?.prefiles) ? data.prefiles : [];

    const livePilot = pilots.find((pilot) => normaliseCallsign(pilot?.callsign) === normalisedCallsign) || null;
    const prefile = prefiles.find((entry) => normaliseCallsign(entry?.callsign) === normalisedCallsign) || null;

    if (livePilot) {
        return {
            source: 'live',
            record: {
                ...livePilot,
                flight_plan: mergeFlightPlans(livePilot.flight_plan, prefile?.flight_plan)
            }
        };
    }

    if (prefile) {
        return {
            source: 'prefile',
            record: prefile
        };
    }

    return null;
}

module.exports = {
    fetchVatsimData,
    getAirportAtis,
    getAirportControllers,
    findCallsignRecord,
    normaliseCallsign,
    normaliseIcao
};
