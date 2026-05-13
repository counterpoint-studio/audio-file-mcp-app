const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ["'", "'"],
    ['"', '"'],
    ["`", "`"],
    ["‘", "’"],
    ["“", "”"],
    ["‚", "’"],
    ["„", "”"],
];

function stripSurroundingQuotes(s: string): string {
    if (s.length < 2) return s;
    const first = s[0];
    const last = s[s.length - 1];
    for (const [open, close] of QUOTE_PAIRS) {
        if (first === open && last === close) {
            return s.slice(1, -1);
        }
    }
    return s;
}

function stripFileScheme(s: string): string {
    const match = /^file:\/\/(.*)$/i.exec(s);
    if (!match) return s;
    let rest = match[1];
    try {
        rest = decodeURIComponent(rest);
    } catch {
        // Leave undecodable input as-is rather than throwing.
    }
    // file:///C:/... → C:/...  (Windows-style absolute path)
    const winMatch = /^\/([A-Za-z]:[\/\\].*)$/.exec(rest);
    if (winMatch) return winMatch[1];
    return rest;
}

export function normalizeIncomingPath(raw: string): string {
    let current = raw;
    // Loop until a pass changes nothing — handles nested wrappers
    // like `  ' "/path" '  ` and `file://` wrapped in quotes.
    for (let i = 0; i < 8; i++) {
        const before = current;
        current = current.trim();
        current = stripSurroundingQuotes(current);
        current = stripFileScheme(current);
        if (current === before) break;
    }
    return current;
}
