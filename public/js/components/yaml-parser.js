// FortunaPanel - Minimal YAML Parser for Minecraft configs
// Handles: nested objects via indentation, strings, numbers, booleans, simple lists

/**
 * Parse a YAML string into a nested JS object.
 * @param {string} text - Raw YAML content
 * @returns {object}
 */
export function parseYaml(text) {
    const lines = text.split('\n');
    const root = {};
    const stack = [{ indent: -1, obj: root }];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trimEnd();

        // Skip empty lines and comments
        if (!trimmed || trimmed.trimStart().startsWith('#')) continue;

        const indent = raw.search(/\S/);
        const content = trimmed.trimStart();

        // List item (- value)
        if (content.startsWith('- ')) {
            const parent = getParent(stack, indent);
            const lastKey = getLastKey(stack, indent);
            if (lastKey && parent && Array.isArray(parent[lastKey])) {
                parent[lastKey].push(parseValue(content.slice(2).trim()));
            }
            continue;
        }

        const colonIdx = content.indexOf(':');
        if (colonIdx === -1) continue;

        const key = content.slice(0, colonIdx).trim();
        const valueStr = content.slice(colonIdx + 1).trim();

        // Pop stack to find parent at correct indent level
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].obj;

        if (valueStr === '' || valueStr === '{}') {
            // Check next line to determine if list or object
            const nextLine = lines[i + 1] || '';
            const nextTrimmed = nextLine.trimStart();
            if (nextTrimmed.startsWith('- ')) {
                parent[key] = [];
            } else {
                parent[key] = {};
            }
            stack.push({ indent, obj: parent[key], key });
        } else {
            parent[key] = parseValue(valueStr);
        }
    }

    return root;
}

/**
 * Stringify an object back to YAML, preserving original comments and order.
 * @param {object} obj - The data to write
 * @param {string} originalText - Original YAML to preserve comments/ordering
 * @returns {string}
 */
export function stringifyYaml(obj, originalText) {
    if (!originalText) return simpleStringify(obj, 0);

    const lines = originalText.split('\n');
    const result = [];
    const flatOriginal = flattenYaml(originalText);
    const flatNew = flattenObject(obj);

    for (const line of lines) {
        const trimmed = line.trimEnd();
        const content = trimmed.trimStart();

        // Preserve comments and empty lines
        if (!content || content.startsWith('#')) {
            result.push(line);
            continue;
        }

        // List items — pass through
        if (content.startsWith('- ')) {
            result.push(line);
            continue;
        }

        const colonIdx = content.indexOf(':');
        if (colonIdx === -1) {
            result.push(line);
            continue;
        }

        const key = content.slice(0, colonIdx).trim();
        const valueStr = content.slice(colonIdx + 1).trim();
        const indent = line.search(/\S/);

        // Find the flat key path for this line
        const flatKey = findFlatKey(lines, result.length, key, indent);

        if (flatKey && flatNew.hasOwnProperty(flatKey)) {
            const newVal = flatNew[flatKey];
            if (valueStr === '' || valueStr === '{}') {
                // Section header — keep as-is
                result.push(line);
            } else {
                const prefix = line.slice(0, line.indexOf(key)) + key + ': ';
                result.push(prefix + formatValue(newVal));
            }
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

function parseValue(str) {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null' || str === '~') return null;
    if (/^-?\d+$/.test(str)) return parseInt(str, 10);
    if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
    // Remove quotes
    if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
        return str.slice(1, -1);
    }
    return str;
}

function formatValue(val) {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') {
        if (val.includes(':') || val.includes('#') || val.includes('{') || val.includes('}') ||
            val.includes('[') || val.includes(']') || val === '' || val.startsWith(' ') || val.endsWith(' ')) {
            return `'${val}'`;
        }
        return val;
    }
    return String(val);
}

function getParent(stack, indent) {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].indent < indent) return stack[i].obj;
    }
    return stack[0].obj;
}

function getLastKey(stack, indent) {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].indent < indent && stack[i].key) return stack[i].key;
    }
    return null;
}

function flattenObject(obj, prefix = '') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(result, flattenObject(val, fullKey));
        } else {
            result[fullKey] = val;
        }
    }
    return result;
}

function flattenYaml(text) {
    const obj = parseYaml(text);
    return flattenObject(obj);
}

function findFlatKey(lines, currentIdx, key, indent) {
    // Build path by looking at parent indentation levels
    const parts = [key];
    for (let i = currentIdx - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || !line.trim() || line.trimStart().startsWith('#')) continue;
        const lineIndent = line.search(/\S/);
        if (lineIndent < indent) {
            const colonIdx = line.trimStart().indexOf(':');
            if (colonIdx > 0) {
                parts.unshift(line.trimStart().slice(0, colonIdx).trim());
                indent = lineIndent;
            }
        }
        if (lineIndent === 0) break;
    }
    return parts.join('.');
}

function simpleStringify(obj, indent) {
    const spaces = ' '.repeat(indent);
    let result = '';
    for (const [key, val] of Object.entries(obj)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result += `${spaces}${key}:\n${simpleStringify(val, indent + 2)}`;
        } else if (Array.isArray(val)) {
            result += `${spaces}${key}:\n`;
            for (const item of val) {
                result += `${spaces}  - ${formatValue(item)}\n`;
            }
        } else {
            result += `${spaces}${key}: ${formatValue(val)}\n`;
        }
    }
    return result;
}
