(() => {
  const NAMED_COLORS = {
    black: [0, 0, 0, 1],
    white: [1, 1, 1, 1],
    red: [1, 0, 0, 1],
    blue: [0, 0, 1, 1],
    green: [0, 0.502, 0, 1],
    transparent: [0, 0, 0, 0],
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function round(value) {
    return Math.round(value * 1000) / 1000
  }

  function parseColor(value) {
    const raw = String(value || '').trim().toLowerCase()
    if (!raw || raw === 'none') return [0, 0, 0, 0]
    if (NAMED_COLORS[raw]) return NAMED_COLORS[raw]

    let match = raw.match(/^#([0-9a-f]{3,8})$/i)
    if (match) {
      let hex = match[1]
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map(ch => ch + ch).join('')
      }
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return [r, g, b, a].map(round)
    }

    match = raw.match(/^rgba?\(([^)]+)\)$/)
    if (match) {
      const parts = match[1].split(/[,/ ]+/).filter(Boolean).map(Number)
      return [
        clamp((parts[0] || 0) / 255, 0, 1),
        clamp((parts[1] || 0) / 255, 0, 1),
        clamp((parts[2] || 0) / 255, 0, 1),
        clamp(parts.length > 3 ? parts[3] : 1, 0, 1),
      ].map(round)
    }

    const probe = document.createElement('span')
    probe.style.color = raw
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved === raw ? [0, 0, 0, 1] : parseColor(resolved)
  }

  function samplerError(stage, error) {
    const message = error && error.message ? error.message : String(error)
    const wrapped = new Error(`${stage}: ${message}`)
    if (error && error.stack) wrapped.stack = error.stack
    return wrapped
  }

  function safeComputedStyle(element, pseudoName = null) {
    try {
      return pseudoName ? getComputedStyle(element, pseudoName) : getComputedStyle(element)
    } catch (_) {
      return null
    }
  }

  function extractCSS(code) {
    const blocks = []
    for (const match of String(code || '').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      blocks.push(match[1].replace(/^\s*\{?\s*`?|`?\s*\}?\s*$/g, ''))
    }
    for (const match of String(code || '').matchAll(/styled(?:\.\w+|\([^)]*\))\s*`([\s\S]*?)`/g)) {
      blocks.push(match[1])
    }
    if (!blocks.length && /[.#\w\s:[\]>+~*-]+\{[\s\S]*?\}|@keyframes\b|@media\b/i.test(code)) {
      blocks.push(code)
    }
    return blocks.join('\n')
  }

  function extractMarkup(code) {
    const source = String(code || '')
    const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')

    const html = source
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/className=/g, 'class=')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\s+[A-Za-z_$][\w$]*=\{[\s\S]*?\}/g, '')
    const tags = html.match(/<(?:div|span|section|article|button|main|aside|header|footer|ul|li)\b[\s\S]*?>[\s\S]*?<\/(?:div|span|section|article|button|main|aside|header|footer|ul|li)>/i)
    return tags ? tags[0] : ''
  }

  function selectorParts(selector) {
    return String(selector || '')
      .replace(/:(hover|active|focus)/g, '')
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/::(?:before|after)/g, '')
      .split(/\s+/)
      .map(part => part.trim())
      .filter(Boolean)
  }

  function applySimpleSelector(element, selector) {
    const id = selector.match(/#([A-Za-z0-9_-]+)/)
    if (id) element.id = id[1]
    for (const classMatch of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      element.classList.add(classMatch[1])
    }
  }

  function createElementForSelector(selector, index) {
    const parts = selectorParts(selector)
    const root = document.createElement('div')
    root.className = 'sampler-created-root'
    let current = root
    const effectiveParts = parts.length ? parts : ['.sampled']
    effectiveParts.forEach((part, partIndex) => {
      const tag = /^[a-z][\w-]*/i.test(part) ? part.match(/^[a-z][\w-]*/i)[0] : 'div'
      const element = document.createElement(tag)
      applySimpleSelector(element, part)
      if (partIndex === effectiveParts.length - 1) {
        element.dataset.lottieSample = 'true'
        element.textContent = element.textContent || ''
      }
      current.appendChild(element)
      current = element
    })
    root.dataset.createdSelector = selector || `sample-${index}`
    return root
  }

  function baseSelector(selector) {
    return String(selector || '')
      .split(',')
      .map(part => part.trim())
      .find(Boolean)
      ?.replace(/:(hover|active|focus)/g, '')
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/::(?:before|after)/g, '')
      .trim() || ''
  }

  function selectorDepth(selector) {
    return selectorParts(selector).length
  }

  function maxNthChildForSelector(css, selector) {
    const className = String(selector || '').match(/\.([A-Za-z0-9_-]+)/)?.[1]
    if (!className) return 0
    let max = 0
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\.${escaped}:nth-child\\((\\d+)\\)`, 'g')
    for (const match of String(css || '').matchAll(re)) {
      max = Math.max(max, Number(match[1] || 0))
    }
    return max
  }

  function selectorClassName(selector) {
    return String(selector || '').match(/\.([A-Za-z0-9_-]+)/)?.[1] || ''
  }

  function inferredContainerSelector(css, childSelector) {
    const childClass = selectorClassName(childSelector)
    if (!childClass.includes('__')) return ''
    const parentClass = childClass.split('__')[0]
    const parentSelector = `.${parentClass}`
    const escaped = parentClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\.${escaped}\\s*\\{`).test(css) ? parentSelector : ''
  }

  function appendPseudoSampleElement(element, pseudoName) {
    const pseudoStyle = safeComputedStyle(element, pseudoName)
    if (!pseudoStyle) return null
    const content = pseudoStyle.content
    const hasContent = content && content !== 'none' && content !== 'normal'
    const hasSize = parseFloat(pseudoStyle.width) > 0 && parseFloat(pseudoStyle.height) > 0
    if (!hasContent && !hasSize) return null

    const sample = document.createElement('span')
    sample.dataset.lottieSample = 'true'
    sample.dataset.pseudo = pseudoName
    sample.className = `sampler-pseudo sampler-${pseudoName.slice(2)}`
    sample.style.cssText = `
      position: static;
      display: block;
      flex: 0 0 auto;
      width: ${pseudoStyle.width};
      height: ${pseudoStyle.height};
      border-radius: ${pseudoStyle.borderRadius};
      background: ${pseudoStyle.backgroundColor};
      opacity: ${pseudoStyle.opacity};
      transform: ${pseudoStyle.transform};
      transform-origin: ${pseudoStyle.transformOrigin};
      box-shadow: ${pseudoStyle.boxShadow};
    `
    sample.style.animationName = pseudoStyle.animationName
    sample.style.animationDuration = pseudoStyle.animationDuration
    sample.style.animationTimingFunction = pseudoStyle.animationTimingFunction
    sample.style.animationDelay = pseudoStyle.animationDelay
    sample.style.animationIterationCount = pseudoStyle.animationIterationCount
    sample.style.animationDirection = pseudoStyle.animationDirection
    sample.style.animationFillMode = pseudoStyle.animationFillMode
    element.appendChild(sample)
    return sample
  }

  function createFallbackMarkup(css) {
    const candidates = []
    try {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules || []) {
          if (rule.type !== CSSRule.STYLE_RULE) continue
          const text = rule.style.cssText || ''
          if (!/(^|;)\s*(animation|transition|transform|opacity|filter|box-shadow)\b/i.test(text) && !/:hover|:active|:focus/.test(rule.selectorText)) continue
          const selector = baseSelector(rule.selectorText)
          if (selector && !selector.includes('*') && !selector.includes('::') && !candidates.includes(selector)) {
            candidates.push(selector)
          }
        }
      }
    } catch (_) {
      for (const match of String(css || '').matchAll(/([^{}@]+)\{[^{}]*(?:animation|transition|transform|opacity|filter|box-shadow)[^{}]*\}/gi)) {
        const selector = baseSelector(match[1])
        if (selector && !candidates.includes(selector)) candidates.push(selector)
      }
    }

    const stage = document.createElement('div')
    stage.className = 'sampler-stage'
    stage.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
    const sorted = candidates
      .slice(0, 24)
      .sort((a, b) => selectorDepth(a) - selectorDepth(b))
    const childSelector = sorted.find(selector => maxNthChildForSelector(css, selector) > 1)
      || sorted.find(selector => selectorDepth(selector) > 1)
      || sorted[0]
    const inferredParent = inferredContainerSelector(css, childSelector)
    const containerSelector = inferredParent || sorted.find(selector => selectorDepth(selector) === 1 && selector !== childSelector) || '.sampled'
    const childCount = childSelector ? Math.max(1, maxNthChildForSelector(css, childSelector), 1) : 0

    if (childSelector && childCount > 1) {
      const rootParts = selectorParts(containerSelector)
      const childParts = selectorParts(childSelector)
      const root = createElementForSelector(rootParts[0] || containerSelector, 0)
      const rootTarget = root.querySelector('[data-lottie-sample="true"]') || root
      rootTarget.removeAttribute('data-lottie-sample')
      const childPart = childParts[childParts.length - 1] || childSelector
      for (let index = 0; index < childCount; index++) {
        const child = document.createElement('div')
        applySimpleSelector(child, childPart)
        rootTarget.appendChild(child)
      }
      stage.appendChild(root)
    } else {
      sorted.forEach((selector, index) => {
        stage.appendChild(createElementForSelector(selector, index))
      })
    }
    return stage
  }

  function ensureSampleDocument(code, options) {
    try {
      const width = Number(options.width || 390)
      const height = Number(options.height || 390)
      const css = extractCSS(code)
      const markup = extractMarkup(code)

      document.documentElement.innerHTML = ''
      const head = document.createElement('head')
      const body = document.createElement('body')
      document.documentElement.append(head, body)

      const baseStyle = document.createElement('style')
      baseStyle.textContent = `
        html, body {
          width: ${width}px;
          height: ${height}px;
          margin: 0;
          overflow: hidden;
          background: transparent;
        }
        body {
          position: relative;
          display: block;
        }
        .sampler-created-root {
          position: relative;
          display: inline-block;
          width: auto;
          height: auto;
        }
        .sampler-created-root > [data-lottie-sample="true"]:empty {
          width: 40px;
          height: 40px;
          display: block;
        }
      `
      head.appendChild(baseStyle)

      const style = document.createElement('style')
      style.textContent = css
        .replace(/:hover/g, '.sampler-hover')
        .replace(/:active/g, '.sampler-active')
        .replace(/:focus/g, '.sampler-focus')
      head.appendChild(style)

      const container = document.createElement('div')
      container.id = 'sampler-root'
      container.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:transparent;`
      container.innerHTML = markup
      body.appendChild(container)

      if (!container.children.length) {
        container.appendChild(createFallbackMarkup(css))
      }

      for (const element of [...container.querySelectorAll('*')]) {
        appendPseudoSampleElement(element, '::before')
        appendPseudoSampleElement(element, '::after')
      }

      const descendants = [...container.querySelectorAll('*')].filter(el => {
        const tag = el.tagName.toLowerCase()
        return tag !== 'script' && tag !== 'style'
      })
      if (!descendants.some(el => el.dataset.lottieSample === 'true')) {
        for (const element of descendants) {
          const style = safeComputedStyle(element)
          if (!style) continue
          const animated = style.animationName !== 'none' ||
            style.transitionProperty !== 'all' ||
            style.transform !== 'none' ||
            Number(style.opacity) < 1 ||
            style.filter !== 'none' ||
            style.boxShadow !== 'none'
          if (animated || element.children.length === 0) {
            element.dataset.lottieSample = 'true'
          }
        }
      }
    } catch (error) {
      throw samplerError('准备采样 DOM 失败', error)
    }
  }

  function nextFrame() {
    return new Promise(resolve => setTimeout(resolve, 0))
  }

  function flushLayout(root) {
    void (root || document.documentElement).offsetWidth
  }

  function animationDurationMs(fallbackMs) {
    const animations = document.getAnimations({ subtree: true })
    let maxMs = 0
    for (const animation of animations) {
      const timing = animation.effect && animation.effect.getTiming ? animation.effect.getTiming() : null
      if (!timing) continue
      const duration = timing.duration === Infinity ? 1000 : Number(timing.duration || 0)
      const delay = Number(timing.delay || 0)
      const iterations = timing.iterations === Infinity ? 1 : Number(timing.iterations || 1)
      maxMs = Math.max(maxMs, delay + duration * Math.max(1, iterations))
    }
    return Math.max(100, Number(fallbackMs || 0) || maxMs || 1000)
  }

  function setTimeline(ms) {
    const animations = document.getAnimations({ subtree: true })
    for (const animation of animations) {
      try {
        animation.pause()
        animation.currentTime = ms
      } catch (_) {}
    }
  }

  function matrixParts(transform) {
    if (!transform || transform === 'none') {
      return { scaleX: 1, scaleY: 1, rotation: 0 }
    }
    const values = transform.match(/matrix\(([^)]+)\)/)
    if (!values) return { scaleX: 1, scaleY: 1, rotation: 0 }
    const [a, b, c, d] = values[1].split(',').map(Number)
    return {
      scaleX: Math.sqrt(a * a + b * b) || 1,
      scaleY: Math.sqrt(c * c + d * d) || 1,
      rotation: Math.atan2(b, a) * 180 / Math.PI,
    }
  }

  function snapshotElement(element, rootRect, frame) {
    const rect = element.getBoundingClientRect()
    const style = safeComputedStyle(element)
    if (!style) throw new Error('无法读取元素 computed style')
    const matrix = matrixParts(style.transform)
    const width = parseFloat(style.width) || rect.width || 1
    const height = parseFloat(style.height) || rect.height || 1
    const background = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? style.backgroundColor
      : style.color

    return {
      frame,
      x: round(rect.left - rootRect.left + rect.width / 2),
      y: round(rect.top - rootRect.top + rect.height / 2),
      width: round(width),
      height: round(height),
      rectWidth: round(rect.width || width),
      rectHeight: round(rect.height || height),
      opacity: round((parseFloat(style.opacity) || 0) * 100),
      rotation: round(matrix.rotation),
      scaleX: round(matrix.scaleX * 100),
      scaleY: round(matrix.scaleY * 100),
      color: parseColor(background),
      radius: round(parseFloat(style.borderRadius) || 0),
      boxShadow: style.boxShadow,
      filter: style.filter,
    }
  }

  function compressTrack(frames, pick, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
    if (!frames.length) return []
    const out = []
    for (let i = 0; i < frames.length; i++) {
      const value = pick(frames[i])
      const previous = i > 0 ? pick(frames[i - 1]) : null
      const next = i < frames.length - 1 ? pick(frames[i + 1]) : null
      const keep = i === 0 || i === frames.length - 1 || !equal(value, previous) || !equal(value, next)
      if (keep) out.push({ frame: frames[i].frame, value })
    }
    return out
  }

  function numberEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01
  }

  function vectorEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => numberEqual(value, b[index]))
  }

  function colorEqual(a, b) {
    return vectorEqual(a, b)
  }

  function animatedProperty(track, equal, fallback) {
    if (!track.length) return { a: 0, k: fallback }
    if (track.length === 1 || track.every(item => equal(item.value, track[0].value))) {
      return { a: 0, k: track[0].value }
    }
    return {
      a: 1,
      k: track.map((item, index) => {
        if (index === track.length - 1) {
          return { t: item.frame, s: item.value }
        }
        return {
          t: item.frame,
          s: item.value,
          e: track[index + 1].value,
          i: { x: [1], y: [1] },
          o: { x: [0], y: [0] },
        }
      }),
    }
  }

  function shapeLayerFromSamples(name, index, samples, totalFrames) {
    const first = samples[0]
    const positionTrack = compressTrack(samples, sample => [sample.x, sample.y, 0], vectorEqual)
    const scaleTrack = compressTrack(samples, sample => [sample.scaleX, sample.scaleY, 100], vectorEqual)
    const rotationTrack = compressTrack(samples, sample => sample.rotation, numberEqual)
    const opacityTrack = compressTrack(samples, sample => sample.opacity, numberEqual)
    const sizeTrack = compressTrack(samples, sample => [sample.width, sample.height], vectorEqual)
    const radiusTrack = compressTrack(samples, sample => sample.radius, numberEqual)
    const colorTrack = compressTrack(samples, sample => sample.color, colorEqual)

    return {
      ddd: 0,
      ind: index,
      ty: 4,
      nm: name,
      sr: 1,
      ks: {
        o: animatedProperty(opacityTrack, numberEqual, 100),
        r: animatedProperty(rotationTrack, numberEqual, 0),
        p: animatedProperty(positionTrack, vectorEqual, [first.x, first.y, 0]),
        a: { a: 0, k: [0, 0, 0] },
        s: animatedProperty(scaleTrack, vectorEqual, [100, 100, 100]),
      },
      ao: 0,
      shapes: [{
        ty: 'gr',
        nm: 'group',
        it: [
          {
            ty: 'rc',
            nm: 'shape',
            d: 1,
            s: animatedProperty(sizeTrack, vectorEqual, [first.width, first.height]),
            p: { a: 0, k: [0, 0] },
            r: animatedProperty(radiusTrack, numberEqual, first.radius),
          },
          {
            ty: 'fl',
            nm: 'fill',
            c: animatedProperty(colorTrack, colorEqual, first.color),
            o: { a: 0, k: 100 },
            r: 1,
          },
          {
            ty: 'tr',
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
            sk: { a: 0, k: 0 },
            sa: { a: 0, k: 0 },
          },
        ],
      }],
      ip: 0,
      op: totalFrames,
      st: 0,
    }
  }

  function centerSamples(samplesByElement, width, height) {
    const all = [...samplesByElement.values()].flatMap(entry => entry.frames)
    if (!all.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const sample of all) {
      const halfW = (sample.rectWidth || sample.width || 0) / 2
      const halfH = (sample.rectHeight || sample.height || 0) / 2
      minX = Math.min(minX, sample.x - halfW)
      maxX = Math.max(maxX, sample.x + halfW)
      minY = Math.min(minY, sample.y - halfH)
      maxY = Math.max(maxY, sample.y + halfH)
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return
    const dx = width / 2 - (minX + maxX) / 2
    const dy = height / 2 - (minY + maxY) / 2
    for (const sample of all) {
      sample.x = round(sample.x + dx)
      sample.y = round(sample.y + dy)
    }
  }

  function sampleSync(code, options = {}) {
    try {
      const fps = Number(options.fps || 60)
      const width = Number(options.width || 390)
      const height = Number(options.height || 390)
      ensureSampleDocument(code, { width, height })

      const durationMs = animationDurationMs(options.durationMs)
      const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps))
      const root = document.getElementById('sampler-root')
      if (!root) throw new Error('缺少 sampler-root')
      flushLayout(root)
      const rootRect = root.getBoundingClientRect()
      const elements = [...root.querySelectorAll('[data-lottie-sample="true"]')].filter(element => {
        const rect = element.getBoundingClientRect()
        const style = safeComputedStyle(element)
        return style && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      })

      if (!elements.length) {
        throw new Error('浏览器采样没有找到可见动画元素')
      }

      for (const element of root.querySelectorAll('*')) {
        element.classList.add('sampler-hover', 'sampler-active', 'sampler-focus')
      }
      flushLayout(root)

      const samplesByElement = new Map(elements.map((element, index) => [element, {
        name: element.id || [...element.classList].filter(name => !name.startsWith('sampler-')).join('.') || `element-${index + 1}`,
        frames: [],
      }]))

      for (let frame = 0; frame <= totalFrames; frame++) {
        const ms = frame / fps * 1000
        setTimeline(ms)
        flushLayout(root)
        for (const element of elements) {
          samplesByElement.get(element).frames.push(snapshotElement(element, rootRect, frame))
        }
      }

      centerSamples(samplesByElement, width, height)

      const layers = [...samplesByElement.values()]
        .map((entry, index) => shapeLayerFromSamples(entry.name || `sample-${index + 1}`, index + 1, entry.frames, totalFrames))
        .reverse()

      return {
        v: '5.9.0',
        fr: fps,
        ip: 0,
        op: totalFrames,
        w: width,
        h: height,
        nm: 'browser-sampled-animation',
        ddd: 0,
        assets: [],
        layers,
        meta: {
          g: 'browser-sampler-v1',
          sourceType: 'browser-sampled-css-html',
          cssAnimationDuration: Math.round(durationMs),
          sampledFrames: totalFrames + 1,
          sampledElements: layers.length,
          unsupportedApproximations: ['filter', 'box-shadow', 'text-layout', 'gradient'],
        },
      }
    } catch (error) {
      if (error && error.message && error.message.includes(':')) throw error
      throw samplerError('采样失败', error)
    }
  }

  async function sample(code, options = {}) {
    return sampleSync(code, options)
  }

  window.__lottieBrowserSampler = { sample, sampleSync }
})()
