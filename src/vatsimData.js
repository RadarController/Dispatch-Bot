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

function getControllerRole(callsign) {
    const parts = String(callsign || '').split('_');
    return parts[parts.length - 1] || '';
}

function getControllerBase(callsign) {
    const parts = String(callsign || '').split('_');
    return parts[0] || '';
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
        const leftType = getControllerRole(left.callsign || '');
        const rightType = getControllerRole(right.callsign || '');
        const leftRank = typeOrder[leftType] ?? 99;
        const rightRank = typeOrder[rightType] ?? 99;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return String(left.callsign || '').localeCompare(String(right.callsign || ''));
    });
}

function tokeniseAirportText(value) {
    return String(value || '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);
}

function buildAirportTokens(icao, airport) {
    const tokens = new Set([normaliseIcao(icao)]);

    if (!airport) {
        return tokens;
    }

    if (airport.iata) {
        tokens.add(String(airport.iata).toUpperCase());
    }

    for (const token of tokeniseAirportText(airport.name)) {
        tokens.add(token);
    }

    for (const token of tokeniseAirportText(airport.city)) {
        tokens.add(token);
    }

    for (const station of airport.stations || []) {
        const callsign = normaliseCallsign(station.callsign);
        const base = getControllerBase(callsign);
        const role = getControllerRole(callsign);

        if (base) {
            tokens.add(base);
        }

        if (role) {
            tokens.add(`${normaliseIcao(icao)}_${role}`);
            if (airport.iata) {
                tokens.add(`${String(airport.iata).toUpperCase()}_${role}`);
            }
        }
    }

    return tokens;
}

function tokenLooksRelated(left, right) {
    if (!left || !right) {
        return false;
    }

    if (left === right) {
        return true;
    }

    return left.endsWith(right) || right.endsWith(left);
}

function controllerMatchesStation(controller, station, airportTokens) {
    const controllerCallsign = normaliseCallsign(controller?.callsign);
    const stationCallsign = normaliseCallsign(station?.callsign);
    if (!controllerCallsign || !stationCallsign) {
        return false;
    }

    if (controllerCallsign === stationCallsign) {
        return true;
    }

    const controllerRole = getControllerRole(controllerCallsign);
    const stationRole = getControllerRole(stationCallsign);
    const controllerFrequency = normaliseFrequency(controller?.frequency);
    const stationFrequency = normaliseFrequency(station?.frequency);
    const controllerBase = getControllerBase(controllerCallsign);
    const stationBase = getControllerBase(stationCallsign);

    if (controllerRole !== stationRole || !controllerFrequency || !stationFrequency || controllerFrequency !== stationFrequency) {
        return false;
    }

    if (tokenLooksRelated(controllerBase, stationBase)) {
        return true;
    }

    for (const token of airportTokens) {
        if (tokenLooksRelated(controllerBase, token)) {
            return true;
        }
    }

    return false;
}

function getAirportControllerDebug(data, icao, airport = null) {
    const normalisedIcao = normaliseIcao(icao);
    const prefix = `${normalisedIcao}_`;
    const controllers = Array.isArray(data?.controllers) ? data.controllers : [];

    if (!airport || !Array.isArray(airport.stations) || airport.stations.length === 0) {
        const fallbackControllers = sortControllers(controllers.filter((controller) => {
            const callsign = normaliseCallsign(controller?.callsign);
            return callsign.startsWith(prefix) && !callsign.endsWith('_ATIS');
        }));

        return {
            matchSource: 'fallback',
            controllers: fallbackControllers,
            matchedStationCallsigns: []
        };
    }

    const airportTokens = buildAirportTokens(normalisedIcao, airport);
    const matchedStationCallsigns = new Set();

    const matchedControllers = sortControllers(controllers.filter((controller) => {
        const callsign = normaliseCallsign(controller?.callsign);
        if (!callsign || callsign.endsWith('_ATIS')) {
            return false;
        }

        let matched = false;
        for (const station of airport.stations) {
            if (controllerMatchesStation(controller, station, airportTokens)) {
                matched = true;
                matchedStationCallsigns.add(normaliseCallsign(station.callsign));
            }
        }

        return matched;
    }));

    return {
        matchSource: 'aip',
        controllers: matchedControllers,
        matchedStationCallsigns: [...matchedStationCallsigns].sort()
    };
}

function getAirportControllers(data, icao, airport = null) {
    return getAirportControllerDebug(data, icao, airport).controllers;
}

function getRelatedEnrouteControllers(data, icao, airport = null, excludedControllers = []) {
    if (!airport) {
        return [];
    }

    const controllers = Array.isArray(data?.controllers) ? data.controllers : [];
    const excluded = new Set(excludedControllers.map((controller) => normaliseCallsign(controller?.callsign)));
    const airportTokens = buildAirportTokens(icao, airport);
    const localStationCallsigns = new Set((airport.stations || []).map((station) => normaliseCallsign(station.callsign)));
    const allowedRoles = new Set(['APP', 'DEP', 'CTR', 'FSS']);

    return sortControllers(controllers.filter((controller) => {
        const callsign = normaliseCallsign(controller?.callsign);
        if (!callsign || callsign.endsWith('_ATIS') || excluded.has(callsign) || localStationCallsigns.has(callsign)) {
            return false;
        }

        const role = getControllerRole(callsign);
        if (!allowedRoles.has(role)) {
            return false;
        }

        const base = getControllerBase(callsign);
        if ([...airportTokens].some((token) => tokenLooksRelated(base, token))) {
            return true;
        }

        const searchableText = [
            callsign,
            controller?.name,
            ...(Array.isArray(controller?.text_atis) ? controller.text_atis : [])
        ].join(' ').toUpperCase();

        return [...airportTokens].some((token) => token.length >= 3 && searchableText.includes(token));
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
    getAirportControllerDebug,
    getRelatedEnrouteControllers,
    findCallsignRecord,
    normaliseCallsign,
    normaliseFrequency,
    normaliseIcao
};
