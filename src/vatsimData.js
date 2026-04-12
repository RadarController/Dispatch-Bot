const axios = require('axios');
const { config } = require('./config');

const CACHE_MS = 15_000;

let cachedData = null;
let cachedAt = 0;
let inFlightPromise = null;

const TOP_DOWN_LAYERS = [
    { key: 'center', label: 'Area / Center' },
    { key: 'approach', label: 'Radar / Approach' },
    { key: 'directorFinal', label: 'Director / Final' },
    { key: 'tower', label: 'Tower' },
    { key: 'ground', label: 'Ground' },
    { key: 'delivery', label: 'Delivery' }
];

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

function classifyStationLayer(station) {
    const callsign = normaliseCallsign(station?.callsign);
    const role = getControllerRole(callsign);
    const searchable = `${String(station?.name || '').toUpperCase()} ${callsign}`;

    if (/\bDIRECTOR\b/.test(searchable) || /\bFINAL\b/.test(searchable) || /(^|_)DIR($|_)/.test(callsign) || /(^|_)FINAL($|_)/.test(callsign) || /(^|_)FIN($|_)/.test(callsign)) {
        return 'directorFinal';
    }

    if (role === 'CTR' || role === 'FSS') {
        return 'center';
    }

    if (role === 'APP' || role === 'DEP') {
        return 'approach';
    }

    if (role === 'TWR') {
        return 'tower';
    }

    if (role === 'GND') {
        return 'ground';
    }

    if (role === 'DEL') {
        return 'delivery';
    }

    return null;
}

function getAirportControllerMatchResult(data, icao, airport = null) {
    const normalisedIcao = normaliseIcao(icao);
    const prefix = `${normalisedIcao}_`;
    const controllers = Array.isArray(data?.controllers) ? data.controllers : [];

    if (!airport || !Array.isArray(airport.stations) || airport.stations.length === 0) {
        return {
            matchSource: 'fallback',
            controllers: sortControllers(controllers.filter((controller) => {
                const callsign = normaliseCallsign(controller?.callsign);
                return callsign.startsWith(prefix) && !callsign.endsWith('_ATIS');
            }))
        };
    }

    const airportTokens = buildAirportTokens(normalisedIcao, airport);

    return {
        matchSource: 'aip',
        controllers: sortControllers(controllers.filter((controller) => {
            const callsign = normaliseCallsign(controller?.callsign);
            if (!callsign || callsign.endsWith('_ATIS')) {
                return false;
            }

            return airport.stations.some((station) => controllerMatchesStation(controller, station, airportTokens));
        }))
    };
}

function getAirportControllers(data, icao, airport = null) {
    return getAirportControllerMatchResult(data, icao, airport).controllers;
}

function getRelatedEnrouteControllers(data, icao, airport = null, excludedControllers = []) {
    if (!airport || !Array.isArray(airport.stations) || airport.stations.length === 0) {
        return [];
    }

    const controllers = Array.isArray(data?.controllers) ? data.controllers : [];
    const excluded = new Set(excludedControllers.map((controller) => normaliseCallsign(controller?.callsign)));
    const allowedRoles = new Set(['APP', 'DEP', 'CTR', 'FSS']);
    const areaStationCallsigns = new Set(
        airport.stations
            .map((station) => normaliseCallsign(station?.callsign))
            .filter((callsign) => callsign && allowedRoles.has(getControllerRole(callsign)))
    );

    if (areaStationCallsigns.size === 0) {
        return [];
    }

    return sortControllers(controllers.filter((controller) => {
        const callsign = normaliseCallsign(controller?.callsign);
        if (!callsign || callsign.endsWith('_ATIS') || excluded.has(callsign)) {
            return false;
        }

        return areaStationCallsigns.has(callsign);
    }));
}

function buildLayerStationDefinitions(airport) {
    const layerStations = new Map(TOP_DOWN_LAYERS.map((layer) => [layer.key, []]));

    for (const station of airport?.stations || []) {
        const layerKey = classifyStationLayer(station);
        if (!layerKey || !layerStations.has(layerKey)) {
            continue;
        }

        layerStations.get(layerKey).push(station);
    }

    return layerStations;
}

function findStationForController(controller, airport) {
    const airportTokens = buildAirportTokens(airport?.icao || '', airport);
    return (airport?.stations || []).find((station) => controllerMatchesStation(controller, station, airportTokens)) || null;
}

function classifyControllerLayer(controller, airport) {
    const matchedStation = findStationForController(controller, airport);
    if (matchedStation) {
        return classifyStationLayer(matchedStation);
    }

    return classifyStationLayer({
        callsign: controller?.callsign,
        name: Array.isArray(controller?.text_atis) && controller.text_atis.length > 0 ? controller.text_atis[0] : ''
    });
}

function dedupeControllers(controllers) {
    const byCallsign = new Map();

    for (const controller of controllers || []) {
        const callsign = normaliseCallsign(controller?.callsign);
        if (!callsign || byCallsign.has(callsign)) {
            continue;
        }

        byCallsign.set(callsign, controller);
    }

    return sortControllers([...byCallsign.values()]);
}

function getAirportTopDownCoverage(airport, matchedControllers = []) {
    if (!airport || !Array.isArray(airport.stations) || airport.stations.length === 0) {
        return null;
    }

    const layerStations = buildLayerStationDefinitions(airport);
    const visibleLayers = TOP_DOWN_LAYERS.filter((layer) => (layerStations.get(layer.key) || []).length > 0);

    if (visibleLayers.length === 0) {
        return null;
    }

    const onlineByLayer = new Map(visibleLayers.map((layer) => [layer.key, []]));

    for (const controller of matchedControllers) {
        const layerKey = classifyControllerLayer(controller, airport);
        if (!layerKey || !onlineByLayer.has(layerKey)) {
            continue;
        }

        onlineByLayer.get(layerKey).push(controller);
    }

    for (const [key, controllers] of onlineByLayer.entries()) {
        onlineByLayer.set(key, dedupeControllers(controllers));
    }

    const entries = [];
    let inheritedControllers = [];

    for (const layer of visibleLayers) {
        const explicitControllers = onlineByLayer.get(layer.key) || [];

        if (explicitControllers.length > 0) {
            inheritedControllers = explicitControllers;
            entries.push({
                key: layer.key,
                label: layer.label,
                status: 'online',
                controllers: explicitControllers
            });
            continue;
        }

        if (inheritedControllers.length > 0) {
            entries.push({
                key: layer.key,
                label: layer.label,
                status: 'covered',
                controllers: inheritedControllers
            });
            continue;
        }

        entries.push({
            key: layer.key,
            label: layer.label,
            status: 'unstaffed',
            controllers: []
        });
    }

    return {
        entries,
        visibleLayers: visibleLayers.map((layer) => layer.key),
        onlineControllers: dedupeControllers(matchedControllers)
    };
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
    getAirportControllerMatchResult,
    getAirportControllers,
    getAirportTopDownCoverage,
    getRelatedEnrouteControllers,
    findCallsignRecord,
    normaliseCallsign,
    normaliseFrequency,
    normaliseIcao
};
