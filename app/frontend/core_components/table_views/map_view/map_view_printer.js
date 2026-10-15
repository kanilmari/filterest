// map_view_printer.js
// Renders dataset rows with coordinate data into a lightweight map-style table view.
// Bridges table columns, row data, and dependency-free Web Mercator tile rendering.
// Exists to make location rows visible together without forcing a map library dependency yet.

import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
} from "../dataset_value_localizer.js";

import {
    extract_map_points,
    findColumnByAliases,
    mergeColumnsWithRowKeys,
} from "./map_coordinates.js";
export { extract_map_points, dataset_supports_map_view } from "./map_coordinates.js";

const MAP_TILE_SIZE = 256;
const MAP_TILE_PADDING_RATIO = 0.18;
const MAP_TILE_MIN_PIXEL_RANGE = MAP_TILE_SIZE * 2;
const MAP_MAX_MERCATOR_LATITUDE = 85.05112878;
const DEFAULT_TILE_PROVIDER = {
    attribution: "\u00a9 OpenStreetMap contributors",
    label: "OpenStreetMap",
    maxZoom: 18,
    minZoom: 2,
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};
const MAP_VIEW_LANGUAGE_RENDERERS = new WeakMap();
const PRIMARY_LABEL_ALIASES = [
    "name",
    "title",
    "nimi",
    "label",
    "display_name",
    "service_location_name",
    "location_name",
    "place_name",
];
const ADDRESS_STREET_ALIASES = [
    "address",
    "street_address",
    "street",
    "osoite",
    "address_line",
    "address_line_1",
];
const ADDRESS_POSTAL_ALIASES = ["postal_code", "postcode", "zip", "zip_code", "postinumero"];
const ADDRESS_CITY_ALIASES = ["city", "town", "municipality", "kaupunki", "kunta"];
const ID_LABEL_ALIASES = ["id"];

// Keeps numbers inside a closed range before they feed projection math.
function clampNumber(value, minValue, maxValue) {
    return Math.min(maxValue, Math.max(minValue, value));
}

// Formats coordinates for compact marker and list labels.
function formatCoordinateValue(value) {
    return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

// Creates a display-only reader that leaves the raw row payload intact for editing and coordinate parsing.
function createMapDisplayValueReader(dataTypes, chosenLanguage) {
    return (row, column) => resolveDatasetDisplayValue(
        row?.[column],
        dataTypes?.[column] || null,
        chosenLanguage
    ).trim();
}

// Finds the first non-empty cell matching alias priority instead of table order.
function findFirstCellTextByAliases(row, columns, aliases, readDisplayValue) {
    for (const alias of aliases) {
        const column = findColumnByAliases(columns, [alias]);
        const value = column ? readDisplayValue(row, column) : "";
        if (value) {
            return value;
        }
    }
    return "";
}

// Builds a compact address label when name/title columns are not available.
function resolveAddressLabel(row, columns, readDisplayValue) {
    const street = findFirstCellTextByAliases(row, columns, ADDRESS_STREET_ALIASES, readDisplayValue);
    const postalCode = findFirstCellTextByAliases(row, columns, ADDRESS_POSTAL_ALIASES, readDisplayValue);
    const city = findFirstCellTextByAliases(row, columns, ADDRESS_CITY_ALIASES, readDisplayValue);
    const postalCity = [postalCode, city].filter(Boolean).join(" ");
    return [street, postalCity].filter(Boolean).join(", ");
}

// Resolves a stable human-readable row label for marker and list controls.
function resolveRowLabel(row, columns, rowIndex, readDisplayValue) {
    const rowColumns = mergeColumnsWithRowKeys(columns, row);
    const primaryLabel = findFirstCellTextByAliases(
        row,
        rowColumns,
        PRIMARY_LABEL_ALIASES,
        readDisplayValue
    );
    if (primaryLabel) {
        return primaryLabel;
    }

    const addressLabel = resolveAddressLabel(row, rowColumns, readDisplayValue);
    if (addressLabel) {
        return addressLabel;
    }

    const idLabel = findFirstCellTextByAliases(
        row,
        rowColumns,
        ID_LABEL_ALIASES,
        readDisplayValue
    );
    if (idLabel) {
        return idLabel;
    }
    return `Row ${rowIndex + 1}`;
}

// Converts longitude/latitude into Web Mercator world pixels at one zoom level.
function projectCoordinateToWorldPixel(point, zoom) {
    const scale = 2 ** zoom;
    const latitude = clampNumber(
        point.latitude,
        -MAP_MAX_MERCATOR_LATITUDE,
        MAP_MAX_MERCATOR_LATITUDE
    );
    const latitudeRadians = latitude * (Math.PI / 180);
    const x = ((point.longitude + 180) / 360) * scale * MAP_TILE_SIZE;
    const y = (
        (1 - (Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI)) / 2
    ) * scale * MAP_TILE_SIZE;

    return { x, y };
}

// Chooses a practical static zoom based on how spread out the loaded points are.
function resolveTileZoom(points) {
    const latitudeValues = points.map((point) => point.latitude);
    const longitudeValues = points.map((point) => point.longitude);
    const latitudeSpan = Math.max(...latitudeValues) - Math.min(...latitudeValues);
    const longitudeSpan = Math.max(...longitudeValues) - Math.min(...longitudeValues);
    const largestSpan = Math.max(latitudeSpan, longitudeSpan);

    if (largestSpan <= 0.02) return 14;
    if (largestSpan <= 0.08) return 13;
    if (largestSpan <= 0.25) return 12;
    if (largestSpan <= 0.75) return 10;
    if (largestSpan <= 2) return 8;
    if (largestSpan <= 8) return 6;
    return 4;
}

// Builds padded Web Mercator pixel bounds so one-point maps still show a useful neighborhood.
function resolveTileWorldBounds(points, zoom) {
    const projectedPoints = points.map((point) => projectCoordinateToWorldPixel(point, zoom));
    const xValues = projectedPoints.map((point) => point.x);
    const yValues = projectedPoints.map((point) => point.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const baseWidth = Math.max(maxX - minX, MAP_TILE_MIN_PIXEL_RANGE);
    const baseHeight = Math.max(maxY - minY, MAP_TILE_MIN_PIXEL_RANGE);
    const paddedWidth = baseWidth * (1 + MAP_TILE_PADDING_RATIO);
    const paddedHeight = baseHeight * (1 + MAP_TILE_PADDING_RATIO);

    return {
        minX: centerX - (paddedWidth / 2),
        maxX: centerX + (paddedWidth / 2),
        minY: centerY - (paddedHeight / 2),
        maxY: centerY + (paddedHeight / 2),
    };
}

// Converts a world-pixel location into a percentage inside the rendered tile viewport.
function resolveWorldPixelPercent(worldPoint, worldBounds) {
    return {
        xPercent: ((worldPoint.x - worldBounds.minX) / (worldBounds.maxX - worldBounds.minX)) * 100,
        yPercent: ((worldPoint.y - worldBounds.minY) / (worldBounds.maxY - worldBounds.minY)) * 100,
    };
}

// Creates one raster tile image for the static map background.
function createTileImage(tileX, tileY, zoom, worldBounds) {
    const scale = 2 ** zoom;
    if (tileY < 0 || tileY >= scale) {
        return null;
    }

    const wrappedTileX = ((tileX % scale) + scale) % scale;
    const tileImage = document.createElement("img");
    tileImage.classList.add("map-view-tile");
    tileImage.alt = "";
    tileImage.decoding = "async";
    tileImage.loading = "lazy";
    tileImage.src = DEFAULT_TILE_PROVIDER.urlTemplate
        .replace("{z}", String(zoom))
        .replace("{x}", String(wrappedTileX))
        .replace("{y}", String(tileY));
    tileImage.style.left = `${((tileX * MAP_TILE_SIZE - worldBounds.minX) / (worldBounds.maxX - worldBounds.minX)) * 100}%`;
    tileImage.style.top = `${((tileY * MAP_TILE_SIZE - worldBounds.minY) / (worldBounds.maxY - worldBounds.minY)) * 100}%`;
    tileImage.style.width = `${(MAP_TILE_SIZE / (worldBounds.maxX - worldBounds.minX)) * 100}%`;
    tileImage.style.height = `${(MAP_TILE_SIZE / (worldBounds.maxY - worldBounds.minY)) * 100}%`;
    return tileImage;
}

// Creates the static map tile layer used behind coordinate markers.
function createTileLayer(points) {
    const zoom = clampNumber(
        resolveTileZoom(points),
        DEFAULT_TILE_PROVIDER.minZoom,
        DEFAULT_TILE_PROVIDER.maxZoom
    );
    const worldBounds = resolveTileWorldBounds(points, zoom);
    const tileLayer = document.createElement("div");
    tileLayer.classList.add("map-view-tile-layer");

    const minTileX = Math.floor(worldBounds.minX / MAP_TILE_SIZE);
    const maxTileX = Math.floor(worldBounds.maxX / MAP_TILE_SIZE);
    const minTileY = Math.floor(worldBounds.minY / MAP_TILE_SIZE);
    const maxTileY = Math.floor(worldBounds.maxY / MAP_TILE_SIZE);

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
            const tileImage = createTileImage(tileX, tileY, zoom, worldBounds);
            if (tileImage) {
                tileLayer.appendChild(tileImage);
            }
        }
    }

    return { tileLayer, worldBounds, zoom };
}

// Creates a multilingual-ready status summary for the map view.
function createMapStatus(points, rowCount) {
    const status = document.createElement("div");
    status.classList.add("map-view-status");

    const label = document.createElement("span");
    label.dataset.langKey = "map_view_locations_found";
    label.textContent = "Locations found";

    const count = document.createElement("strong");
    count.textContent = `${points.length}/${rowCount}`;

    status.append(label, count);

    const missingCount = Math.max(0, rowCount - points.length);
    if (missingCount > 0) {
        const missing = document.createElement("span");
        missing.classList.add("map-view-status__missing");
        missing.dataset.langKey = "map_view_locations_missing";
        missing.textContent = `${missingCount} without coordinates`;
        status.appendChild(missing);
    }

    return status;
}

// Creates the empty state shown when no coordinates can be inferred.
function createEmptyState() {
    const emptyState = document.createElement("div");
    emptyState.classList.add("map-view-empty");

    const title = document.createElement("h2");
    title.dataset.langKey = "map_view_no_coordinates_title";
    title.textContent = "No coordinates found";

    const body = document.createElement("p");
    body.dataset.langKey = "map_view_no_coordinates_body";
    body.textContent = "Add latitude/longitude columns or a POINT/JSON position field to show rows on the map.";

    emptyState.append(title, body);
    return emptyState;
}

// Creates a single marker button for the tile map.
function createMarkerButton(point, pointNumber, tileLayout, columns, selectRow, readDisplayValue) {
    const markerPosition = resolveWorldPixelPercent(
        projectCoordinateToWorldPixel(point, tileLayout.zoom),
        tileLayout.worldBounds
    );
    const marker = document.createElement("button");
    marker.type = "button";
    marker.classList.add("map-view-marker-button");
    marker.dataset.rowIndex = String(point.rowIndex);
    marker.style.left = `${markerPosition.xPercent}%`;
    marker.style.top = `${markerPosition.yPercent}%`;
    marker.textContent = String(pointNumber);

    const rowLabel = resolveRowLabel(point.row, columns, point.rowIndex, readDisplayValue);
    marker.title = `${rowLabel}: ${formatCoordinateValue(point.latitude)}, ${formatCoordinateValue(point.longitude)}`;
    marker.setAttribute("aria-label", marker.title);
    marker.setAttribute("aria-pressed", "false");
    marker.addEventListener("click", () => selectRow(point.rowIndex));
    return marker;
}

// Creates the plotting surface and places every coordinate marker on it.
function createMapPlane(points, columns, selectRow, readDisplayValue) {
    const plane = document.createElement("div");
    plane.classList.add("map-view-plane", "map-view-plane--tile");
    plane.dataset.mapProvider = DEFAULT_TILE_PROVIDER.label;
    const tileLayout = createTileLayer(points);
    plane.appendChild(tileLayout.tileLayer);

    const planeLabel = document.createElement("div");
    planeLabel.classList.add("map-view-plane-label");
    planeLabel.dataset.langKey = "map_view_tile_plane_status";
    planeLabel.textContent = `${DEFAULT_TILE_PROVIDER.label} map`;
    plane.appendChild(planeLabel);

    points.forEach((point, index) => {
        plane.appendChild(createMarkerButton(
            point,
            index + 1,
            tileLayout,
            columns,
            selectRow,
            readDisplayValue
        ));
    });

    const attribution = document.createElement("a");
    attribution.classList.add("map-view-attribution");
    attribution.href = "https://www.openstreetmap.org/copyright";
    attribution.rel = "noreferrer";
    attribution.target = "_blank";
    attribution.textContent = DEFAULT_TILE_PROVIDER.attribution;
    plane.appendChild(attribution);

    return plane;
}

// Creates key/value preview chips for a row in the coordinate list.
function createRowValuePreview(row, columns, readDisplayValue) {
    const values = document.createElement("div");
    values.classList.add("map-view-row-values");
    const previewColumns = Array.isArray(columns) && columns.length > 0
        ? columns
        : Object.keys(row || {});

    previewColumns.forEach((column) => {
        const rawValue = row[column];
        if (rawValue == null || rawValue === "") {
            return;
        }

        const valueItem = document.createElement("span");
        valueItem.classList.add("map-view-row-value");

        const valueKey = document.createElement("span");
        valueKey.classList.add("map-view-row-value-key");
        valueKey.textContent = String(column);

        const valueText = document.createElement("span");
        valueText.classList.add("map-view-row-value-text");
        valueText.textContent = readDisplayValue(row, column);

        valueItem.append(valueKey, valueText);
        values.appendChild(valueItem);
    });

    return values;
}

// Creates one row button for the side list and wires it to marker selection.
function createMapListRow(point, columns, selectRow, readDisplayValue) {
    const rowItem = document.createElement("li");
    rowItem.classList.add("map-view-row-item");

    const rowButton = document.createElement("button");
    rowButton.type = "button";
    rowButton.classList.add("map-view-row-button");
    rowButton.dataset.rowIndex = String(point.rowIndex);
    rowButton.setAttribute("aria-pressed", "false");
    rowButton.addEventListener("click", () => selectRow(point.rowIndex));

    const rowTitle = document.createElement("span");
    rowTitle.classList.add("map-view-row-title");
    rowTitle.textContent = resolveRowLabel(
        point.row,
        columns,
        point.rowIndex,
        readDisplayValue
    );

    const coordinateLine = document.createElement("span");
    coordinateLine.classList.add("map-view-row-coordinate");
    coordinateLine.textContent = `${formatCoordinateValue(point.latitude)}, ${formatCoordinateValue(point.longitude)}`;

    const sourceLine = document.createElement("span");
    sourceLine.classList.add("map-view-row-source");

    const sourceLabel = document.createElement("span");
    sourceLabel.dataset.langKey = "map_view_source_column";
    sourceLabel.textContent = "Source";

    const sourceValue = document.createElement("span");
    sourceValue.textContent = point.sourceLabel;

    sourceLine.append(sourceLabel, sourceValue);
    rowButton.append(
        rowTitle,
        coordinateLine,
        sourceLine,
        createRowValuePreview(point.row, columns, readDisplayValue)
    );
    rowItem.appendChild(rowButton);
    return rowItem;
}

// Creates the side list containing all rows that resolved to coordinates.
function createMapList(points, rowsWithoutCoordinates, columns, selectRow, readDisplayValue) {
    const listShell = document.createElement("aside");
    listShell.classList.add("map-view-list-shell");

    const heading = document.createElement("h2");
    heading.dataset.langKey = "map_view_row_list";
    heading.textContent = "Rows with coordinates";

    const list = document.createElement("ul");
    list.classList.add("map-view-row-list");
    points.forEach((point) => {
        list.appendChild(createMapListRow(point, columns, selectRow, readDisplayValue));
    });

    listShell.append(heading, list);
    if (rowsWithoutCoordinates.length > 0) {
        listShell.appendChild(createMissingRowsSection(
            rowsWithoutCoordinates,
            columns,
            readDisplayValue
        ));
    }
    return listShell;
}

// Separates rows that were returned by the dataset but could not be placed on the map.
function getRowsWithoutCoordinates(data, points) {
    const safeRows = Array.isArray(data) ? data : [];
    const mappedRowIndexes = new Set(points.map((point) => point.rowIndex));
    return safeRows
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row, rowIndex }) => row && typeof row === "object" && !mappedRowIndexes.has(rowIndex));
}

// Creates a compact disclosure for rows that remain editable/searchable but not mappable yet.
function createMissingRowsSection(rowsWithoutCoordinates, columns, readDisplayValue) {
    const details = document.createElement("details");
    details.classList.add("map-view-missing-rows");

    const summary = document.createElement("summary");
    summary.dataset.langKey = "map_view_rows_without_coordinates";
    summary.textContent = `Rows without coordinates ${rowsWithoutCoordinates.length}`;
    details.appendChild(summary);

    const list = document.createElement("ul");
    list.classList.add("map-view-missing-row-list");
    rowsWithoutCoordinates.forEach(({ row, rowIndex }) => {
        const item = document.createElement("li");
        item.textContent = resolveRowLabel(row, columns, rowIndex, readDisplayValue);
        list.appendChild(item);
    });

    details.appendChild(list);
    return details;
}

// Updates marker and list-row highlight state for the selected source row.
function syncSelectedRow(container, rowIndex) {
    container.querySelectorAll(".map-view-marker-button, .map-view-row-button").forEach((element) => {
        const isSelected = element.dataset.rowIndex === String(rowIndex);
        element.classList.toggle("map-view-is-selected", isSelected);
        element.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
}

// Renders the map table view for datasets with coordinate-bearing rows.
export function create_map_view(table_name, columns, data, data_types) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const safeRows = Array.isArray(data) ? data : [];
    const points = extract_map_points(safeColumns, data, data_types);
    const rowsWithoutCoordinates = getRowsWithoutCoordinates(safeRows, points);

    const container = document.createElement("div");
    container.classList.add("map-view");
    container.dataset.datasetName = table_name;
    if (points.length === 0) {
        container.appendChild(createEmptyState());
        return container;
    }

    let selectedRowIndex = points[0].rowIndex;
    const renderChosenLanguage = (chosenLanguage) => {
        const readDisplayValue = createMapDisplayValueReader(data_types, chosenLanguage);
        const status = createMapStatus(points, safeRows.length);
        const layout = document.createElement("div");
        layout.classList.add("map-view-layout");

        const selectRow = (rowIndex) => {
            selectedRowIndex = rowIndex;
            syncSelectedRow(container, rowIndex);
        };
        layout.append(
            createMapPlane(points, safeColumns, selectRow, readDisplayValue),
            createMapList(
                points,
                rowsWithoutCoordinates,
                safeColumns,
                selectRow,
                readDisplayValue
            )
        );
        container.replaceChildren(status, layout);
        syncSelectedRow(container, selectedRowIndex);
    };
    MAP_VIEW_LANGUAGE_RENDERERS.set(container, renderChosenLanguage);
    bindDatasetLanguageRenderer(container, renderChosenLanguage);
    return container;
}

/**
 * Refreshes active-language values in mounted maps while retaining raw rows and map state.
 * Between the language selector and map labels, previews, markers, and missing-row listings.
 * Avoids refetching dataset rows while preserving the selected map row.
 * @param {string} chosenLanguage
 * @param {ParentNode} root
 * @returns {Promise<number>} refreshed map count
 */
export async function refresh_mounted_map_view_languages(chosenLanguage, root = document) {
    let refreshedCount = 0;
    for (const container of root.querySelectorAll('.map-view')) {
        const renderer = MAP_VIEW_LANGUAGE_RENDERERS.get(container);
        if (!renderer) continue;
        await renderer(chosenLanguage);
        refreshedCount += 1;
    }
    return refreshedCount;
}
