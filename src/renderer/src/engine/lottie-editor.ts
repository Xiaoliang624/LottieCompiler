type JsonObject = Record<string, unknown>;

export type LottieEditOperation =
  | {
      type: 'animateTransform';
      target: { ind?: number; name?: string };
      property: 'position' | 'scale' | 'rotation' | 'opacity' | 'anchorPoint';
      keyframes: Array<{ frame: number; value: unknown; easing?: unknown }>;
    }
  | {
      type: 'animateShapePath';
      target: { ind?: number; name?: string };
      shapeIndex?: number;
      fixedVertices?: number[];
      keyframes: Array<{ frame: number; offsets?: unknown; vertices?: unknown; easing?: unknown }>;
    };

export type LottieEditPatch = {
  meta?: { name?: string; durationFrames?: number };
  summary?: string;
  operations?: LottieEditOperation[];
};

export function isLottieJson(value: unknown): value is JsonObject {
  const object = asObject(value);
  return (
    typeof object.v === 'string' &&
    Array.isArray(object.layers) &&
    (typeof object.fr === 'number' || typeof object.op === 'number') &&
    (typeof object.w === 'number' || typeof object.h === 'number')
  );
}

export function summarizeLottieEditContext(lottie: object, focusText = '', limit = 80): string {
  const root = asObject(lottie);
  const layers = Array.isArray(root.layers) ? root.layers.map(asObject) : [];
  const focus = focusText.toLowerCase();
  const scored = layers
    .map((layer, index) => ({ layer, index, score: layerScore(layer, focus) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const nameCounts = lottieNameCounts(layers);
  const included = scored.slice(0, limit).map(({ layer }) => layerSummary(layer, layers, nameCounts));

  return JSON.stringify({
    canvas: {
      width: numberValue(root.w),
      height: numberValue(root.h),
      fps: numberValue(root.fr),
      inPoint: numberValue(root.ip),
      outPoint: numberValue(root.op),
      name: stringValue(root.nm),
    },
    rule: 'Use layer ind when possible. For shape path animation, keep vertex count and fixed vertices unchanged.',
    layers: included,
  });
}

export function extractLottieEditPatchFromText(text: string): LottieEditPatch {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const parsed = tryParseJson(cleaned) ?? extractJsonObjectCandidates(cleaned).map(tryParseJson).find(Boolean);
  const patch = asObject(parsed);
  const operations = Array.isArray(patch.operations) ? patch.operations : [];
  if (!operations.length) throw new Error('AI 没有返回可执行的 Lottie 修改操作。');
  return patch as LottieEditPatch;
}

export function applyLottieEditPatch(lottie: object, patch: LottieEditPatch): { lottie: object; summary: string } {
  const output = clone(lottie) as JsonObject;
  const operations = Array.isArray(patch.operations) ? patch.operations : [];
  const changes: string[] = [];

  const meta = asObject(output.meta);
  output.meta = {
    ...meta,
    editedBy: 'Lottie Compiler AI',
    editSummary: typeof patch.summary === 'string' ? patch.summary : undefined,
  };
  if (patch.meta?.name) output.nm = patch.meta.name;
  if (patch.meta?.durationFrames && Number.isFinite(patch.meta.durationFrames)) output.op = patch.meta.durationFrames;

  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') continue;
    if (operation.type === 'animateTransform') {
      const change = applyTransformOperation(output, operation);
      if (change) changes.push(change);
    }
    if (operation.type === 'animateShapePath') {
      const change = applyShapePathOperation(output, operation);
      if (change) changes.push(change);
    }
  }

  if (!changes.length) throw new Error('AI 返回了操作，但没有匹配到可修改的 Lottie 图层。');
  return {
    lottie: output,
    summary: [patch.summary, ...changes].filter(Boolean).join('\n'),
  };
}

export function lottieEditFallback(lottie: object, prompt: string): { lottie: object; summary: string } {
  const output = clone(lottie) as JsonObject;
  const layers = Array.isArray(output.layers) ? output.layers.map(asObject) : [];
  const duration = Math.max(1, Math.round(numberValue(output.op) ?? 120));
  const lower = prompt.toLowerCase();
  const changes: string[] = [];

  const tail = findLayer(layers, ['尾巴', 'tail']);
  if (tail && (lower.includes('尾') || lower.includes('tail') || lower.includes('宠物') || lower.includes('睡'))) {
    const shape = firstShapePath(tail);
    if (shape) {
      const base = asObject(asObject(shape.ks).k);
      const rootIndex = 0;
      shape.ks = animatedPath([
        { t: 0, v: offsetPath(base, []) },
        { t: Math.round(duration * 0.58), v: offsetPath(base, [[0, 0], [2.2, 1.6], [4.8, -1.2], [1.6, -0.6]], [rootIndex]) },
        { t: duration - 1, v: offsetPath(base, []) },
      ]);
      setStatic(tail, 'r', 0);
      changes.push(`尾巴：固定根部顶点，只让尾端做柔缓摆动。`);
    }
  }

  const drool = findLayer(layers, ['口水', 'drool', 'saliva']);
  if (drool && (lower.includes('口水') || lower.includes('drool') || lower.includes('睡'))) {
    const shape = firstShapePath(drool);
    if (shape) {
      const base = asObject(asObject(shape.ks).k);
      shape.ks = animatedPath([
        { t: 0, v: offsetPath(base, []) },
        { t: Math.round(duration * 0.58), v: offsetPath(base, [[0, 0], [0.35, 2.1], [0.2, 3.1], [-0.25, 6.4], [0, 0]], [0, 4]) },
        { t: duration - 1, v: offsetPath(base, []) },
      ]);
      setStatic(drool, 'o', 100);
      changes.push(`口水：固定嘴角连接点，让下方水滴缓慢拉长并收回。`);
    }
  }

  const body = findLayer(layers, ['身体', 'body']);
  if (body) {
    const position = getStaticVector(body, 'p');
    if (position) {
      setAnimated(body, 'p', animatedVector([
        { t: 0, v: position },
        { t: Math.round(duration * 0.35), v: [position[0], position[1] - 1.2, position[2] ?? 0] },
        { t: duration - 1, v: position },
      ]));
      setAnimated(body, 's', animatedVector([
        { t: 0, v: [100, 100, 100] },
        { t: Math.round(duration * 0.35), v: [99.6, 100.9, 100] },
        { t: duration - 1, v: [100, 100, 100] },
      ]));
      changes.push(`身体：加入轻微呼吸起伏。`);
    }
  }

  output.meta = { ...asObject(output.meta), editedBy: 'Lottie Compiler AI fallback' };
  if (!changes.length) throw new Error('未找到适合自动编辑的 Lottie 图层。');
  return { lottie: output, summary: changes.join('\n') };
}

function applyTransformOperation(lottie: JsonObject, operation: Extract<LottieEditOperation, { type: 'animateTransform' }>): string | null {
  const layer = findTargetLayer(lottie, operation.target);
  if (!layer || !Array.isArray(operation.keyframes) || operation.keyframes.length < 2) return null;
  const propertyMap = { position: 'p', scale: 's', rotation: 'r', opacity: 'o', anchorPoint: 'a' } as const;
  const key = propertyMap[operation.property];
  const scalar = operation.property === 'rotation' || operation.property === 'opacity';
  setAnimated(layer, key, scalar ? animatedScalar(normalizeKeyframes(operation.keyframes)) : animatedVector(normalizeVectorKeyframes(operation.keyframes)));
  return `${layerName(layer)}：添加 ${operation.property} 关键帧动画。`;
}

function applyShapePathOperation(lottie: JsonObject, operation: Extract<LottieEditOperation, { type: 'animateShapePath' }>): string | null {
  const layer = findTargetLayer(lottie, operation.target);
  const shape = layer ? shapePathAt(layer, operation.shapeIndex ?? 0) : null;
  const base = asObject(asObject(shape?.ks).k);
  if (!layer || !shape || !Array.isArray(base.v) || !Array.isArray(operation.keyframes) || operation.keyframes.length < 2) return null;

  const fixed = Array.isArray(operation.fixedVertices) ? operation.fixedVertices : [];
  const frames = operation.keyframes
    .map((frame) => {
      const frameNumber = Math.max(0, Math.round(numberValue(frame.frame) ?? 0));
      const path = frame.vertices ? pathFromVertices(base, frame.vertices, fixed) : offsetPath(base, normalizeOffsets(frame.offsets), fixed);
      return { t: frameNumber, v: path, easing: frame.easing };
    })
    .filter((frame) => samePathStructure(base, frame.v))
    .sort((a, b) => a.t - b.t);
  if (frames.length < 2) return null;
  shape.ks = animatedPath(frames);
  return `${layerName(layer)}：添加路径顶点动画，固定顶点 ${fixed.length ? fixed.join(', ') : '无'}。`;
}

function layerSummary(layer: JsonObject, layers: JsonObject[], nameCounts: Map<string, number>): JsonObject {
  const paths = shapePathSummaries(layer);
  return {
    ind: numberValue(layer.ind),
    name: stringValue(layer.nm),
    duplicateNameCount: nameCounts.get(stringValue(layer.nm)) ?? 0,
    parent: numberValue(layer.parent),
    parentName: parentName(layer, layers),
    type: numberValue(layer.ty),
    transform: asObject(layer.ks),
    paths: paths.length ? paths : undefined,
  };
}

function shapePathSummaries(layer: JsonObject): JsonObject[] {
  const paths: JsonObject[] = [];
  let current = 0;
  function walk(items: unknown) {
    if (!Array.isArray(items)) return;
    for (const item of items.map(asObject)) {
      if (item.ty === 'sh') {
        const pathValue = asObject(asObject(item.ks).k);
        if (Array.isArray(pathValue.v)) {
          const vertices = pathValue.v.map(pointValue).filter((point): point is number[] => Boolean(point));
          paths.push({
            shapeIndex: current,
            name: stringValue(item.nm),
            vertexCount: vertices.length,
            closed: pathValue.c,
            vertexIndexRule: 'offsets and fixedVertices use zero-based vertex indexes from indexedVertices.',
            indexedVertices: indexedVertices(vertices),
            bounds: pathBounds(vertices),
            extremeVertexIndexes: extremeVertexIndexes(vertices),
            v: pathValue.v.slice(0, 12),
            i: Array.isArray(pathValue.i) ? pathValue.i.slice(0, 12) : undefined,
            o: Array.isArray(pathValue.o) ? pathValue.o.slice(0, 12) : undefined,
            truncated: pathValue.v.length > 12,
          });
        }
        current += 1;
      }
      walk(item.it);
    }
  }
  walk(layer.shapes);
  return paths;
}

function indexedVertices(vertices: number[][]): JsonObject[] {
  return vertices.slice(0, 16).map((point, index) => ({
    index,
    x: round(point[0] ?? 0),
    y: round(point[1] ?? 0),
  }));
}

function pathBounds(vertices: number[][]): JsonObject | undefined {
  if (!vertices.length) return undefined;
  const xs = vertices.map((point) => point[0] ?? 0);
  const ys = vertices.map((point) => point[1] ?? 0);
  return {
    minX: round(Math.min(...xs)),
    maxX: round(Math.max(...xs)),
    minY: round(Math.min(...ys)),
    maxY: round(Math.max(...ys)),
  };
}

function extremeVertexIndexes(vertices: number[][]): JsonObject | undefined {
  if (!vertices.length) return undefined;
  return {
    left: extremeIndex(vertices, (point) => point[0] ?? 0, Math.min),
    right: extremeIndex(vertices, (point) => point[0] ?? 0, Math.max),
    top: extremeIndex(vertices, (point) => point[1] ?? 0, Math.min),
    bottom: extremeIndex(vertices, (point) => point[1] ?? 0, Math.max),
  };
}

function extremeIndex(vertices: number[][], value: (point: number[]) => number, choose: (...values: number[]) => number): number {
  const values = vertices.map(value);
  const selected = choose(...values);
  return values.findIndex((item) => item === selected);
}

function parentName(layer: JsonObject, layers: JsonObject[]): string {
  const parent = numberValue(layer.parent);
  if (parent === null) return '';
  return stringValue(layers.find((item) => numberValue(item.ind) === parent)?.nm);
}

function lottieNameCounts(layers: JsonObject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const layer of layers) {
    const name = stringValue(layer.nm);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function layerScore(layer: JsonObject, focus: string): number {
  if (!focus) return 0;
  const haystack = `${stringValue(layer.nm)} ${numberValue(layer.ind) ?? ''}`.toLowerCase();
  return focus.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean).reduce((score, word) => score + (haystack.includes(word) ? 10 : 0), 0);
}

function findTargetLayer(lottie: JsonObject, target: { ind?: number; name?: string }): JsonObject | null {
  const layers = Array.isArray(lottie.layers) ? lottie.layers.map(asObject) : [];
  const ind = numberValue(target.ind);
  if (ind !== null) {
    const layer = layers.find((item) => numberValue(item.ind) === ind);
    if (layer) return layer;
  }
  const name = stringValue(target.name).toLowerCase();
  return name ? layers.find((item) => stringValue(item.nm).toLowerCase() === name) ?? null : null;
}

function findLayer(layers: JsonObject[], names: string[]): JsonObject | null {
  const lowerNames = names.map((name) => name.toLowerCase());
  return layers.find((layer) => lowerNames.some((name) => stringValue(layer.nm).toLowerCase().includes(name))) ?? null;
}

function firstShapePath(layer: JsonObject): JsonObject | null {
  return shapePathAt(layer, 0);
}

function shapePathAt(layer: JsonObject, targetIndex: number): JsonObject | null {
  let current = 0;
  function walk(items: unknown): JsonObject | null {
    if (!Array.isArray(items)) return null;
    for (const item of items.map(asObject)) {
      if (item.ty === 'sh') {
        if (current === targetIndex) return item;
        current += 1;
      }
      const found = walk(item.it);
      if (found) return found;
    }
    return null;
  }
  return walk(layer.shapes);
}

function setAnimated(layer: JsonObject, key: string, value: JsonObject) {
  const ks = asObject(layer.ks);
  ks[key] = value;
  layer.ks = ks;
}

function setStatic(layer: JsonObject, key: string, value: unknown) {
  const ks = asObject(layer.ks);
  ks[key] = { a: 0, k: value };
  layer.ks = ks;
}

function getStaticVector(layer: JsonObject, key: string): number[] | null {
  const prop = asObject(asObject(layer.ks)[key]);
  return pointValue(prop.k);
}

function animatedScalar(frames: Array<{ t: number; v: number; easing?: unknown }>): JsonObject {
  return buildAnimated(frames, (value) => [value]);
}

function animatedVector(frames: Array<{ t: number; v: number[]; easing?: unknown }>): JsonObject {
  return buildAnimated(frames, (value) => value);
}

function animatedPath(frames: Array<{ t: number; v: JsonObject; easing?: unknown }>): JsonObject {
  return buildAnimated(frames, (value) => [value]);
}

function buildAnimated<T>(frames: Array<{ t: number; v: T; easing?: unknown }>, wrap: (value: T) => unknown): JsonObject {
  const sorted = frames.sort((a, b) => a.t - b.t);
  return {
    a: 1,
    k: sorted.map((frame, index) => {
      const item: JsonObject = { t: frame.t, s: wrap(frame.v) };
      if (index < sorted.length - 1) {
        item.e = wrap(sorted[index + 1].v);
        Object.assign(item, easing(frame.easing));
      }
      return item;
    }),
  };
}

function normalizeKeyframes(keyframes: Array<{ frame: number; value: unknown; easing?: unknown }>): Array<{ t: number; v: number; easing?: unknown }> {
  return keyframes
    .map((frame) => ({ t: Math.max(0, Math.round(numberValue(frame.frame) ?? 0)), v: numberValue(frame.value) ?? 0, easing: frame.easing }))
    .sort((a, b) => a.t - b.t);
}

function normalizeVectorKeyframes(keyframes: Array<{ frame: number; value: unknown; easing?: unknown }>): Array<{ t: number; v: number[]; easing?: unknown }> {
  return keyframes
    .map((frame) => ({ t: Math.max(0, Math.round(numberValue(frame.frame) ?? 0)), v: pointValue(frame.value) ?? [0, 0, 0], easing: frame.easing }))
    .sort((a, b) => a.t - b.t);
}

function normalizeOffsets(value: unknown): number[][] {
  return Array.isArray(value) ? value.map((item) => pointValue(item) ?? [0, 0]) : [];
}

function pathFromVertices(base: JsonObject, vertices: unknown, fixed: number[]): JsonObject {
  const output = clone(base) as JsonObject;
  const baseVertices = Array.isArray(base.v) ? base.v.map(pointValue) : [];
  const nextVertices = Array.isArray(vertices) ? vertices.map(pointValue) : [];
  output.v = baseVertices.map((point, index) => fixed.includes(index) ? point : (nextVertices[index] ?? point));
  return output;
}

function offsetPath(base: JsonObject, offsets: number[][], fixed: number[] = []): JsonObject {
  const output = clone(base) as JsonObject;
  const vertices = Array.isArray(base.v) ? base.v.map(pointValue) : [];
  output.v = vertices.map((point, index) => {
    const offset = fixed.includes(index) ? [0, 0] : offsets[index] ?? [0, 0];
    return [round((point?.[0] ?? 0) + offset[0]), round((point?.[1] ?? 0) + offset[1])];
  });
  return output;
}

function samePathStructure(a: JsonObject, b: JsonObject): boolean {
  return (
    Array.isArray(a.v) &&
    Array.isArray(b.v) &&
    Array.isArray(a.i) &&
    Array.isArray(b.i) &&
    Array.isArray(a.o) &&
    Array.isArray(b.o) &&
    a.v.length === b.v.length &&
    a.i.length === b.i.length &&
    a.o.length === b.o.length &&
    Boolean(a.c) === Boolean(b.c)
  );
}

function easing(value: unknown): JsonObject {
  const object = asObject(value);
  const out = pointValue(object.out) ?? [0.28, 0];
  const input = pointValue(object.in) ?? [0.72, 1];
  return {
    o: { x: [out[0]], y: [out[1]] },
    i: { x: [input[0]], y: [input[1]] },
  };
}

function pointValue(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = numberValue(value[0]);
    const y = numberValue(value[1]);
    if (x === null || y === null) return null;
    const z = numberValue(value[2]);
    return z === null ? [x, y] : [x, y, z];
  }
  const object = asObject(value);
  const x = numberValue(object.x ?? object[0]);
  const y = numberValue(object.y ?? object[1]);
  const z = numberValue(object.z ?? object[2]);
  if (x === null || y === null) return null;
  return z === null ? [x, y] : [x, y, z];
}

function layerName(layer: JsonObject): string {
  return `${stringValue(layer.nm) || '图层'}${numberValue(layer.ind) !== null ? ` #${numberValue(layer.ind)}` : ''}`;
}

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObjectCandidates(text: string): string[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '{') starts.push(i);
  const candidates: string[] = [];
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = !inString;
      else if (!inString && ch === '{') depth += 1;
      else if (!inString && ch === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return candidates;
}
