const MAX_JSON_SCAN_LENGTH = 50000;

export function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractJsonObjectCandidates(text: string, maxLength = MAX_JSON_SCAN_LENGTH): string[] {
  const source = text.slice(0, maxLength);
  const candidates: string[] = [];

  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(source.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }

  return Array.from(new Set(candidates));
}

export function cloneJsonData<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
