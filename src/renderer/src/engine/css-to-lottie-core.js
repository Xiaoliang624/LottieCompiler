/**
 * CSS → Lottie JSON 完整解析器 v3
 *
 * v3 修复：
 *  - 修复 "0%, 100% { ... }" 合并写法无法正确解析的问题
 *  - 修复 scale 动画关键帧丢失问题
 *  - 修复 @keyframes 块正则匹配不完整的问题
 *  - 支持 stroke（border）颜色输出为描边
 *  - 支持 keyframes 中的 background-color 和 box-shadow
 *  - 修复负 animation-delay、React/styled-components 主选择器和元素数量推断
 *
 * 使用方式：
 *   const lottie = cssToLottie(cssString, { count: 5, canvasWidth: 200, canvasHeight: 60 })
 */


// ─── 常量 ──────────────────────────────────────────────────────────────────

const EASING_MAP = {
  'linear':      { o: [0, 0],      i: [1, 1]     },
  'ease':        { o: [0.25, 0.1], i: [0.25, 1]  },
  'ease-in':     { o: [0.42, 0],   i: [1, 1]     },
  'ease-out':    { o: [0, 0],      i: [0.58, 1]  },
  'ease-in-out': { o: [0.42, 0],   i: [0.58, 1]  },
}

const CSS_NAMED_COLORS = {
  black: [0,0,0,1], white: [1,1,1,1], red: [1,0,0,1],
  blue: [0,0,1,1], green: [0,0.502,0,1], yellow: [1,1,0,1],
  orange: [1,0.647,0,1], purple: [0.502,0,0.502,1],
  pink: [1,0.753,0.796,1], gray: [0.502,0.502,0.502,1],
  grey: [0.502,0.502,0.502,1],
  transparent: [0,0,0,0],
}

const TAILWIND_ANIMATION_RULES = {
  'animate-spin': `.animate-spin { animation: tw-spin 1s linear infinite; }\n@keyframes tw-spin { to { transform: rotate(360deg); } }`,
  'animate-ping': `.animate-ping { animation: tw-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }\n@keyframes tw-ping { 75%, 100% { transform: scale(2); opacity: 0; } }`,
  'animate-pulse': `.animate-pulse { animation: tw-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }\n@keyframes tw-pulse { 50% { opacity: .5; } }`,
  'animate-bounce': `.animate-bounce { animation: tw-bounce 1s infinite; }\n@keyframes tw-bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); } 50% { transform: translateY(0); animation-timing-function: cubic-bezier(0,0,0.2,1); } }`,
}

function appendUtilityAnimationCSS(code = '') {
  const additions = Object.entries(TAILWIND_ANIMATION_RULES)
    .filter(([className]) => new RegExp(`\\b${className}\\b`).test(code))
    .map(([, css]) => css)
  return additions.length ? `${code}\n${additions.join('\n')}` : code
}

function stripCSSComments(css = '') {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitTopLevel(value = '', delimiter = ',') {
  const result = []
  let current = ''
  let depth = 0
  let quote = null

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const prev = value[i - 1]
    if (quote) {
      current += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === delimiter && depth === 0) {
      if (current.trim()) result.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }

  if (current.trim()) result.push(current.trim())
  return result
}

function tokenizeCssValue(value = '') {
  const result = []
  let current = ''
  let depth = 0
  let quote = null

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const prev = value[i - 1]
    if (quote) {
      current += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (/\s/.test(ch) && depth === 0) {
      if (current.trim()) result.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }

  if (current.trim()) result.push(current.trim())
  return result
}

function findMatchingBrace(text, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function stripNestedBlocks(block = '') {
  let out = ''
  let start = 0
  let open = block.indexOf('{')
  while (open !== -1) {
    let preludeStart = open
    while (preludeStart > start && block[preludeStart - 1] !== ';' && block[preludeStart - 1] !== '}') {
      preludeStart--
    }
    out += block.slice(start, preludeStart)
    const close = findMatchingBrace(block, open)
    if (close === -1) break
    start = close + 1
    open = block.indexOf('{', start)
  }
  out += block.slice(start)
  return out
}

function normalizeSelector(selector = '') {
  return selector.trim().replace(/\s+/g, ' ')
}

function combineSelectors(parentSelectors, childSelectors) {
  const parents = parentSelectors && parentSelectors.length ? parentSelectors : ['']
  const combined = []
  for (const parent of parents) {
    for (const child of childSelectors) {
      const trimmed = normalizeSelector(child)
      if (!trimmed) continue
      if (trimmed.includes('&')) {
        combined.push(normalizeSelector(trimmed.replace(/&/g, parent).trim()))
      } else if (parent) {
        combined.push(normalizeSelector(`${parent} ${trimmed}`))
      } else {
        combined.push(trimmed)
      }
    }
  }
  return combined
}

function parseCSSRules(css = '', parentSelectors = []) {
  const rules = []
  const source = stripCSSComments(css)
  let cursor = 0

  while (cursor < source.length) {
    const open = source.indexOf('{', cursor)
    if (open === -1) break
    const close = findMatchingBrace(source, open)
    if (close === -1) break

    const rawPrelude = source.slice(cursor, open)
    const preludeStart = Math.max(rawPrelude.lastIndexOf(';'), rawPrelude.lastIndexOf('}')) + 1
    const prelude = rawPrelude.slice(preludeStart).trim()
    const body = source.slice(open + 1, close)
    cursor = close + 1
    if (!prelude) continue

    if (/^@(?:-[\w]+-)?keyframes\b/i.test(prelude)) {
      continue
    }

    if (prelude.startsWith('@')) {
      rules.push(...parseCSSRules(body, parentSelectors))
      continue
    }

    const selectors = combineSelectors(parentSelectors, splitTopLevel(prelude, ','))
    const declarationText = stripNestedBlocks(body).trim()
    if (declarationText) {
      for (const selector of selectors) {
        rules.push({ selector, declarations: declarationText })
      }
    }

    if (body.includes('{')) {
      rules.push(...parseCSSRules(body, selectors))
    }
  }

  return rules
}

function collectCSSVariables(css = '') {
  const variables = {}
  for (const rule of parseCSSRules(css)) {
    const raw = parseDeclarations(rule.declarations)
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('--')) variables[key] = value
    }
  }
  return variables
}

function resolveCSSVariables(value = '', variables = {}, depth = 0) {
  if (!value || depth > 8) return value
  return String(value).replace(/var\(\s*(--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
    const replacement = variables[name] ?? fallback ?? ''
    return resolveCSSVariables(replacement, variables, depth + 1)
  })
}

function resolveDeclarationVariables(declarations = '', variables = {}) {
  return resolveCSSVariables(declarations, variables)
}

function numberFromCssValue(value, fallback = 0) {
  if (value == null) return fallback
  const raw = String(value).trim()
  if (!raw || raw === 'auto') return fallback
  const calc = raw.match(/^calc\(([-\d.]+)px\s*([+-])\s*([-\d.]+)px\)$/)
  if (calc) {
    return calc[2] === '+' ? parseFloat(calc[1]) + parseFloat(calc[3]) : parseFloat(calc[1]) - parseFloat(calc[3])
  }
  return Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : fallback
}

function cssLengthToPx(value, parentSize = 0, fallback = 0) {
  if (value == null) return fallback
  const raw = String(value).trim()
  if (!raw || raw === 'auto') return fallback
  if (raw.endsWith('%')) return parentSize * parseFloat(raw) / 100
  return numberFromCssValue(raw, fallback)
}

function hasExplicitPosition(raw = {}) {
  return raw.left != null || raw.right != null || raw.top != null || raw.bottom != null
}


// ─── 1. 颜色解析 ───────────────────────────────────────────────────────────

function parseColor(str = '#000000') {
  str = (str || '').trim().toLowerCase().replace(/\s*!important\s*$/, '')

  if (CSS_NAMED_COLORS[str]) return [...CSS_NAMED_COLORS[str]]

  const hex8 = str.match(/^#([0-9a-f]{8})$/)
  if (hex8) {
    const n = parseInt(hex8[1], 16)
    return [((n>>24)&255)/255, ((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255]
  }
  const hex6 = str.match(/^#([0-9a-f]{6})$/)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255, 1]
  }
  const hex3 = str.match(/^#([0-9a-f]{3})$/)
  if (hex3) {
    return hex3[1].split('').map(c => parseInt(c+c,16)/255).concat(1)
  }
  const rgba = str.match(/rgba?\(\s*([\d.]+%?)\s*(?:,|\s)\s*([\d.]+%?)\s*(?:,|\s)\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/)
  if (rgba) {
    const channel = v => String(v).endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / 255
    const alpha = v => v == null ? 1 : (String(v).endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))
    return [
      channel(rgba[1]),
      channel(rgba[2]),
      channel(rgba[3]),
      alpha(rgba[4]),
    ]
  }
  return [0, 0, 0, 1]
}

function parseTimeMs(str = '0s') {
  const raw = String(str || '').trim()
  return raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000
}


// ─── 2. 缓动解析 ───────────────────────────────────────────────────────────

function parseEasing(str = 'ease-in-out') {
  str = (str || '').trim()
  if (EASING_MAP[str]) return EASING_MAP[str]
  const m = str.match(/cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/)
  if (m) return { o: [+m[1], +m[2]], i: [+m[3], +m[4]] }
  return EASING_MAP['ease-in-out']
}


// ─── 3. animation 简写解析 ─────────────────────────────────────────────────

function parseAnimationShorthand(str = '') {
  const result = { name:'', duration:1000, easing:'ease-in-out', iterationCount:1, delay:0, direction:'normal', fillMode:'none', playState:'running' }
  let durSet = false

  for (const part of tokenizeCssValue(str)) {
    if (!part) continue
    if (part === 'infinite')   { result.iterationCount = Infinity; continue }
    if (part === 'alternate' || part === 'alternate-reverse' || part === 'reverse' || part === 'normal') {
      result.direction = part
      continue
    }
    if (part === 'both' || part === 'forwards' || part === 'backwards' || part === 'none') {
      result.fillMode = part
      continue
    }
    if (part === 'running' || part === 'paused') {
      result.playState = part
      continue
    }

    if (/^-?[\d.]+m?s$/.test(part)) {
      const ms = parseTimeMs(part)
      if (!durSet) { result.duration = ms; durSet = true } else { result.delay = ms }
      continue
    }
    if (part.startsWith('cubic-bezier') || EASING_MAP[part]) { result.easing = part; continue }
    if (/^\d+(\.\d+)?$/.test(part)) { result.iterationCount = +part; continue }
    result.name = part
  }
  return result
}


// ─── 4. transform 解析 ─────────────────────────────────────────────────────

function parseTransform(str = '') {
  const r = { x:null, y:null, scaleX:null, scaleY:null, rotation:null }
  if (!str || String(str).trim() === 'none') return r
  for (const [, rawFn, args] of str.matchAll(/(\w+)\(([^)]+)\)/g)) {
    const fn = rawFn.toLowerCase()
    const v = splitTopLevel(args, ',')
      .flatMap(part => part.trim().split(/\s+/))
      .filter(Boolean)
      .map(a => parseFloat(a.trim()))
    switch (fn) {
      case 'translatex': r.x = v[0]; break
      case 'translatey': r.y = v[0]; break
      case 'translate3d':
      case 'translate':  r.x = v[0]; r.y = v[1] ?? 0; break
      case 'scale':    r.scaleX = v[0]*100; r.scaleY = (v[1]??v[0])*100; break
      case 'scalex':   r.scaleX = v[0]*100; break
      case 'scaley':   r.scaleY = v[0]*100; break
      case 'scale3d':   r.scaleX = v[0]*100; r.scaleY = (v[1]??v[0])*100; break
      case 'rotate':   r.rotation = v[0]; break
      case 'rotatez':  r.rotation = v[0]; break
    }
  }
  return r
}

function parseBoxShadow(str = '') {
  const rawValue = String(str || '').trim()
  if (!rawValue || rawValue === 'none') return null

  const colorMatch = rawValue.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b|transparent|black|white|red|blue|green|yellow|orange|purple|pink|gray/i)
  const color = colorMatch ? parseColor(colorMatch[0]) : [0, 0, 0, 1]
  const withoutColor = colorMatch ? rawValue.replace(colorMatch[0], '') : rawValue
  const nums = (withoutColor.match(/-?[\d.]+(?:px)?/g) || []).map(v => parseFloat(v))

  return {
    offsetX: nums[0] || 0,
    offsetY: nums[1] || 0,
    blur: nums[2] || 0,
    spread: nums[3] || 0,
    color,
  }
}

function mergeDeclarationText(base = '', next = '') {
  return [base, next].filter(Boolean).join('; ')
}

function normalizeAnimationList(raw) {
  const values = splitTopLevel(raw || '', ',')
  return values.length ? values : ['']
}

function pickListValue(list, index, fallback = '') {
  if (!Array.isArray(list) || list.length === 0) return fallback
  return list[index] != null ? list[index] : (list[list.length - 1] ?? fallback)
}

function parseAnimationProperties(raw) {
  const shorthandList = normalizeAnimationList(raw.animation || '')
  const names = splitTopLevel(raw['animation-name'] || '', ',')
  const durations = splitTopLevel(raw['animation-duration'] || '', ',')
  const easings = splitTopLevel(raw['animation-timing-function'] || '', ',')
  const delays = splitTopLevel(raw['animation-delay'] || '', ',')
  const counts = splitTopLevel(raw['animation-iteration-count'] || '', ',')
  const directions = splitTopLevel(raw['animation-direction'] || '', ',')
  const fillModes = splitTopLevel(raw['animation-fill-mode'] || '', ',')
  const total = Math.max(shorthandList.length, names.length, durations.length, easings.length, delays.length, counts.length, directions.length, fillModes.length, 1)
  const animations = []

  for (let i = 0; i < total; i++) {
    const anim = parseAnimationShorthand(pickListValue(shorthandList, i, ''))
    if (names.length) anim.name = pickListValue(names, i, anim.name).trim()
    if (durations.length) {
      anim.duration = parseTimeMs(pickListValue(durations, i, anim.duration + 'ms'))
      anim.hasExplicitDuration = true
    } else {
      anim.hasExplicitDuration = /\b-?[\d.]+m?s\b/.test(pickListValue(shorthandList, i, ''))
    }
    if (easings.length) anim.easing = pickListValue(easings, i, anim.easing).trim()
    if (delays.length) anim.delay = parseTimeMs(pickListValue(delays, i, '0s'))
    if (counts.length) {
      const count = pickListValue(counts, i, '1').trim()
      anim.iterationCount = count === 'infinite' ? Infinity : +count
    }
    if (directions.length) anim.direction = pickListValue(directions, i, anim.direction).trim()
    if (fillModes.length) anim.fillMode = pickListValue(fillModes, i, anim.fillMode).trim()
    if (anim.name && anim.name !== 'none') animations.push(anim)
  }

  if (!animations.length) {
    const fallback = parseAnimationShorthand('')
    fallback.hasExplicitDuration = false
    animations.push(fallback)
  }
  return animations
}

function parseTransitionProperties(raw) {
  const properties = splitTopLevel(raw['transition-property'] || '', ',')
  const durations = splitTopLevel(raw['transition-duration'] || '', ',')
  const easings = splitTopLevel(raw['transition-timing-function'] || '', ',')
  const delays = splitTopLevel(raw['transition-delay'] || '', ',')

  if (raw.transition) {
    const transitions = []
    for (const item of splitTopLevel(raw.transition, ',')) {
      const tokens = tokenizeCssValue(item)
      const transition = { property: 'all', duration: 0, easing: 'ease', delay: 0 }
      let durSet = false
      for (const token of tokens) {
        if (/^-?[\d.]+m?s$/.test(token)) {
          if (!durSet) {
            transition.duration = parseTimeMs(token)
            durSet = true
          } else {
            transition.delay = parseTimeMs(token)
          }
        } else if (token.startsWith('cubic-bezier') || EASING_MAP[token]) {
          transition.easing = token
        } else if (token !== 'none') {
          transition.property = token
        }
      }
      if (transition.duration > 0) transitions.push(transition)
    }
    return transitions
  }

  const total = Math.max(properties.length, durations.length, easings.length, delays.length)
  const transitions = []
  for (let i = 0; i < total; i++) {
    const duration = parseTimeMs(pickListValue(durations, i, '0s'))
    if (duration <= 0) continue
    transitions.push({
      property: pickListValue(properties, i, 'all').trim(),
      duration,
      easing: pickListValue(easings, i, 'ease').trim(),
      delay: parseTimeMs(pickListValue(delays, i, '0s')),
    })
  }
  return transitions
}

function mapTransitionPropertyToStop(prop, value, style) {
  const props = { easing: null }
  if (prop === 'transform') Object.assign(props, parseTransform(value))
  if (prop === 'opacity') props.opacity = parseFloat(value) * 100
  if (prop === 'background-color' || prop === 'background' || prop === 'color') props.color = parseColor(value)
  if (prop === 'box-shadow') props.boxShadow = parseBoxShadow(value)
  if (prop === 'top') props.top = value
  if (prop === 'left') props.left = value
  if (prop === 'right') props.right = value
  if (prop === 'width') props.width = value
  if (prop === 'height') props.height = value
  if (prop === 'border-radius') {
    props.borderRadius = value
    const radius = parseFloat(value)
    if (Number.isFinite(radius)) {
      style.borderRadius = radius
      style.shapeType = 'rc'
    }
  }
  return props
}

function buildTransitionStops(baseRaw, targetRaw, transition, style) {
  const propsToCheck = transition.property === 'all'
    ? ['transform', 'opacity', 'background-color', 'background', 'color', 'box-shadow']
    : [transition.property]
  const fromProps = { easing: transition.easing }
  const toProps = { easing: transition.easing }

  for (const prop of propsToCheck) {
    const baseValue = baseRaw[prop]
    const targetValue = targetRaw[prop]
    if (targetValue == null || baseValue === targetValue) continue
    Object.assign(fromProps, mapTransitionPropertyToStop(prop, baseValue || defaultValueForTransition(prop, style), style))
    Object.assign(toProps, mapTransitionPropertyToStop(prop, targetValue, style))
  }

  const meaningful = Object.keys(toProps).some(k => k !== 'easing' && toProps[k] != null)
  if (!meaningful) return []
  return [
    { pct: 0, props: fromProps },
    { pct: 1, props: toProps },
  ]
}

function defaultValueForTransition(prop, style) {
  if (prop === 'transform') return 'none'
  if (prop === 'opacity') return '1'
  if (prop === 'box-shadow') return 'none'
  if (prop === 'background-color' || prop === 'background' || prop === 'color') return colorToRgba(style.color)
  return '0'
}

function colorToRgba(color) {
  const c = Array.isArray(color) ? color : [0,0,0,1]
  return `rgba(${Math.round((c[0] || 0) * 255)}, ${Math.round((c[1] || 0) * 255)}, ${Math.round((c[2] || 0) * 255)}, ${c[3] ?? 1})`
}


// ─── 5. 元素样式解析 ───────────────────────────────────────────────────────

function parseDeclarations(block) {
  const raw = {}
  for (const declaration of splitTopLevel(block, ';')) {
    const idx = declaration.indexOf(':')
    if (idx === -1) continue
    const k = declaration.slice(0, idx).trim()
    const v = declaration.slice(idx + 1).trim().replace(/\s*!important\s*$/, '')
    if (k) raw[k] = v
  }
  return raw
}

function parseElementStyle(declarations, inheritedRaw = {}) {
  const raw = { ...inheritedRaw, ...parseDeclarations(declarations) }

  const width  = numberFromCssValue(raw['width'], 0)
  const height = numberFromCssValue(raw['height'], 0)
  const left = raw.left
  const right = raw.right
  const top = raw.top
  const bottom = raw.bottom
  const color  = parseColor(raw['background-color'] || raw['background'] || raw['color'] || '#000')
  const marginRight = parseFloat(raw['margin-right'] || raw['margin-inline-end'] || raw['margin'] || 0) || 0
  const boxShadow = parseBoxShadow(raw['box-shadow'])

  // border / outline → stroke
  let strokeColor = null
  let strokeWidth = 0
  const borderStr = raw['border'] || raw['border-color'] || ''
  if (borderStr && borderStr !== 'none') {
    const bw = (raw['border'] || '').match(/^([\d.]+)px/)
    strokeWidth = bw ? parseFloat(bw[1]) : 1
    const bc = (raw['border'] || '').match(/#[0-9a-f]{3,6}|rgba?\([^)]+\)/i)
    strokeColor = bc ? parseColor(bc[0]) : parseColor(raw['border-color'] || '#000')
  }

  const br = (raw['border-radius'] || '0').trim()
  const numericRadius = parseFloat(br) || 0
  const isCircle = br === '50%' || br === '50% 50%' || (width > 0 && height > 0 && numericRadius >= Math.min(width, height) / 2)
  const shapeType    = isCircle ? 'el' : 'rc'
  const borderRadius = isCircle ? 0 : numericRadius

  const animations = parseAnimationProperties(raw)
  const anim = animations[0]
  const transitions = parseTransitionProperties(raw)

  return { width, height, left, right, top, bottom, marginRight, color, boxShadow, strokeColor, strokeWidth, shapeType, borderRadius, animation: anim, animations, transitions, raw }
}


// ─── 6. @keyframes 解析（v3 核心修复）────────────────────────────────────

/**
 * 提取 @keyframes 块原始文本（正确处理嵌套花括号）
 */
function extractKeyframeBlocks(css) {
  const blocks = new Map()
  let i = 0
  while (i < css.length) {
    // 找到 @keyframes
    const atIdx = css.indexOf('@keyframes', i)
    if (atIdx === -1) break

    // 提取名称
    const afterAt  = css.slice(atIdx + 10).trimStart()
    const nameMatch = afterAt.match(/^([\w-]+)\s*\{/)
    if (!nameMatch) { i = atIdx + 10; continue }

    const name     = nameMatch[1]
    const bodyStart = atIdx + 10 + afterAt.indexOf('{') + 1

    // 找到匹配的结束花括号（计数法，支持嵌套）
    let depth = 1, j = bodyStart
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }

    blocks.set(name, css.slice(bodyStart, j - 1))
    i = j
  }
  return blocks
}

/**
 * 解析 @keyframes 体内容 → stops[]
 *
 * v3 关键修复：
 * - 明确匹配 "from|to|N%" 列表（支持逗号分隔的组合写法）
 * - 展开组合百分比为独立 stop，每个 stop 共享同一套属性
 */
function parseKeyframeBody(body) {
  const stops = []

  // 匹配模式：一个或多个百分比/from/to，后跟 { 声明 }
  // (?:from|to|\d+(?:\.\d+)?%) 匹配单个百分比关键字
  // 允许逗号分隔多个
  const stopRe = /((?:(?:from|to|\d+(?:\.\d+)?%)\s*,?\s*)+)\s*\{([^}]*)\}/g

  for (const [, pctRaw, decls] of body.matchAll(stopRe)) {
    const raw = parseDeclarations(decls)
    const props = declarationsToAnimProps(raw)

    // 展开逗号分隔的百分比列表 → 每个百分比一条 stop
    const pctList = pctRaw
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        if (p === 'from') return 0
        if (p === 'to')   return 1
        return parseFloat(p) / 100
      })

    for (const pct of pctList) {
      stops.push({ pct, props: { ...props } })
    }
  }

  return normalizeKeyframeStops(stops.sort((a, b) => a.pct - b.pct))
}

function declarationsToAnimProps(raw) {
  const tf = parseTransform(raw.transform || '')
  return {
    x: tf.x,
    y: tf.y,
    top: raw.top != null ? raw.top : null,
    left: raw.left != null ? raw.left : null,
    right: raw.right != null ? raw.right : null,
    width: raw.width != null ? raw.width : null,
    height: raw.height != null ? raw.height : null,
    borderRadius: raw['border-radius'] != null ? raw['border-radius'] : null,
    scaleX: tf.scaleX,
    scaleY: tf.scaleY,
    rotation: tf.rotation,
    opacity: raw.opacity != null ? parseFloat(raw.opacity) * 100 : null,
    color: raw['background-color'] || raw.background || raw.color ? parseColor(raw['background-color'] || raw.background || raw.color) : null,
    boxShadow: raw['box-shadow'] ? parseBoxShadow(raw['box-shadow']) : null,
    easing: raw['animation-timing-function'] || null,
  }
}

function hasAnimValue(props, key) {
  return props && props[key] != null
}

function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function normalizeKeyframeStops(stops) {
  if (!stops.length) return stops
  const sorted = stops.slice().sort((a, b) => a.pct - b.pct)
  const keys = ['x', 'y', 'top', 'left', 'right', 'width', 'height', 'borderRadius', 'scaleX', 'scaleY', 'rotation', 'opacity', 'color', 'boxShadow']
  const defaults = { x: 0, y: 0, top: null, left: null, right: null, width: null, height: null, borderRadius: null, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100, color: null, boxShadow: null }
  const allKeys = keys.filter(key => sorted.some(stop => hasAnimValue(stop.props, key)))

  for (const key of allKeys) {
    let last = defaults[key]
    for (const stop of sorted) {
      if (hasAnimValue(stop.props, key)) {
        last = stop.props[key]
      } else if (last != null) {
        stop.props[key] = Array.isArray(last) ? [...last] : (typeof last === 'object' ? cloneData(last) : last)
      }
    }
    let next = null
    for (let i = sorted.length - 1; i >= 0; i--) {
      const stop = sorted[i]
      if (hasAnimValue(stop.props, key)) next = stop.props[key]
      else if (next != null) stop.props[key] = Array.isArray(next) ? [...next] : (typeof next === 'object' ? cloneData(next) : next)
    }
  }

  if (sorted[0].pct > 0) {
    sorted.unshift({ pct: 0, props: { ...sorted[0].props } })
  }
  if (sorted[sorted.length - 1].pct < 1) {
    sorted.push({ pct: 1, props: { ...sorted[sorted.length - 1].props } })
  }
  return sorted
}

function reverseStops(stops) {
  return stops.map(stop => ({ pct: 1 - stop.pct, props: { ...stop.props } })).sort((a, b) => a.pct - b.pct)
}

function buildStopsForAnimation(stops, animation) {
  if (!animation || animation.direction !== 'reverse') return stops
  return reverseStops(stops)
}

function makeAlternateStops(stops) {
  const forward = stops.slice().sort((a, b) => a.pct - b.pct)
  const backward = forward.slice(0, -1).reverse().map(stop => ({
    pct: 1 + (1 - stop.pct),
    props: { ...stop.props },
  }))
  return forward.map(stop => ({ pct: stop.pct / 2, props: { ...stop.props } }))
    .concat(backward.map(stop => ({ pct: stop.pct / 2, props: { ...stop.props } })))
    .sort((a, b) => a.pct - b.pct)
}


// ─── 7. stops → Lottie ks ─────────────────────────────────────────────────

function makeKf(frame, val, easing, isLast) {
  const { o, i } = parseEasing(easing)
  const kf = {
    t: frame,
    s: Array.isArray(val) ? val : [val],
    o: { x: [o[0]], y: [o[1]] },
    i: { x: [i[0]], y: [i[1]] },
  }
  if (isLast) { delete kf.o; delete kf.i }
  return kf
}

function withEndValues(keyframes) {
  for (let i = 0; i < keyframes.length - 1; i++) {
    keyframes[i].e = keyframes[i + 1].s
  }
  return keyframes
}

function frameForPct(pct, frames, loop) {
  return Math.round(pct * frames)
}

function normalizeLayerStart(delayMs, duration, fps) {
  return 0
}

function interpolateValue(a, b, ratio) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((value, index) => value + ((b[index] ?? value) - value) * ratio)
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * ratio
  }
  return ratio < 0.5 ? a : b
}

function interpolateProps(prev, next, ratio) {
  const props = { ...prev.props }
  for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']) {
    if (prev.props[key] != null && next.props[key] != null) {
      props[key] = interpolateValue(prev.props[key], next.props[key], ratio)
    }
  }
  if (prev.props.color && next.props.color) {
    props.color = interpolateValue(prev.props.color, next.props.color, ratio)
  }
  if (prev.props.boxShadow && next.props.boxShadow) {
    props.boxShadow = {
      offsetX: interpolateValue(prev.props.boxShadow.offsetX, next.props.boxShadow.offsetX, ratio),
      offsetY: interpolateValue(prev.props.boxShadow.offsetY, next.props.boxShadow.offsetY, ratio),
      blur: interpolateValue(prev.props.boxShadow.blur, next.props.boxShadow.blur, ratio),
      spread: interpolateValue(prev.props.boxShadow.spread, next.props.boxShadow.spread, ratio),
      color: interpolateValue(prev.props.boxShadow.color, next.props.boxShadow.color, ratio),
    }
  }
  props.easing = prev.props.easing || next.props.easing || null
  return props
}

function propsAtPhase(stops, phase) {
  if (!stops.length) return {}
  const normalized = ((phase % 1) + 1) % 1
  const sorted = stops.slice().sort((a, b) => a.pct - b.pct)
  const lookup = sorted.concat(sorted.map(s => ({ ...s, pct: s.pct + 1 })))
  let prev = lookup[0]
  let next = lookup[lookup.length - 1]
  const target = normalized < lookup[0].pct ? normalized + 1 : normalized

  for (let i = 0; i < lookup.length - 1; i++) {
    if (lookup[i].pct <= target && target <= lookup[i + 1].pct) {
      prev = lookup[i]
      next = lookup[i + 1]
      break
    }
  }

  if (Math.abs(next.pct - prev.pct) < 0.0001) return { ...prev.props }
  return interpolateProps(prev, next, (target - prev.pct) / (next.pct - prev.pct))
}

function phaseStops(stops, delayMs, duration) {
  if (!delayMs || !duration || !stops.length) return stops
  const offset = delayMs / duration
  const phased = stops.map(stop => ({
    pct: ((stop.pct + offset) % 1 + 1) % 1,
    props: { ...stop.props },
  }))
  phased.push({ pct: 0, props: propsAtPhase(stops, -offset) })
  phased.push({ pct: 1, props: propsAtPhase(stops, -offset) })

  const byPct = new Map()
  for (const stop of phased) {
    const key = stop.pct.toFixed(6)
    byPct.set(key, stop)
  }
  return [...byPct.values()].sort((a, b) => a.pct - b.pct)
}

function stopsToKs(stops, { fps, duration, baseX, baseY, fallbackEasing, loop }) {
  const frames = Math.round((duration / 1000) * fps)

  function track1D(getProp, baseVal = 0) {
    const used = stops.filter(s => getProp(s.props) != null)
    if (!used.length) return null
    return {
      a: 1,
      k: withEndValues(used.map((s, idx) => makeKf(
        frameForPct(s.pct, frames, loop),
        (getProp(s.props) ?? 0) + baseVal,
        s.props.easing || fallbackEasing,
        idx === used.length - 1
      )))
    }
  }

  function trackScale() {
    const used = stops.filter(s => s.props.scaleX != null || s.props.scaleY != null)
    if (!used.length) return null
    return {
      a: 1,
      k: withEndValues(used.map((s, idx) => makeKf(
        frameForPct(s.pct, frames, loop),
        [s.props.scaleX ?? 100, s.props.scaleY ?? 100, 100],
        s.props.easing || fallbackEasing,
        idx === used.length - 1
      )))
    }
  }

  function trackPosition() {
    const used = stops.filter(s => s.props.x != null || s.props.y != null || s.props.absX != null || s.props.absY != null)
    if (!used.length) return null
    return {
      a: 1,
      k: withEndValues(used.map((s, idx) => makeKf(
        frameForPct(s.pct, frames, loop),
        [s.props.absX ?? ((s.props.x ?? 0) + baseX), s.props.absY ?? ((s.props.y ?? 0) + baseY), 0],
        s.props.easing || fallbackEasing,
        idx === used.length - 1
      )))
    }
  }

  return {
    o: track1D(p => p.opacity)           || { a:0, k:100 },
    r: track1D(p => p.rotation)          || { a:0, k:0   },
    p: trackPosition()                   || { a:0, k:[baseX, baseY, 0] },
    a: { a:0, k:[0, 0, 0] },
    s: trackScale()                      || { a:0, k:[100, 100, 100] },
  }
}

function resolveStopLayoutProps(stops, style, canvasWidth, canvasHeight) {
  const originX = style.layoutX || 0
  const originY = style.layoutY || 0
  return stops.map(stop => {
    const props = { ...stop.props }
    if (props.left != null || props.right != null || props.top != null || props.width != null || props.height != null) {
      const width = cssLengthToPx(props.width ?? style.raw.width, canvasWidth, style.width || 10)
      const height = cssLengthToPx(props.height ?? style.raw.height, canvasHeight, style.height || 10)
      if (props.left != null) props.absX = originX + cssLengthToPx(props.left, canvasWidth, 0) + width / 2
      if (props.right != null) props.absX = originX + canvasWidth - cssLengthToPx(props.right, canvasWidth, 0) - width / 2
      if (props.top != null) props.absY = originY + cssLengthToPx(props.top, canvasHeight, 0) + height / 2
      if (props.height != null) props.scaleY = style.height > 0 ? (height / style.height) * 100 : props.scaleY
      if (props.width != null) props.scaleX = style.width > 0 ? (width / style.width) * 100 : props.scaleX
      if (props.borderRadius != null) props.borderRadiusValue = parseFloat(props.borderRadius) || 0
    }
    return { ...stop, props }
  })
}

function stopsToFillColor(stops, fallbackColor, fallbackEasing, fps, duration, loop) {
  const used = stops.filter(s => s.props.color)
  if (!used.length) return { a:0, k:fallbackColor }
  const frames = Math.round((duration / 1000) * fps)
  return {
    a: 1,
    k: withEndValues(used.map((s, idx) => makeKf(
      frameForPct(s.pct, frames, loop),
      s.props.color,
      s.props.easing || fallbackEasing,
      idx === used.length - 1
    )))
  }
}

function stopsToShadowTracks(stops, fallbackShadow, fallbackEasing, fps, duration, baseSize, loop) {
  const used = stops.filter(s => s.props.boxShadow)
  const shadowStops = used.length ? used : (fallbackShadow ? [
    { pct: 0, props: { boxShadow: fallbackShadow, easing: null } },
    { pct: 1, props: { boxShadow: fallbackShadow, easing: null } },
  ] : [])
  if (!shadowStops.length) return null

  const frames = Math.round((duration / 1000) * fps)
  const scaleK = []
  const opacityK = []
  let color = shadowStops[0].props.boxShadow.color

  shadowStops.forEach((s, idx) => {
    const shadow = s.props.boxShadow
    color = shadow.color || color
    const spread = Math.max(0, shadow.spread || 0)
    const blur = Math.max(0, shadow.blur || 0)
    const haloSize = baseSize + (spread + blur * 0.5) * 2
    const scaleX = baseSize > 0 ? (haloSize / baseSize) * (s.props.scaleX ?? 100) : (s.props.scaleX ?? 100)
    const scaleY = baseSize > 0 ? (haloSize / baseSize) * (s.props.scaleY ?? 100) : (s.props.scaleY ?? 100)
    const opacity = Math.max(0, Math.min(100, (shadow.color?.[3] ?? 1) * 100))
    const frame = frameForPct(s.pct, frames, loop)
    const easing = s.props.easing || fallbackEasing
    const isLast = idx === shadowStops.length - 1
    scaleK.push(makeKf(frame, [scaleX, scaleY, 100], easing, isLast))
    opacityK.push(makeKf(frame, opacity, easing, isLast))
  })

  return {
    color,
    scale: { a:1, k:withEndValues(scaleK) },
    opacity: { a:1, k:withEndValues(opacityK) },
  }
}


// ─── 8. 构建单个 Lottie 图层 ──────────────────────────────────────────────

function buildShapeItem(style) {
  const { width:w, height:h, shapeType, borderRadius } = style
  return shapeType === 'el'
    ? { ty:'el', nm:'shape', d:1, s:{a:0,k:[w,h]}, p:{a:0,k:[0,0]} }
    : { ty:'rc', nm:'shape', d:1, s:{a:0,k:[w,h]}, p:{a:0,k:[0,0]}, r:{a:0,k:borderRadius} }
}

function buildFillItem(color) {
  return { ty:'fl', nm:'fill', c:color, o:{a:0,k:100}, r:1 }
}

function buildStrokeItem(color, width) {
  return { ty:'st', nm:'stroke', c:{a:0,k:color}, o:{a:0,k:100}, w:{a:0,k:width}, lc:2, lj:2 }
}

const TR_STATIC = {
  ty:'tr',
  p:{a:0,k:[0,0]}, a:{a:0,k:[0,0]}, s:{a:0,k:[100,100]},
  r:{a:0,k:0}, o:{a:0,k:100}, sk:{a:0,k:0}, sa:{a:0,k:0},
}

function buildLayer({ index, nm, style, stops, fps, duration, delayMs, baseX, baseY, kind = 'shape' }) {
  const totalFrames = Math.round((duration / 1000) * fps)
  const startFrame = normalizeLayerStart(delayMs, duration, fps)
  const localStops = resolveStopLayoutProps(phaseStops(stops, delayMs, duration), style, style.canvasWidth || 0, style.canvasHeight || 0)
  const loops = style.animation.iterationCount === Infinity

  const ks = stopsToKs(localStops, {
    fps, duration, baseX, baseY,
    fallbackEasing: style.animation.easing,
    loop: loops,
  })

  const groupItems = [buildShapeItem(style)]
  if (kind === 'shadow') {
    const shadowTracks = stopsToShadowTracks(localStops, style.boxShadow, style.animation.easing, fps, duration, Math.max(style.width || 0, style.height || 0), loops)
    if (!shadowTracks) return null
    ks.o = shadowTracks.opacity
    ks.s = shadowTracks.scale
    groupItems.push(buildFillItem({ a:0, k:shadowTracks.color }))
  } else {
    groupItems.push(buildFillItem(stopsToFillColor(localStops, style.color, style.animation.easing, fps, duration, loops)))
    if (style.strokeColor) groupItems.push(buildStrokeItem(style.strokeColor, style.strokeWidth))
  }
  groupItems.push(TR_STATIC)

  return {
    ddd:0, ind:index, ty:4, nm, sr:1,
    ks, ao:0,
    shapes:[{ ty:'gr', nm:'group', it:groupItems }],
    ip: 0,
    op: totalFrames,
    st: startFrame,
  }
}

function repeatKeyframedProperty(property, baseFrames, cycles) {
  if (!property || property.a !== 1 || !Array.isArray(property.k) || cycles <= 1) return
  const original = property.k
  const repeated = []
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const keyframe of original) {
      repeated.push({
        ...cloneData(keyframe),
        t: keyframe.t + cycle * baseFrames,
      })
    }
  }
  property.k = repeated
}

function repeatLayerKeyframes(layer, baseFrames, cycles) {
  if (cycles <= 1) return
  for (const prop of ['o', 'r', 'p', 's']) {
    repeatKeyframedProperty(layer.ks?.[prop], baseFrames, cycles)
  }
  for (const shape of layer.shapes || []) {
    for (const item of shape.it || []) {
      repeatKeyframedProperty(item.c, baseFrames, cycles)
      repeatKeyframedProperty(item.o, baseFrames, cycles)
      repeatKeyframedProperty(item.s, baseFrames, cycles)
      repeatKeyframedProperty(item.p, baseFrames, cycles)
      repeatKeyframedProperty(item.r, baseFrames, cycles)
    }
  }
  layer.op = baseFrames * cycles
}

function repeatLottieTimeline(lottie, baseFrames, cycles) {
  if (cycles <= 1) return lottie
  lottie.op = baseFrames * cycles
  for (const layer of lottie.layers || []) {
    repeatLayerKeyframes(layer, baseFrames, cycles)
  }
  lottie.meta = {
    ...(lottie.meta || {}),
    baseLoopFrames: baseFrames,
    exportedLoopCycles: cycles,
  }
  return lottie
}


// ─── 9. nth-child delay 解析 ──────────────────────────────────────────────

function parseNthChildDelays(css, rawSelector) {
  const delays = new Map()
  const escaped = rawSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped + '\\s*:nth-child\\((\\d+)\\)\\s*\\{([^}]*)\\}', 'g')
  for (const [, n, decls] of css.matchAll(re)) {
    const raw = parseDeclarations(decls)
    if (raw['animation-delay']) {
      const d = raw['animation-delay']
      delays.set(parseInt(n), d.endsWith('ms') ? parseFloat(d) : parseFloat(d)*1000)
    }
  }
  return delays
}

function parseNthChildDelaysFromStyleMap(styleMap, rawSelector) {
  const delays = new Map()
  const base = selectorBase(rawSelector)
  for (const [selector, decls] of styleMap.entries()) {
    if (selectorBase(selector) !== base) continue
    const nth = selector.match(/:nth-child\((\d+)\)/)
    if (!nth) continue
    const raw = parseDeclarations(decls)
    if (raw['animation-delay']) {
      delays.set(parseInt(nth[1]), parseTimeMs(raw['animation-delay']))
    }
  }
  return delays
}

function inferClassCount(css, rawSelector) {
  const classNameMatch = String(rawSelector || '').match(/\.([A-Za-z0-9_-]+)/)
  const className = classNameMatch ? classNameMatch[1] : null
  if (!className) return 0

  let count = 0
  const classAttrRe = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{`([^`]+)`\}|\{([^}]+)\})|class\s*=\s*(?:"([^"]+)"|'([^']+)')/g
  for (const match of css.matchAll(classAttrRe)) {
    const classText = (match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || '')
    if (classText.includes(className)) count += 1
  }
  return count
}

function chooseMainSelector(styleMap, requestedSelector) {
  if (requestedSelector && styleMap.has(requestedSelector)) return requestedSelector
  if (requestedSelector) {
    const found = [...styleMap.keys()].find(selector => selector.includes(requestedSelector))
    if (found) return found
  }

  const entries = [...styleMap.entries()].filter(([selector]) =>
    !selector.includes(':') &&
    !selector.includes('@') &&
    selector !== '*' &&
    selector !== 'body' &&
    selector !== 'html'
  )

  const animated = entries.find(([, decls]) => /(^|;)\s*animation(?:-[\w-]+)?\s*:/.test(decls))
  return animated?.[0] || entries[0]?.[0] || requestedSelector || '.item'
}

function chooseAnimatedSelectors(styleMap, requestedSelector) {
  if (requestedSelector) return [chooseMainSelector(styleMap, requestedSelector)]
  const entries = [...styleMap.entries()].filter(([selector, decls]) =>
    !selector.includes(':') &&
    !selector.includes('@') &&
    selector !== '*' &&
    selector !== 'body' &&
    selector !== 'html' &&
    /(^|;)\s*(?:animation|transition)(?:-[\w-]+)?\s*:/.test(decls)
  )
  return entries.map(([selector]) => selector)
}

function selectorBase(selector = '') {
  return String(selector || '').split(':')[0].trim()
}

function findTransitionTargetRule(styleMap, mainSelector) {
  const base = selectorBase(mainSelector)
  const candidates = [...styleMap.entries()].filter(([selector]) => {
    const normalized = selectorBase(selector)
    return selector !== mainSelector && (
      normalized === base ||
      selector.startsWith(`${base}:`) ||
      selector.includes(`${base}.`) ||
      selector.includes(`${base}[`) ||
      selector.includes(`${base} `)
    )
  })
  const preferred = candidates.find(([selector]) => /:hover|:active|:focus|\.active|\.open|\.selected|\.is-active|\.show/.test(selector))
  const picked = preferred || candidates[0]
  return picked ? { selector: picked[0], declarations: picked[1] } : null
}

function findNthRuleDeclarations(styleMap, mainSelector, index) {
  const exact = `${mainSelector}:nth-child(${index})`
  if (styleMap.has(exact)) return styleMap.get(exact)
  const normalized = [...styleMap.entries()].find(([selector]) =>
    selectorBase(selector) === selectorBase(mainSelector) &&
    selector.includes(`:nth-child(${index})`)
  )
  return normalized ? normalized[1] : ''
}

function findContainerStyle(styleMap, animatedSelector, canvasWidth, canvasHeight) {
  const parts = String(animatedSelector || '').split(/\s+/).filter(Boolean)
  const parentSelector = parts.length > 1 ? parts.slice(0, -1).join(' ') : null
  const candidates = [
    parentSelector ? `${parentSelector} .wrapper` : '.wrapper',
    '.wrapper',
    parentSelector,
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!styleMap.has(candidate)) continue
    const style = parseElementStyle(styleMap.get(candidate))
    if (style.width || style.height || hasExplicitPosition(style.raw)) {
      return {
        width: style.width || canvasWidth,
        height: style.height || canvasHeight,
        x: style.left != null ? cssLengthToPx(style.left, canvasWidth, 0) : (canvasWidth - (style.width || canvasWidth)) / 2,
        y: style.top != null ? cssLengthToPx(style.top, canvasHeight, 0) : (canvasHeight - (style.height || canvasHeight)) / 2,
      }
    }
  }
  return { width: canvasWidth, height: canvasHeight, x: 0, y: 0 }
}

function nthSourceIndexForLocalIndex(nthKeys, localIndex, count) {
  if (!nthKeys.length) return localIndex
  if (nthKeys.includes(localIndex)) return localIndex
  const maxKey = Math.max(...nthKeys)
  if (maxKey > count && localIndex > 1) {
    return nthKeys[localIndex - 2] ?? localIndex
  }
  return localIndex
}

function inferAnimationDurationFromCSS(css, options = {}) {
  const variables = collectCSSVariables(css)
  const styleMap = new Map()
  for (const rule of parseCSSRules(css)) {
    styleMap.set(rule.selector, mergeDeclarationText(styleMap.get(rule.selector), resolveDeclarationVariables(rule.declarations, variables)))
  }

  const mainSel = chooseMainSelector(styleMap, options.selector)
  const style = parseElementStyle(styleMap.get(mainSel) || '')
  return style.animation.duration || 1000
}

function isLikelyReactCode(code = '') {
  return /<\/?[A-Z][\w.]*|<\/?(?:div|span|section|svg|path|circle|rect)\b|className\s*=|styled\.\w+|from\s+['"]react['"]|from\s+['"]framer-motion['"]|import\s+React/.test(code)
}

function extractStyledComponentCSS(code = '') {
  const blocks = []
  for (const match of code.matchAll(/(?:const\s+([A-Z]\w*)\s*=\s*)?styled(?:\.\w+|\([^)]*\))\s*`([\s\S]*?)`/g)) {
    const componentName = match[1]
    const css = match[2]
    blocks.push(componentName ? `.${componentName} { ${css} }` : css)
  }
  for (const match of code.matchAll(/(?:const\s+([A-Za-z]\w*)\s*=\s*)?css\s*`([\s\S]*?)`/g)) {
    const className = match[1]
    const css = match[2]
    blocks.push(className ? `.${className} { ${css} }` : css)
  }
  return blocks.join('\n')
}

function extractStyleTagCSS(code = '') {
  const blocks = []
  for (const match of code.matchAll(/<style[^>]*>\s*(?:\{\s*)?(?:`([\s\S]*?)`|"([\s\S]*?)"|'([\s\S]*?)'|([\s\S]*?))(?:\s*\})?\s*<\/style>/gi)) {
    blocks.push(match[1] || match[2] || match[3] || match[4] || '')
  }
  return blocks.join('\n')
}

function normalizeJsStyleValue(rawValue = '') {
  const value = rawValue.trim()
  if (/^\[.*\]$/.test(value)) {
    return splitTopLevel(value.slice(1, -1), ',').map(v => normalizeJsStyleValue(v))
  }
  if (/^['"`]/.test(value)) return value.replace(/^['"`]|['"`]$/g, '')
  if (/^-?[\d.]+$/.test(value)) return value
  return value
}

function extractInlineStyleCSS(code = '') {
  const rules = []
  let index = 0
  const elementRe = /<([a-z][\w-]*)\b([^>]*)>/gi
  for (const [, tag, attrs] of code.matchAll(elementRe)) {
    const styleMatch = attrs.match(/style\s*=\s*\{\{\s*([\s\S]*?)\s*\}\}/)
    if (!styleMatch) continue
    const className = `react-inline-${++index}`
    const declarations = []
    for (const [, key, rawValue] of styleMatch[1].matchAll(/([A-Za-z][\w]*)\s*:\s*([^,}]+)/g)) {
      const cssKey = key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
      const cssValue = normalizeJsStyleValue(rawValue)
      declarations.push(`${cssKey}: ${cssValue};`)
    }
    if (declarations.length) {
      rules.push(`.${className} { ${declarations.join(' ')} }`)
    }
  }
  return rules.join('\n')
}

function extractFramerMotionCSS(code = '') {
  const rules = []
  let index = 0
  const motionRe = /<motion\.([a-z][\w-]*)\b([\s\S]*?)(?:\/>|>)/g

  for (const [, tag, attrs] of code.matchAll(motionRe)) {
    const initialMatch = attrs.match(/initial\s*=\s*\{\{\s*([\s\S]*?)\s*\}\}/)
    const animateMatch = attrs.match(/animate\s*=\s*\{\{\s*([\s\S]*?)\s*\}\}/)
    if (!animateMatch) continue
    const transitionMatch = attrs.match(/transition\s*=\s*\{\{\s*([\s\S]*?)\s*\}\}/)
    const classMatch = attrs.match(/className\s*=\s*["']([^"']+)["']/)
    const className = classMatch ? classMatch[1].split(/\s+/)[0] : `motion-${tag}-${++index}`
    const keyframeName = `${className.replace(/[^\w-]/g, '-')}-motion`
    const initial = parseJsObjectLiteral(initialMatch ? initialMatch[1] : '')
    const animate = parseJsObjectLiteral(animateMatch[1])
    const transition = parseJsObjectLiteral(transitionMatch ? transitionMatch[1] : '')
    const duration = Number(transition.duration || 1) * 1000
    const delay = Number(transition.delay || 0) * 1000
    const easing = framerEaseToCss(transition.ease)
    const baseDecls = framerPropsToDeclarations(initial)
    const frames = framerPropsToKeyframes(initial, animate)
    const repeat = transition.repeat === 'Infinity' || transition.repeat === Infinity ? ' infinite' : ''

    rules.push(`.${className} { ${baseDecls} animation: ${keyframeName} ${duration}ms ${easing} ${delay}ms${repeat}; }`)
    rules.push(`@keyframes ${keyframeName} { ${frames.map(frame => `${Math.round(frame.pct * 10000) / 100}% { ${frame.declarations} }`).join(' ')} }`)
  }

  return rules.join('\n')
}

function parseJsObjectLiteral(source = '') {
  const result = {}
  for (const part of splitTopLevel(source, ',')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim().replace(/^['"]|['"]$/g, '')
    const value = normalizeJsStyleValue(part.slice(idx + 1))
    result[key] = value
  }
  return result
}

function framerEaseToCss(ease) {
  const raw = String(ease || '').replace(/^['"]|['"]$/g, '')
  if (raw === 'easeIn') return 'ease-in'
  if (raw === 'easeOut') return 'ease-out'
  if (raw === 'easeInOut') return 'ease-in-out'
  if (raw === 'linear') return 'linear'
  return 'ease-in-out'
}

function framerPropsToDeclarations(props) {
  const transform = []
  const declarations = []
  if (props.x != null) transform.push(`translateX(${props.x}px)`)
  if (props.y != null) transform.push(`translateY(${props.y}px)`)
  if (props.scale != null) transform.push(`scale(${props.scale})`)
  if (props.scaleX != null) transform.push(`scaleX(${props.scaleX})`)
  if (props.scaleY != null) transform.push(`scaleY(${props.scaleY})`)
  if (props.rotate != null) transform.push(`rotate(${props.rotate}deg)`)
  if (props.rotateZ != null) transform.push(`rotate(${props.rotateZ}deg)`)
  if (transform.length) declarations.push(`transform: ${transform.join(' ')};`)
  if (props.opacity != null) declarations.push(`opacity: ${props.opacity};`)
  if (props.backgroundColor != null) declarations.push(`background-color: ${normalizeJsStyleValue(String(props.backgroundColor))};`)
  if (props.borderRadius != null) declarations.push(`border-radius: ${props.borderRadius}px;`)
  return declarations.join(' ')
}

function framerPropsToKeyframes(initial, animate) {
  const arrayEntries = Object.entries(animate).filter(([, value]) => Array.isArray(value))
  if (!arrayEntries.length) {
    return [
      { pct: 0, declarations: framerPropsToDeclarations({ ...initial }) },
      { pct: 1, declarations: framerPropsToDeclarations(animate) },
    ]
  }
  const steps = Math.max(...arrayEntries.map(([, value]) => value.length), 2)
  const frames = []
  for (let i = 0; i < steps; i++) {
    const props = { ...initial }
    for (const [key, value] of Object.entries(animate)) {
      props[key] = Array.isArray(value) ? value[Math.min(i, value.length - 1)] : (i === steps - 1 ? value : (initial[key] ?? value))
    }
    frames.push({ pct: steps === 1 ? 1 : i / (steps - 1), declarations: framerPropsToDeclarations(props) })
  }
  return frames
}

function extractReactCSS(code = '') {
  return [
    extractUtilityClassCSS(code),
    extractStyleTagCSS(code),
    extractStyledComponentCSS(code),
    extractInlineStyleCSS(code),
    extractFramerMotionCSS(code),
  ].filter(Boolean).join('\n')
}

function extractUtilityClassCSS(code = '') {
  const rules = []
  for (const className of ['animate-spin', 'animate-ping', 'animate-pulse', 'animate-bounce']) {
    if (new RegExp(`\\b${className}\\b`).test(code)) {
      rules.push(`.${className} { width: 24px; height: 24px; border-radius: 50%; background: #3b82f6; }`)
    }
  }
  return rules.join('\n')
}

function stripReactImportsAndExports(code = '') {
  return code
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+default\s+\w+;?/g, '')
}

function buildLottieFromReact(code, options = {}) {
  const css = extractReactCSS(code)
  if (!css.trim()) {
    throw new Error('未找到 styled-components/css 模板字符串或可解析的 inline style')
  }
  return buildLottieFromCSS(css, {
    ...options,
    reactSource: code,
  })
}

function buildLottieFromCode(code, options = {}) {
  const normalized = appendUtilityAnimationCSS(code)
  return isLikelyReactCode(normalized)
    ? buildLottieFromReact(normalized, options)
    : buildLottieFromCSS(normalized, options)
}

function inferAnimationDurationFromCode(code, options = {}) {
  const normalized = appendUtilityAnimationCSS(code)
  const css = isLikelyReactCode(normalized)
    ? extractReactCSS(normalized)
    : normalized
  if (!String(css || '').trim()) return null
  return inferAnimationDurationFromCSS(css, options)
}


// ─── 10. 主入口 ───────────────────────────────────────────────────────────

/**
 * cssToLottie — CSS 完整转换为 Lottie JSON
 *
 * @param {string} css
 * @param {object} options
 *   - selector     {string}  主选择器（如 '.dot'），不传自动识别
 *   - count        {number}  元素数量（不传则从 nth-child 推断）
 *   - canvasWidth  {number}  画布宽度，默认 400
 *   - canvasHeight {number}  画布高度，默认 300
 *   - fps          {number}  帧率，默认 60
 *   - spacing      {number}  多元素水平间距（px），默认 20
 */
function cssToLottie(css, options = {}) {
  const {
    selector    = null,
    canvasWidth  = 400,
    canvasHeight = 300,
    fps          = 60,
    spacing      = null,
    reactSource  = '',
    loopCycles   = 1,
  } = options

  const sourceCSS = appendUtilityAnimationCSS(css)
  const variables = collectCSSVariables(sourceCSS)
  const resolvedCSS = resolveCSSVariables(sourceCSS, variables)

  // 1. 提取所有 @keyframes
  const kfBlocks = extractKeyframeBlocks(resolvedCSS)

  // 2. 提取元素样式块
  const styleMap = new Map()
  for (const rule of parseCSSRules(resolvedCSS)) {
    styleMap.set(rule.selector, mergeDeclarationText(styleMap.get(rule.selector), rule.declarations))
  }

  // 3. 确定动画选择器
  const requestedAnimationName = options.animationName || options.name || null
  const selectors = chooseAnimatedSelectors(styleMap, selector)
  if (!selectors.length) throw new Error('未找到带 animation/transition 的可转换选择器')

  const layers = []
  let nextIndex = 1
  let maxDuration = 0
  let hasExplicitDuration = false
  let hasLoop = false
  const animationNames = []

  for (const mainSel of selectors) {
    const mainRaw = styleMap.get(mainSel) || ''
    const style = parseElementStyle(mainRaw)
    style.canvasWidth = canvasWidth
    style.canvasHeight = canvasHeight

    const activeAnimation = style.animations.find(anim => requestedAnimationName && anim.name === requestedAnimationName)
      || style.animations.find(anim => anim.name && kfBlocks.has(anim.name))
      || style.animations[0]
    const kfName = (requestedAnimationName && kfBlocks.has(requestedAnimationName))
      ? requestedAnimationName
      : (activeAnimation?.name && kfBlocks.has(activeAnimation.name))
        ? activeAnimation.name
        : [...kfBlocks.keys()][0]

    let stops = []
    let duration = activeAnimation?.duration || 1000
    if (kfName && kfBlocks.has(kfName)) {
      stops = buildStopsForAnimation(parseKeyframeBody(kfBlocks.get(kfName)), activeAnimation)
      if (activeAnimation?.direction === 'alternate' || activeAnimation?.direction === 'alternate-reverse') {
        stops = makeAlternateStops(stops)
        duration *= 2
      }
    } else {
      const transitionRule = findTransitionTargetRule(styleMap, mainSel)
      if (!transitionRule) continue
      const baseRaw = style.raw || parseDeclarations(mainRaw)
      const targetRaw = parseDeclarations(transitionRule.declarations)
      const transition = style.transitions[0] || parseTransitionProperties(baseRaw)[0]
      if (!transition) continue
      stops = buildTransitionStops(baseRaw, targetRaw, transition, style)
      duration = transition.duration || duration
      style.animation = {
        ...style.animation,
        name: `${mainSel}-transition`,
        duration,
        easing: transition.easing,
        delay: transition.delay || 0,
        iterationCount: 1,
        hasExplicitDuration: true,
      }
    }
    if (!stops.length) continue

    animationNames.push(kfName || style.animation.name || 'transition')
    maxDuration = Math.max(maxDuration, duration)
    hasExplicitDuration = hasExplicitDuration || !!(activeAnimation?.hasExplicitDuration || style.animation.hasExplicitDuration)
    hasLoop = hasLoop || style.animation.iterationCount === Infinity || activeAnimation?.iterationCount === Infinity

    const nthDelays = parseNthChildDelaysFromStyleMap(styleMap, mainSel)
    const nthKeys = [...nthDelays.keys()].sort((a, b) => a - b)
    const countFromNth = nthKeys.length > 0 ? nthKeys.length + 1 : 0
    const countFromMarkup = Math.max(inferClassCount(resolvedCSS, mainSel), inferClassCount(reactSource, mainSel))
    const inferredCount = countFromNth || countFromMarkup || 1
    const count = selector ? (options.count || inferredCount) : inferredCount

    const elemW = style.width || 10
    const elemH = style.height || 10
    const container = findContainerStyle(styleMap, mainSel, canvasWidth, canvasHeight)
    style.layoutX = container.x
    style.layoutY = container.y
    style.canvasWidth = container.width
    style.canvasHeight = container.height
    const effectiveSpacing = spacing ?? style.marginRight ?? 20
    const totalW = count * elemW + (count - 1) * effectiveSpacing
    const startX = (canvasWidth - totalW) / 2 + elemW / 2
    const fallbackY = canvasHeight / 2

    for (let i = 1; i <= count; i++) {
      const nthSourceIndex = nthSourceIndexForLocalIndex(nthKeys, i, count)
      const delayMs = nthDelays.get(nthSourceIndex) ?? activeAnimation?.delay ?? style.animation.delay ?? 0
      const nthRaw = parseDeclarations(findNthRuleDeclarations(styleMap, mainSel, nthSourceIndex))
      const mergedRaw = { ...style.raw, ...nthRaw }
      const baseX = mergedRaw.right != null
        ? container.x + container.width - cssLengthToPx(mergedRaw.right, container.width, 0) - elemW / 2
        : mergedRaw.left != null
          ? container.x + cssLengthToPx(mergedRaw.left, container.width, 0) + elemW / 2
          : startX + (i - 1) * (elemW + effectiveSpacing)
      const baseY = mergedRaw.top != null
        ? container.y + cssLengthToPx(mergedRaw.top, container.height, 0) + elemH / 2
        : mergedRaw.bottom != null
          ? container.y + container.height - cssLengthToPx(mergedRaw.bottom, container.height, 0) - elemH / 2
          : (hasExplicitPosition(mergedRaw) ? container.y + elemH / 2 : fallbackY)

      layers.push(buildLayer({
        index: nextIndex++,
        nm: `${mainSel.replace(/^[.#]/, '').replace(/[^\w-]/g, '-')}-${i}`,
        style,
        stops,
        fps,
        duration,
        delayMs,
        baseX,
        baseY,
        kind: 'shape',
      }))
    }
  }
  if (!layers.length) throw new Error('没有解析到可转换的动画属性')

  // 10. 组装 Lottie JSON（图层倒序：Lottie 从上层到下层）
  const totalFrames = Math.round((maxDuration / 1000) * fps)
  const loops = hasLoop
  const lottie = {
    v: '5.9.0',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: canvasWidth,
    h: canvasHeight,
    nm: animationNames[0] || 'css-animation',
    ddd: 0,
    assets: [],
    loop: loops,
    layers: layers.reverse(),
    meta: {
      g: reactSource ? 'react-to-lottie-v1' : 'css-to-lottie-v4',
      sourceType: reactSource ? 'react' : 'css',
      cssAnimationDuration: maxDuration,
      cssHasExplicitDuration: hasExplicitDuration,
      cssIterationCount: loops ? 'infinite' : 1,
      loop: loops,
    },
  }
  return repeatLottieTimeline(lottie, totalFrames, 1)
}


function buildLottieFromCSS(css, options = {}) {
  const lottie = cssToLottie(css, {
    selector: options.selector || options.animationName,
    animationName: options.animationName,
    count: options.count,
    canvasWidth: options.width || options.canvasWidth || 390,
    canvasHeight: options.height || options.canvasHeight || 390,
    fps: options.fps || 60,
    spacing: options.spacing,
    reactSource: options.reactSource || '',
    loopCycles: options.loopCycles,
  })

  if (options.duration && !lottie.meta?.cssHasExplicitDuration) {
    const currentDuration = lottie.op / lottie.fr
    const targetDuration = options.duration / 1000
    if (currentDuration > 0 && targetDuration > 0 && Math.abs(currentDuration - targetDuration) > 0.001) {
      const scale = targetDuration / currentDuration
      lottie.op = Math.round(lottie.op * scale)
      for (const layer of lottie.layers || []) {
        layer.st = Math.round((layer.st || 0) * scale)
        for (const prop of ['p', 's', 'r', 'o']) {
          const item = layer.ks && layer.ks[prop]
          if (item && item.a === 1 && Array.isArray(item.k)) {
            for (const keyframe of item.k) {
              keyframe.t = Math.round(keyframe.t * scale)
            }
          }
        }
      }
    }
  }

  return lottie
}

function parseCSS(css, options = {}) {
  const normalized = appendUtilityAnimationCSS(css)
  const variables = collectCSSVariables(normalized)
  const resolvedCSS = resolveCSSVariables(normalized, variables)
  const styleMap = new Map()
  for (const rule of parseCSSRules(resolvedCSS)) {
    styleMap.set(rule.selector, mergeDeclarationText(styleMap.get(rule.selector), rule.declarations))
  }
  const keyframes = {}
  for (const [name, body] of extractKeyframeBlocks(resolvedCSS)) {
    keyframes[name] = parseKeyframeBody(body)
  }
  return {
    rules: [...styleMap.entries()].map(([selector, declarations]) => ({
      selector,
      declarations: parseDeclarations(declarations),
    })),
    keyframes,
    variables,
    duration: inferAnimationDurationFromCSS(resolvedCSS, options),
  }
}

module.exports = {
  buildLottieFromCSS,
  buildLottieFromReact,
  buildLottieFromCode,
  inferAnimationDurationFromCode,
  inferAnimationDurationFromCSS,
  cssToLottie,
  isLikelyReactCode,
  extractReactCSS,
  parseCSS,
  parseColor,
  parseEasing,
  parseElementStyle,
  parseKeyframeBody,
}
