// dataset_search_location_handler.js
// Handles dataset-search geolocation helpers and location-row visibility toggles.
// Bridges browser geolocation/localStorage with registered dataset-search components.
// Exists to keep location concerns separate from search rendering and streaming logic.
import { datasetSearchRegistry } from "./dataset_search_state_reader.js";
import { parseGpsCoordString } from "./dataset_search_location_handler_helpers.js";

export function showLocationRow(tableName) {
    const components = datasetSearchRegistry.get(tableName);
    if (!components) return;
    components.forEach((component) => component.setLocationRowVisible(true));
}

export async function requestGpsPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation)
            return reject(new Error("Geolocation API puuttuu"));
        navigator.geolocation.getCurrentPosition(
            (pos) =>
                resolve({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                }),
            (err) => reject(err),
            { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 }
        );
    });
}

export function getStoredGpsCoords(storageKey) {
    const raw = localStorage.getItem(storageKey);
    return parseGpsCoordString(raw);
}
