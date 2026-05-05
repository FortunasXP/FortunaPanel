// FortunaPanel - Minimal TOML Parser for Velocity config
// Handles: [sections], key = value, strings, numbers, booleans, arrays

/**
 * Parse a TOML string into a nested JS object.
 * @param {string} text - Raw TOML content
 * @returns {object}
 */
export function parseToml(text) {
    const root = {};
    let current = root;
    const lines = text.split('\n');

    for (const raw of lines) {
        const trimmed = raw.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Section header [section] or [section.subsection]
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            const parts = sectionMatch[1].split('.');
            current = root;
            for (const part of parts) {
                const key = part.trim().replace(/^"|"$/g, '');
                if (!current[key]) current[key] = {};
                current = current[key];
            }
            continue;
        }

        // Key-value pair
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const key = trimmed.slice(0, eqIdx).trim().replace(/^"|"$/g, '');
        const valueStr = trimmed.slice(eqIdx + 1).trim();

        current[key] = parseTomlValue(valueStr);
    }

    return root;
}

/**
 * Stringify an object back to TOML, preserving original comments and order.
 * @param {object} obj - The data to write
 * @param {string} originalText - Original TOML to preserve comments/ordering
 * @returns {string}
 */
export function stringifyToml(obj, originalText) {
    if (!originalText) return simpleTomlStringify(obj);

    const lines = originalText.split('\n');
    const result = [];
    const flatNew = flattenToml(obj);
    let currentSection = '';

    for (const line of lines) {
        const trimmed = line.trim();

        // Preserve comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            result.push(line);
            continue;
        }

        // Section header
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            result.push(line);
            continue;
        }

        // Key-value pair
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
            result.push(line);
            continue;
        }

        const key = trimmed.slice(0, eqIdx).trim().replace(/^"|"$/g, '');
        const flatKey = currentSection ? `${currentSection}.${key}` : key;

        if (flatNew.hasOwnProperty(flatKey)) {
            const indent = line.match(/^(\s*)/)[1];
            result.push(`${indent}${key} = ${formatTomlValue(flatNew[flatKey])}`);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

function parseTomlValue(str) {
    // Boolean
    if (str === 'true') return true;
    if (str === 'false') return false;

    // String (quoted)
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        return str.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // Array
    if (str.startsWith('[')) {
        try {
            return JSON.parse(str.replace(/'/g, '"'));
        } catch {
            // Simple array parsing fallback
            const inner = str.slice(1, -1).trim();
            if (!inner) return [];
            return inner.split(',').map(s => parseTomlValue(s.trim()));
        }
    }

    // Number
    if (/^-?\d+$/.test(str)) return parseInt(str, 10);
    if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);

    return str;
}

function formatTomlValue(val) {
    if (val === null || val === undefined) return '""';
    if (typeof val === 'boolean') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    if (Array.isArray(val)) {
        return '[' + val.map(v => formatTomlValue(v)).join(', ') + ']';
    }
    return `"${String(val)}"`;
}

function flattenToml(obj, prefix = '') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(result, flattenToml(val, fullKey));
        } else {
            result[fullKey] = val;
        }
    }
    return result;
}

function simpleTomlStringify(obj, prefix = '') {
    let result = '';
    const simple = {};
    const sections = {};

    for (const [key, val] of Object.entries(obj)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            sections[key] = val;
        } else {
            simple[key] = val;
        }
    }

    // Write simple key-values first
    for (const [key, val] of Object.entries(simple)) {
        result += `${key} = ${formatTomlValue(val)}\n`;
    }

    // Write sections
    for (const [section, obj] of Object.entries(sections)) {
        const sectionPath = prefix ? `${prefix}.${section}` : section;
        result += `\n[${sectionPath}]\n`;
        result += simpleTomlStringify(obj, sectionPath);
    }

    return result;
}
