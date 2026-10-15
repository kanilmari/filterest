// map_coordinates.js
// Infers map coordinates and capability from dataset rows and schema.
// Connects the map renderer and view selection without DOM dependencies.
// Keeps coordinate parsing independent of presentation and heading semantics.

const COORDINATE_NUMBER_PATTERN = "[+-]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eE][+-]?\\d+)?";
const LATITUDE_COLUMN_ALIASES = ["latitude", "lat", "y"];
const LONGITUDE_COLUMN_ALIASES = ["longitude", "lng", "lon", "x"];
const COORDINATE_COLUMN_PAIRS = [
    { latAliases: ["latitude"], lngAliases: ["longitude"] },
    { latAliases: ["lat"], lngAliases: ["lon"] },
    { latAliases: ["lat"], lngAliases: ["lng"] },
    { latAliases: ["y"], lngAliases: ["x"] },
    { latAliases: ["latitude"], lngAliases: ["lon"] },
    { latAliases: ["latitude"], lngAliases: ["lng"] },
    { latAliases: ["lat"], lngAliases: ["longitude"] },
];
const GEOMETRY_COLUMN_HINTS = ["position", "location", "geometry", "geom", "coordinates", "coordinate"];
const EWKB_SRID_FLAG = 0x20000000;
const EWKB_TYPE_MASK = 0x1fffffff;
const WKB_POINT_TYPES = new Set([1, 1001, 2001, 3001]);
const GEOSPATIAL_DATA_TYPE_HINTS = ["geometry", "geography", "point"];

// Normalizes column names so alias matching is stable across snake_case and spacing.
function normalizeColumnName(columnName) {
    return String(columnName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Finds a column whose normalized name exactly matches one of the aliases.
export function findColumnByAliases(columns, aliases) {
    const normalizedAliases = aliases.map(normalizeColumnName);
    return columns.find((column) => normalizedAliases.includes(normalizeColumnName(column))) || null;
}

// Combines visible columns with raw row keys so hidden geometry fields can still be parsed.
export function mergeColumnsWithRowKeys(columns, row) {
    const mergedColumns = [];
    const seenColumns = new Set();
    const addColumn = (column) => {
        if (column == null) {
            return;
        }
        const columnKey = String(column);
        if (seenColumns.has(columnKey)) {
            return;
        }
        seenColumns.add(columnKey);
        mergedColumns.push(columnKey);
    };

    (Array.isArray(columns) ? columns : []).forEach(addColumn);
    Object.keys(row || {}).forEach(addColumn);
    return mergedColumns;
}

// Collects visible columns and row keys so capability checks also see hidden support fields.
function collectMapCandidateColumns(columns, data) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const safeRows = Array.isArray(data) ? data : [];
    const candidateColumns = [];
    const seenColumns = new Set();
    const addColumn = (column) => {
        if (column == null) {
            return;
        }
        const columnKey = String(column);
        if (seenColumns.has(columnKey)) {
            return;
        }
        seenColumns.add(columnKey);
        candidateColumns.push(columnKey);
    };

    safeColumns.forEach(addColumn);
    safeRows.forEach((row) => {
        if (!row || typeof row !== "object") {
            return;
        }
        Object.keys(row).forEach(addColumn);
    });
    return candidateColumns;
}

// Finds the best explicit latitude/longitude column pair for the dataset.
function findCoordinatePairColumns(columns) {
    for (const pairDefinition of COORDINATE_COLUMN_PAIRS) {
        const latitudeColumn = findColumnByAliases(columns, pairDefinition.latAliases);
        const longitudeColumn = findColumnByAliases(columns, pairDefinition.lngAliases);
        if (latitudeColumn && longitudeColumn) {
            return {
                latitudeColumn,
                longitudeColumn,
                sourceLabel: `${latitudeColumn}/${longitudeColumn}`,
            };
        }
    }
    return null;
}

// Parses a strict coordinate number while allowing comma decimals in direct cell values.
function parseCoordinateNumber(rawValue) {
    if (typeof rawValue === "number") {
        return Number.isFinite(rawValue) ? rawValue : null;
    }
    if (typeof rawValue !== "string") {
        return null;
    }

    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
        return null;
    }

    const normalizedValue = /^[+-]?\d+,\d+$/.test(trimmedValue)
        ? trimmedValue.replace(",", ".")
        : trimmedValue;
    const strictNumberPattern = new RegExp(`^${COORDINATE_NUMBER_PATTERN}$`);
    if (!strictNumberPattern.test(normalizedValue)) {
        return null;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

// Checks that candidate coordinates sit inside standard latitude/longitude ranges.
function isValidCoordinatePair(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
}

// Builds a coordinate result when explicit coordinate columns are present.
function parseCoordinatePairFromColumns(row, pairColumns) {
    if (!pairColumns) {
        return null;
    }

    const latitude = parseCoordinateNumber(row[pairColumns.latitudeColumn]);
    const longitude = parseCoordinateNumber(row[pairColumns.longitudeColumn]);
    if (!isValidCoordinatePair(latitude, longitude)) {
        return null;
    }

    return {
        latitude,
        longitude,
        sourceLabel: pairColumns.sourceLabel,
    };
}

// Parses WKT point strings in the shape POINT(lon lat), including an optional SRID prefix.
function parsePointString(rawValue) {
    if (typeof rawValue !== "string") {
        return null;
    }

    const pointPattern = new RegExp(
        `^\\s*(?:SRID=\\d+;\\s*)?POINT\\s*(?:Z|M|ZM)?\\s*\\(\\s*(${COORDINATE_NUMBER_PATTERN})\\s+(${COORDINATE_NUMBER_PATTERN})(?:\\s+${COORDINATE_NUMBER_PATTERN})?\\s*\\)\\s*$`,
        "i"
    );
    const match = rawValue.match(pointPattern);
    if (!match) {
        return null;
    }

    const longitude = parseCoordinateNumber(match[1]);
    const latitude = parseCoordinateNumber(match[2]);
    if (!isValidCoordinatePair(latitude, longitude)) {
        return null;
    }

    return { latitude, longitude };
}

// Converts PostGIS WKB/EWKB hex text into a byte buffer without accepting arbitrary text.
function parseHexBytes(rawValue) {
    if (typeof rawValue !== "string") {
        return null;
    }

    const normalizedHex = rawValue
        .trim()
        .replace(/\s+/g, "")
        .replace(/^(?:\\x|0x)/i, "");
    if (normalizedHex.length < 42 || normalizedHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalizedHex)) {
        return null;
    }

    const bytes = new Uint8Array(normalizedHex.length / 2);
    for (let index = 0; index < normalizedHex.length; index += 2) {
        bytes[index / 2] = Number.parseInt(normalizedHex.slice(index, index + 2), 16);
    }
    return bytes;
}

// Parses PostGIS POINT WKB/EWKB hex where coordinates are stored as x/y = longitude/latitude.
function parseEwkbPointHex(rawValue) {
    const bytes = parseHexBytes(rawValue);
    if (!bytes) {
        return null;
    }

    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const byteOrder = dataView.getUint8(0);
    if (byteOrder !== 0 && byteOrder !== 1) {
        return null;
    }

    const littleEndian = byteOrder === 1;
    const geometryType = dataView.getUint32(1, littleEndian);
    const geometryTypeWithoutEwkbFlags = geometryType & EWKB_TYPE_MASK;
    if (!WKB_POINT_TYPES.has(geometryTypeWithoutEwkbFlags)) {
        return null;
    }

    let coordinateOffset = 5;
    if ((geometryType & EWKB_SRID_FLAG) !== 0) {
        coordinateOffset += 4;
    }
    if (bytes.length < coordinateOffset + 16) {
        return null;
    }

    const longitude = dataView.getFloat64(coordinateOffset, littleEndian);
    const latitude = dataView.getFloat64(coordinateOffset + 8, littleEndian);
    if (!isValidCoordinatePair(latitude, longitude)) {
        return null;
    }

    return { latitude, longitude };
}

// Pulls latitude/longitude fields from an object without evaluating arbitrary text.
function parseCoordinateObject(rawValue) {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        return null;
    }

    let latitude = null;
    let longitude = null;
    for (const [key, value] of Object.entries(rawValue)) {
        const normalizedKey = normalizeColumnName(key);
        if (latitude === null && LATITUDE_COLUMN_ALIASES.includes(normalizedKey)) {
            latitude = parseCoordinateNumber(value);
        }
        if (longitude === null && LONGITUDE_COLUMN_ALIASES.includes(normalizedKey)) {
            longitude = parseCoordinateNumber(value);
        }
    }

    if (!isValidCoordinatePair(latitude, longitude)) {
        return null;
    }
    return { latitude, longitude };
}

// Extracts a numeric key from JSON-ish text such as {lat: 60.1, lng: 24.9}.
function extractJsonishCoordinateValue(rawText, aliases) {
    const keyAlternation = aliases.map(normalizeColumnName).join("|");
    const keyValuePattern = new RegExp(
        `["']?(${keyAlternation})["']?\\s*:\\s*["']?(${COORDINATE_NUMBER_PATTERN})["']?`,
        "i"
    );
    const match = rawText.match(keyValuePattern);
    return match ? parseCoordinateNumber(match[2]) : null;
}

// Safely parses strict JSON or simple JSON-like coordinate strings.
function parseCoordinateJsonishString(rawValue) {
    if (typeof rawValue !== "string") {
        return null;
    }

    const trimmedValue = rawValue.trim();
    if (!trimmedValue.startsWith("{") || !trimmedValue.endsWith("}")) {
        return null;
    }

    try {
        const parsedValue = JSON.parse(trimmedValue);
        const parsedCoordinate = parseCoordinateObject(parsedValue);
        if (parsedCoordinate) {
            return parsedCoordinate;
        }
    } catch {
        // Fall back to regex extraction below for unquoted JSON-like keys.
    }

    const latitude = extractJsonishCoordinateValue(trimmedValue, LATITUDE_COLUMN_ALIASES);
    const longitude = extractJsonishCoordinateValue(trimmedValue, LONGITUDE_COLUMN_ALIASES);
    if (!isValidCoordinatePair(latitude, longitude)) {
        return null;
    }
    return { latitude, longitude };
}

// Attempts to parse a coordinate from a single row value.
function parseCoordinateValue(rawValue) {
    return parseCoordinateObject(rawValue)
        || parsePointString(rawValue)
        || parseEwkbPointHex(rawValue)
        || parseCoordinateJsonishString(rawValue);
}

// Ranks likely geometry columns before generic row fields while preserving source order.
function getCoordinateColumnRank(column) {
    const normalizedColumn = normalizeColumnName(column);
    const exactHintIndex = GEOMETRY_COLUMN_HINTS.findIndex((hint) => normalizedColumn === hint);
    if (exactHintIndex !== -1) {
        return exactHintIndex;
    }

    const containedHintIndex = GEOMETRY_COLUMN_HINTS.findIndex((hint) => normalizedColumn.includes(hint));
    if (containedHintIndex !== -1) {
        return GEOMETRY_COLUMN_HINTS.length + containedHintIndex;
    }
    return GEOMETRY_COLUMN_HINTS.length * 2;
}

// Sorts likely geometry columns first while still allowing generic JSON coordinate fields.
function getCoordinateScanColumns(columns) {
    return [...columns]
        .map((column, index) => ({
            column,
            index,
            rank: getCoordinateColumnRank(column),
        }))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map(({ column }) => column);
}

// Searches row values for WKT or JSON-ish coordinate payloads.
function parseCoordinateFromRowValues(row, columns) {
    for (const column of getCoordinateScanColumns(columns)) {
        const coordinate = parseCoordinateValue(row[column]);
        if (coordinate) {
            return {
                ...coordinate,
                sourceLabel: column,
            };
        }
    }
    return null;
}

// Extracts renderable map points from dataset rows.
export function extract_map_points(columns, data, _data_types = {}) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const safeRows = Array.isArray(data) ? data : [];
    const points = [];

    safeRows.forEach((row, rowIndex) => {
        if (!row || typeof row !== "object") {
            return;
        }

        const rowColumns = mergeColumnsWithRowKeys(safeColumns, row);
        const pairColumns = findCoordinatePairColumns(rowColumns);
        const coordinate = parseCoordinatePairFromColumns(row, pairColumns)
            || parseCoordinateFromRowValues(row, rowColumns);
        if (!coordinate) {
            return;
        }

        points.push({
            row,
            rowIndex,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            sourceLabel: coordinate.sourceLabel,
        });
    });

    return points;
}

// Checks schema and row payloads before the map view is allowed to replace row lists.
export function dataset_supports_map_view(columns, data, data_types = {}, hasGeo = false) {
    if (hasGeo) {
        return true;
    }

    if (extract_map_points(columns, data, data_types).length > 0) {
        return true;
    }

    const candidateColumns = collectMapCandidateColumns(columns, data);
    if (findCoordinatePairColumns(candidateColumns)) {
        return true;
    }

    return Object.values(data_types || {}).some((columnInfo) => {
        const dataType = typeof columnInfo === "string"
            ? columnInfo
            : columnInfo?.data_type;
        const normalizedDataType = normalizeColumnName(dataType);
        return GEOSPATIAL_DATA_TYPE_HINTS.includes(normalizedDataType);
    });
}

