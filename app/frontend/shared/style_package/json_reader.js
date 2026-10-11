// json_reader.js
// Parses bounded JSON while refusing duplicate decoded keys and nonfinite numbers.
// Connects package text to validator.js without depending on browser storage or APIs.
// Mirrors json_reader.go because JSON.parse alone silently overwrites duplicates.

/** Read one JSON document, preserving every key until duplicate checking finishes. */
export function readStyleJSON(raw, maximumDepth) {
    let position = 0;
    const fail = () => { throw new Error('Malformed or ambiguous style JSON'); };
    const whitespace = () => { while (/[\t\n\r ]/.test(raw[position] ?? 'x')) position++; };
    const string = () => {
        const start = position++;
        while (position < raw.length) {
            const character = raw[position++];
            if (character === '\\') position++;
            else if (character === '"') return JSON.parse(raw.slice(start, position));
        }
        return fail();
    };
    const read = depth => {
        if (depth > maximumDepth) fail();
        whitespace();
        const character = raw[position];
        if (character === '"') return string();
        if (character === '{' || character === '[') {
            const object = character === '{';
            const end = object ? '}' : ']';
            const value = object ? Object.create(null) : [];
            position++;
            whitespace();
            if (raw[position] === end) { position++; return value; }
            while (position < raw.length) {
                if (object) {
                    if (raw[position] !== '"') fail();
                    const key = string();
                    if (Object.hasOwn(value, key)) fail();
                    whitespace();
                    if (raw[position++] !== ':') fail();
                    value[key] = read(depth + 1);
                } else value.push(read(depth + 1));
                whitespace();
                const separator = raw[position++];
                if (separator === end) return value;
                if (separator !== ',') fail();
                whitespace();
            }
            return fail();
        }
        const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(position));
        if (!token) fail();
        position += token[0].length;
        const value = JSON.parse(token[0]);
        if (typeof value === 'number' && !Number.isFinite(value)) fail();
        return value;
    };
    const value = read(1);
    whitespace();
    if (position !== raw.length) fail();
    return value;
}

/** Count UTF-8 bytes, including replacement bytes for isolated UTF-16 surrogates. */
export function styleJSONByteLength(raw) {
    let length = 0;
    for (const character of raw) {
        const code = character.codePointAt(0);
        length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return length;
}
