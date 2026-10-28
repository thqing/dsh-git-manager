/**
 * Client bundle tests: load the browser module the way the page's module loader
 * does, install it into a fake Client context, and render the panel with a
 * minimal React shim so the whole view tree is exercised without a browser.
 * Run with: node --test dsh-git-manager/test/client.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** Minimal React element shim with the hook surface the panel uses. */
function createReactShim(initialStates = [], recorder = null, holder = null) {
  const queue = [...initialStates]
  let ordinal = 0
  let refOrdinal = 0
  function createElement(type, props, ...children) {
    const list = []
    const push = (child) => {
      if (child === null || child === undefined || typeof child === 'boolean') return
      if (Array.isArray(child)) {
        child.forEach(push)
        return
      }
      list.push(child)
    }
    children.forEach(push)
    return { $$element: true, type, props: props ?? {}, children: list }
  }
  return {
    createElement,
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = ordinal
      ordinal += 1
      const value = queue.length > 0 ? queue.shift() : (typeof initial === 'function' ? initial() : initial)
      return [value, (next) => { if (recorder) recorder(index, next) }]
    },
    useEffect() {},
    useMemo(factory) { return factory() },
    useCallback(factory) { return factory },
    useRef(value) {
      if (!holder) return { current: value }
      // Refs persist across renders, like React's, and stay reachable for tests.
      const index = refOrdinal
      refOrdinal += 1
      if (!holder.refs[index]) holder.refs[index] = { current: value }
      return holder.refs[index]
    },
  }
}

/** Load the bundle exactly as `window.__ModuleLoader__.load` would. */
function loadBundle(initialStates, recorder, holder) {
  const react = createReactShim(initialStates, recorder, holder)
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
  }
  // eslint-disable-next-line no-eval
  new Function('window', source)(globalThis.window)
  assert.equal(definition.id, '@local/dsh-git-manager')
  const moduleExports = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected module request: ${name}`)
  })
  return moduleExports
}

/** Install the module into a fake Client context and return its registrations. */
function install(moduleExports, { localeBind } = {}) {
  const registrations = []
  const injected = []
  const effects = []
  const ctx = {
    effect(factory, label) {
      effects.push(label)
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    logger: { warn: () => {} },
    locale: {
      register: () => () => {},
      // Tests read locale keys by default; pass `localeBind` to exercise the
      // bundle's own dictionary fallback instead.
      bind: localeBind ?? (() => (key) => key),
    },
    slots: {
      inject(key, callback) {
        injected.push(key)
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)
  return { registrations, injected, effects }
}

/** Collect every string and element type in a rendered tree. */
function walk(element, out = { text: [], types: [], classes: [] }) {
  if (element === null || element === undefined) return out
  if (typeof element === 'string' || typeof element === 'number') {
    out.text.push(String(element))
    return out
  }
  if (Array.isArray(element)) {
    element.forEach((child) => walk(child, out))
    return out
  }
  if (element.$$element !== true) return out
  out.types.push(typeof element.type === 'string' ? element.type : (element.type?.name ?? 'component'))
  if (typeof element.props.className === 'string') out.classes.push(element.props.className)
  element.children.forEach((child) => walk(child, out))
  // Inline components (the graph cell, the glyph) render on invocation.
  if (typeof element.type === 'function') walk(element.type(element.props), out)
  return out
}

/** Render the registered main panel; the state queue came from `loadBundle`. */
function renderPanel(registrations) {
  const main = registrations.find((entry) => entry.options.name === 'main')
  const wrapper = main.component({ t: (key) => key })
  // The wrapper returns the panel element; invoking its type runs the render.
  return wrapper.type(wrapper.props)
}

const SNAPSHOT = {
  repo: { root: '/repo/plm', name: 'plm' },
  summary: { name: 'plm', branch: 'thq-dev', changeCount: 2 },
  identity: { userName: 'tianhaiqing', userEmail: 't@example.com' },
  status: {
    branch: 'thq-dev',
    upstream: 'origin/thq-dev',
    ahead: 19,
    behind: 0,
    detached: false,
    files: [
      { path: 'a.txt', index: 'M', worktree: '.', staged: true, unstaged: false, untracked: false },
      { path: 'b.txt', index: '.', worktree: 'M', staged: false, unstaged: true, untracked: false },
      { path: 'c.txt', index: '?', worktree: '?', staged: false, unstaged: true, untracked: true },
    ],
  },
  branches: {
    head: 'thq-dev',
    detached: false,
    local: [
      { name: 'thq-dev', current: true, upstream: 'origin/thq-dev', ahead: 19, behind: 0 },
      { name: 'master', current: false },
      { name: 'backup/devOriginalMenuStyle', current: false },
    ],
    remotes: [{
      remote: 'origin',
      branches: [
        { name: 'origin/thq-dev' },
        { name: 'origin' },
        { name: 'origin/master' },
        { name: 'origin/cursor/drop-service-prefix-e035' },
        { name: 'origin/cursor/remove-legacy-shell-e035' },
        { name: 'origin/wushan/wushanMaster' },
      ],
    }],
    tags: [{ name: 'v1.0.0' }, { name: 'release/v2.0.0' }],
  },
  log: {
    end: true,
    commits: [
      { hash: 'e'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)], author: 'tianhaiqing', email: 't@example.com', commitDate: Date.now(), subject: 'Merge branch feature/x into thq-dev', refs: [], pushed: false },
      { hash: 'c'.repeat(40), parents: ['b'.repeat(40)], author: 'tianhaiqing', email: 't@example.com', commitDate: Date.now() - 30000, subject: 'fix(web-core): 页面内容区无法滚动', refs: ['HEAD -> thq-dev'], pushed: false },
      { hash: 'd'.repeat(40), parents: ['b'.repeat(40)], author: 'tianhaiqing', email: 't@example.com', commitDate: Date.now() - 45000, subject: 'feat: 侧分支提交', refs: ['origin/thq-dev'], pushed: true },
      { hash: 'b'.repeat(40), parents: ['a'.repeat(40)], author: 'tianhaiqing', email: 't@example.com', commitDate: Date.now() - 60000, subject: 'docs(swan): 总纲更新', refs: [], pushed: true },
      { hash: 'a'.repeat(40), parents: [], author: 'tianhaiqing', email: 't@example.com', commitDate: Date.now() - 120000, subject: 'feat: 初始提交', refs: ['tag: v1.0.0'], pushed: true },
    ],
  },
  stashes: [{ index: 0, selector: 'stash@{0}', subject: 'WIP on thq-dev: 1234567 abc', date: Date.now() }],
  remotes: [{ name: 'origin', fetchUrl: 'git@github.com:acme/plm.git', pushUrl: 'git@github.com:acme/plm.git' }],
}

test('the bundle registers a sidebar icon and the git main panel', () => {
  const moduleExports = loadBundle()
  const { registrations, injected, effects } = install(moduleExports)
  assert.deepEqual(injected, ['sidebar.panellist', 'main'])
  assert.equal(registrations.length, 2)
  const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.equal(icon.options.id, 'git')
  assert.equal(typeof icon.options.label, 'function')
  assert.equal(icon.options.order, 7)
  assert.equal(main.options.key, 'git')
  assert.equal(typeof icon.component, 'function')
  assert.equal(typeof main.component, 'function')
  assert.ok(effects.some((label) => String(label).includes('dictionary')))
})

test('the sidebar glyph renders an svg at the requested size', () => {
  const moduleExports = loadBundle()
  const { registrations } = install(moduleExports)
  const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const element = icon.component({ size: 18, active: false })
  assert.equal(element.type, 'svg')
  assert.equal(element.props.width, 18)
  assert.equal(element.children.length, 5)
})

test('the panel renders the empty state when no repository is available', () => {
  const moduleExports = loadBundle()
  const { registrations } = install(moduleExports)
  const tree = renderPanel(registrations)
  const info = walk(tree)
  assert.ok(info.classes.includes('dg-root'))
  assert.ok(info.types.includes('style'))
  assert.ok(info.text.some((line) => line.includes('repo.none')))
})

test('the panel renders branch tree, graph, log and status from a snapshot', () => {
  const states = [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }], // repos
    '/repo/plm', // repoPath
    SNAPSHOT, // snapshot
    false, // loading
    null, // busy
    null, // notice
    '', // filter
    false, // allRefs
    null, // logRef
    null, // selection
    null, // detail
    null, // diff
    false, // diffLoading
    'changes', // tab
    'fix: something', // message
    false, // amend
    {}, // checked
    {}, // collapsed
    null, // menu
    null, // dialog
  ]
  const { registrations } = install(loadBundle(states))
  const info = walk(renderPanel(registrations))
  assert.ok(info.classes.includes('dg-toolbar'))
  assert.ok(info.types.includes('svg'), 'the commit graph draws svg cells')
  for (const expected of ['thq-dev', 'master', 'origin', 'v1.0.0', 'fix(web-core): 页面内容区无法滚动', 'a.txt', 'b.txt', 'c.txt']) {
    assert.ok(info.text.some((line) => line.includes(expected)), `missing ${expected}`)
  }
  assert.ok(info.text.some((line) => line.includes('/repo/plm')), 'the status bar shows the repository path')
  assert.ok(info.text.some((line) => line.includes('tianhaiqing')), 'the status bar shows the commit identity')
})

test('the diff tab renders classified unified-diff lines', () => {
  const diffText = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-old line',
    '+new line',
    ' context',
  ].join('\n')
  const states = [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }],
    '/repo/plm',
    SNAPSHOT,
    false,
    null,
    null,
    '',
    false,
    null,
    { type: 'commit', hash: 'c'.repeat(40) },
    null,
    { title: 'abc123 提交差异', text: diffText },
    false,
    'diff',
    '',
    false,
    {},
    {},
    null,
    null,
  ]
  const { registrations } = install(loadBundle(states))
  const info = walk(renderPanel(registrations))
  assert.ok(info.classes.includes('dg-l-add'))
  assert.ok(info.classes.includes('dg-l-del'))
  assert.ok(info.classes.includes('dg-l-hunk'))
  assert.ok(info.classes.includes('dg-l-meta'))
  assert.ok(info.text.some((line) => line.includes('new line')))
})

test('the panel keeps its state slots stable for the scripted shim', () => {
  // Guards this test file: a hook-order change in GitPanel fails loudly here.
  const states = [
    [], '/repo/plm', SNAPSHOT, false, null, null, '', false, null, null,
    null, null, false, 'changes', '', false, {}, {}, null, null,
  ]
  const { registrations } = install(loadBundle(states))
  const tree = renderPanel(registrations)
  assert.ok(walk(tree).classes.includes('dg-root'))
})

test('branch names with slashes render as collapsible folders', () => {
  const states = [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }], '/repo/plm', SNAPSHOT, false, null, null,
    '', false, null, null, null, null, false, 'changes', '', false, {}, {}, null, null,
  ]
  const { registrations } = install(loadBundle(states))
  const tree = renderPanel(registrations)
  const info = walk(tree)
  // Folder rows exist and are marked as such.
  assert.ok(info.classes.some((name) => name.includes('dg-folder')), 'expected folder rows')
  // The leaf keeps only its own segment; the folder carries the prefix.
  assert.ok(info.text.some((line) => line === 'backup'), 'local folder backup')
  assert.ok(info.text.some((line) => line === 'devOriginalMenuStyle'), 'nested local branch leaf')
  assert.ok(info.text.some((line) => line === 'cursor'), 'remote folder cursor')
  assert.ok(info.text.some((line) => line === 'drop-service-prefix-e035'), 'nested remote leaf')
  assert.ok(info.text.some((line) => line === 'wushan'), 'remote folder wushan')
  assert.ok(info.text.some((line) => line === 'release'), 'tag folder release')
  // The remote name is no longer repeated inside every leaf label.
  assert.equal(info.text.includes('origin/cursor/drop-service-prefix-e035'), false)
})

test('the HEAD pointer and its branch render as two readable chips', () => {
  const states = [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }], '/repo/plm', SNAPSHOT, false, null, null,
    '', false, null, null, null, null, false, 'changes', '', false, {}, {}, null, null,
  ]
  const { registrations } = install(loadBundle(states))
  const tree = renderPanel(registrations)
  const heads = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    if (typeof element.props.className === 'string' && element.props.className.includes('dg-head')) heads.push(element)
    element.children.forEach(collect)
  }
  collect(tree)
  assert.ok(heads.length > 0, 'expected a HEAD chip')
  for (const chip of heads) {
    const text = walk(chip).text.join('').trim()
    assert.equal(text, 'HEAD', `HEAD chip must carry visible text, got "${text}"`)
  }
})

test('the palette never fills a chip or button with the monochrome brand color', () => {
  const { registrations } = install(loadBundle())
  const tree = renderPanel(registrations)
  const styles = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    if (element.type === 'style') styles.push(element.children.join(''))
    element.children.forEach(collect)
  }
  collect(tree)
  const css = styles.join('\n')
  assert.ok(css.length > 0, 'the panel ships its own stylesheet')
  // brand-primary is near-white on the dark theme: it may not carry white text.
  assert.equal(/background:\s*var\(--dg-accent\)/.test(css), false)
  assert.equal(css.includes('color:#fff;background:var(--dg-accent)'), false)
  assert.ok(css.includes('--dg-accent:var(--dsw-alias-state-business-primary'))
  assert.ok(css.includes('--dg-fill-fg:var(--dsw-alias-label-primary-foreground'))
})

test('a bare remote-named entry is not drawn as a branch leaf', () => {
  const states = [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }], '/repo/plm', SNAPSHOT, false, null, null,
    '', false, null, null, null, null, false, 'changes', '', false, {}, {}, null, null,
  ]
  const { registrations } = install(loadBundle(states))
  const tree = renderPanel(registrations)
  const leafLabels = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    const cls = typeof element.props.className === 'string' ? element.props.className : ''
    if (cls.includes('dg-row') && !cls.includes('dg-folder')) leafLabels.push(walk(element).text.join('').trim())
    element.children.forEach(collect)
  }
  collect(tree)
  // The remote group row itself is a folder row, so the only 'origin' row left is it.
  // (the Remotes section legitimately lists a remote named origin; only a
  // branch-group leaf rendered as a bare 'origin' is the phantom)
  assert.equal(leafLabels.filter((label) => label === 'origin').length, 0)
  assert.ok(leafLabels.includes('thq-dev'))
})

/** State tuple for the changes tab with the shared snapshot. */
function changesStates() {
  return [
    [{ path: '/repo/plm', title: 'PLM', isRepo: true }], '/repo/plm', SNAPSHOT, false, null, null,
    '', false, null, null, null, null, false, 'changes', '', false, {}, {}, null, null,
  ]
}

test('clicking an untracked file asks the Host for an untracked diff', () => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => ({ ok: true, data: { diff: 'diff --git a/c.txt b/c.txt\n+hi\n' } }),
    }
  }
  try {
    const { registrations } = install(loadBundle(changesStates()))
    const tree = renderPanel(registrations)
    let target = null
    const find = (element) => {
      if (!element || typeof element !== 'object') return
      if (Array.isArray(element)) {
        element.forEach(find)
        return
      }
      if (element.$$element !== true) return
      const cls = typeof element.props.className === 'string' ? element.props.className : ''
      if (cls.includes('dg-file') && walk(element).text.join('').includes('c.txt')) target = element
      element.children.forEach(find)
    }
    find(tree)
    assert.ok(target, 'the untracked file row renders')
    target.props.onClick()
    assert.equal(requests.length, 1, 'one Host call was issued')
    assert.equal(requests[0].body.op, 'diff')
    assert.equal(requests[0].body.path, 'c.txt')
    assert.equal(requests[0].body.untracked, true, 'the untracked flag reaches the Host')
    assert.equal(requests[0].body.repo, '/repo/plm')
  } finally {
    delete globalThis.fetch
  }
})

test('a selected file with no text diff explains itself instead of asking for a selection', () => {
  const states = changesStates()
  states[11] = { title: 'blob.bin', text: '', binary: false } // diff
  states[13] = 'diff' // tab
  const emptyInfo = walk(renderPanel(install(loadBundle(states)).registrations))
  assert.ok(emptyInfo.text.some((line) => line.includes('diff.empty')))
  assert.equal(emptyInfo.text.some((line) => line.includes('changes.noneSelected')), false)

  const binaryStates = changesStates()
  binaryStates[11] = { title: 'blob.bin', text: '', binary: true }
  binaryStates[13] = 'diff'
  const binaryInfo = walk(renderPanel(install(loadBundle(binaryStates)).registrations))
  assert.ok(binaryInfo.text.some((line) => line.includes('diff.binary')))
})

test('graph lines continue from one row into the next and share one column width', () => {
  const { registrations } = install(loadBundle(changesStates()))
  const tree = renderPanel(registrations)
  const svgs = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    if (typeof element.type === 'function') {
      collect(element.type(element.props))
      return
    }
    if (element.type === 'svg') {
      // Tree glyphs are svgs too; only the commit graph cells matter here.
      if (String(element.props.className ?? '').includes('dg-graph')) svgs.push(element)
      return
    }
    element.children.forEach(collect)
  }
  collect(tree)
  assert.equal(svgs.length, SNAPSHOT.log.commits.length, 'one graph cell per commit')
  assert.equal(new Set(svgs.map((svg) => svg.props.width)).size, 1, 'every row shares one width')

  const linesOf = (svg) => svg.children
    .filter((child) => child.$$element === true && child.type === 'line')
    .map((child) => child.props)

  for (const svg of svgs) {
    // The overlap tail must not be clipped away.
    assert.equal(svg.props.style?.overflow, 'visible')
  }

  for (let index = 0; index + 1 < svgs.length; index += 1) {
    // Every segment deliberately overshoots its cell by 1px, so two stacked rows
    // share a 2px band of ink and no renderer can leave a seam between them.
    const downward = linesOf(svgs[index]).filter((line) => line.y2 === 27)
    assert.ok(downward.length > 0, `row ${index} draws a line past its bottom edge`)
    for (const line of downward) {
      const continued = linesOf(svgs[index + 1]).some((next) => next.y1 === -1 && next.x1 === line.x1)
      assert.ok(continued, `row ${index} → ${index + 1}: the line at x=${line.x1} never continues`)
    }
  }
})

/** The panel now has 22 state slots; `selection` is slot 9, `supportsSquash` 21. */
function panelStates(overrides = {}) {
  // 0 repos … 21 supportsSquash, 22 supportsUpdate, 23 supportsReword
  const states = new Array(24).fill(undefined)
  Object.assign(states, {
    0: [{ path: '/repo/plm', title: 'PLM', isRepo: true }],
    1: '/repo/plm',
    2: SNAPSHOT,
    3: false,
    4: null,
    5: null,
    6: '',
    7: false,
    8: null,
    9: null,
    10: null,
    11: null,
    12: false,
    13: 'changes',
    14: '',
    15: false,
    16: {},
    17: {},
    18: null,
    19: null,
    20: null,
    21: false,
  }, overrides)
  return states
}

/** Commit row elements in render order. */
function commitRows(tree) {
  const rows = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    if (typeof element.type === 'function') {
      collect(element.type(element.props))
      return
    }
    const cls = typeof element.props.className === 'string' ? element.props.className : ''
    if (cls.includes('dg-commit')) rows.push(element)
    element.children.forEach(collect)
  }
  collect(tree)
  return rows
}

const HASHES = SNAPSHOT.log.commits.map((commit) => commit.hash)

test('shift-click extends the selection over the visible range', () => {
  const updates = []
  const states = panelStates({
    9: { type: 'commit', hash: HASHES[3], hashes: [HASHES[3]], anchor: HASHES[3] },
  })
  const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next })))
  const rows = commitRows(renderPanel(registrations))
  assert.equal(rows.length, HASHES.length)
  rows[1].props.onClick({ shiftKey: true })
  const selection = updates.filter((entry) => entry.index === 9).pop()
  assert.ok(selection, 'the selection slot was written')
  assert.deepEqual(selection.next.hashes, [HASHES[1], HASHES[2], HASHES[3]])
  assert.equal(selection.next.hash, HASHES[1], 'the clicked commit becomes the primary')
  assert.equal(selection.next.anchor, HASHES[3], 'the anchor stays put')
})

test('cmd-click toggles one commit out of the selection', () => {
  const updates = []
  const states = panelStates({
    9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1], HASHES[2]], anchor: HASHES[0] },
  })
  const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next })))
  const rows = commitRows(renderPanel(registrations))
  rows[1].props.onClick({ metaKey: true })
  const selection = updates.filter((entry) => entry.index === 9).pop()
  assert.deepEqual(selection.next.hashes, [HASHES[0], HASHES[2]])

  // Removing the last member clears the selection entirely.
  const single = panelStates({ 9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0]], anchor: HASHES[0] } })
  const second = []
  const another = install(loadBundle(single, (index, next) => second.push({ index, next })))
  commitRows(renderPanel(another.registrations))[0].props.onClick({ ctrlKey: true })
  assert.equal(second.filter((entry) => entry.index === 9).pop().next, null)
})

test('a plain click selects one commit and loads its tab', () => {
  const updates = []
  const { registrations } = install(loadBundle(panelStates(), (index, next) => updates.push({ index, next })))
  commitRows(renderPanel(registrations))[2].props.onClick({})
  const selection = updates.filter((entry) => entry.index === 9).pop()
  assert.deepEqual(selection.next, { type: 'commit', hash: HASHES[2], hashes: [HASHES[2]], anchor: HASHES[2] })
  assert.equal(updates.filter((entry) => entry.index === 13).pop().next, 'detail')
})

test('the commit menu offers Squash for a multi-selection only when the Host supports it', () => {
  const menuFor = (supports) => {
    const updates = []
    const states = panelStates({
      9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1]], anchor: HASHES[0] },
      21: supports,
    })
    const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next })))
    const rows = commitRows(renderPanel(registrations))
    rows[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 12, clientY: 24 })
    return updates.filter((entry) => entry.index === 18).pop().next.items
  }

  const supported = menuFor(true)
  const squash = supported.find((item) => item.label === 'menu.squashCount')
  assert.ok(squash, 'the range menu carries the squash entry')
  assert.equal(squash.disabled, false)
  assert.ok(supported.some((item) => item.label === 'menu.copyHashes'))
  assert.ok(supported.some((item) => item.label === 'menu.clearSelection'))
  // Single-commit rewrites are unavailable while a range is selected.
  assert.equal(supported.find((item) => item.label === 'menu.cherryPick').disabled, true)
  assert.equal(supported.find((item) => item.label === 'menu.detachAt').disabled, true)

  const unsupported = menuFor(false)
  const blocked = unsupported.find((item) => item.label === 'menu.squash')
  assert.ok(blocked, 'an older Host shows the plain label')
  assert.equal(blocked.disabled, true)

  // A single-commit menu has no range entries at all.
  const single = panelStates({
    9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0]], anchor: HASHES[0] },
    21: true,
  })
  const recorded = []
  const one = install(loadBundle(single, (index, next) => recorded.push({ index, next })))
  commitRows(renderPanel(one.registrations))[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 })
  const singleItems = recorded.filter((entry) => entry.index === 18).pop().next.items
  assert.equal(singleItems.some((item) => item.label === 'menu.squashCount'), false)
  assert.equal(singleItems.find((item) => item.label === 'menu.cherryPick').disabled, false)
})

test('the selection banner explains range actions in the details tab', () => {
  const info = walk(renderPanel(install(loadBundle(panelStates({
    9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1]], anchor: HASHES[0] },
    13: 'detail',
    21: true,
  }))).registrations))
  assert.ok(info.classes.includes('dg-selection'))
  assert.ok(info.text.some((line) => line.includes('selection.count')))
  assert.ok(info.text.some((line) => line.includes('selection.hint')))
})

test('squash re-attaches the branch when the Host generation left HEAD detached', async () => {
  const requests = []
  const squashedSha = 'f'.repeat(40)
  const previousHead = 'e'.repeat(40)
  let repaired = false
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    let data
    if (body.op === 'squashPreview') {
      data = {
        commits: SNAPSHOT.log.commits.slice(0, 2),
        defaultMessage: 'combined message',
        dirty: false,
      }
    } else if (body.op === 'squash') {
      data = { squash: { sha: squashedSha, count: 2, previousHead, output: '' } }
    } else if (body.op === 'snapshot') {
      // An old Host leaves HEAD detached until the panel re-attaches the branch.
      data = {
        ...SNAPSHOT,
        status: { ...SNAPSHOT.status, detached: !repaired, branch: repaired ? 'thq-dev' : null },
      }
    } else if (body.op === 'checkout') {
      data = { output: '' }
    } else if (body.op === 'reset') {
      repaired = true
      data = { output: '' }
    } else {
      data = {}
    }
    return { ok: true, json: async () => ({ ok: true, data }) }
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  try {
    const updates = []
    const holder = { refs: [] }
    const states = panelStates({
      2: { ...SNAPSHOT, status: { ...SNAPSHOT.status, branch: 'thq-dev', detached: false } },
      9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1]], anchor: HASHES[0] },
      21: true,
    })
    const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next }), holder))
    const rows = commitRows(renderPanel(registrations))
    rows[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 5, clientY: 5 })
    const items = updates.filter((entry) => entry.index === 18).pop().next.items
    const squashItem = items.find((item) => item.label === 'menu.squashCount')
    assert.ok(squashItem, 'the squash entry exists')

    squashItem.onSelect()
    await flush()
    // Answer the message dialog the way the user pressing Squash would.
    assert.equal(typeof holder.refs[0].current, 'function', 'the dialog resolver is pending')
    holder.refs[0].current({ value: 'squashed!' })
    await flush()
    await flush()

    const ops = requests.map((body) => body.op)
    assert.deepEqual(ops, ['squashPreview', 'squash', 'snapshot', 'checkout', 'reset', 'snapshot'])
    assert.equal(requests[1].message, 'squashed!')
    assert.deepEqual(requests[1].shas, [HASHES[0], HASHES[1]])
    assert.equal(requests[3].ref, 'thq-dev', 'the branch is checked out again')
    assert.equal(requests[4].ref, squashedSha)
    assert.equal(requests[4].mode, 'hard')
    const notice = updates.filter((entry) => entry.index === 5).pop().next
    assert.equal(notice.kind, 'ok')
    assert.match(notice.text, /toast.squashed/)
  } finally {
    delete globalThis.fetch
  }
})

test('the squash dialog shows the net change and warns when the range cancels out', async () => {
  const run = async (netEmpty) => {
    const updates = []
    const holder = { refs: [] }
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      const data = body.op === 'squashPreview'
        ? {
          commits: SNAPSHOT.log.commits.slice(0, 2),
          defaultMessage: 'combined',
          dirty: false,
          stat: { files: netEmpty ? 0 : 3, additions: netEmpty ? 0 : 12, deletions: netEmpty ? 0 : 4 },
          netEmpty,
        }
        : {}
      return { ok: true, json: async () => ({ ok: true, data }) }
    }
    const states = panelStates({
      9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1]], anchor: HASHES[0] },
      21: true,
    })
    const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next }), holder))
    const rows = commitRows(renderPanel(registrations))
    rows[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 3, clientY: 3 })
    const items = updates.filter((entry) => entry.index === 18).pop().next.items
    items.find((item) => item.label === 'menu.squashCount').onSelect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const dialog = updates.filter((entry) => entry.index === 19).pop().next
    return walk(dialog.extra()).text.join('')
  }

  try {
    const normal = await run(false)
    assert.ok(normal.includes('dialog.squash.stat'), 'a real net change is reported')
    assert.equal(normal.includes('dialog.squash.netEmpty'), false)
    const empty = await run(true)
    assert.ok(empty.includes('dialog.squash.netEmpty'), 'a cancelling range is flagged before confirming')
  } finally {
    delete globalThis.fetch
  }
})

test('the dialog derives the net change from a diff when the Host reports no stat', async () => {
  const run = async (patch) => {
    const updates = []
    const holder = { refs: [] }
    const requests = []
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      requests.push(body.op)
      let data = {}
      if (body.op === 'squashPreview') {
        // An older Host: no stat / netEmpty fields.
        data = { commits: SNAPSHOT.log.commits.slice(0, 2), defaultMessage: 'combined', dirty: false, base: 'b'.repeat(40), newest: 'c'.repeat(40) }
      } else if (body.op === 'diff') {
        data = { diff: patch, truncated: false, binary: false }
      }
      return { ok: true, json: async () => ({ ok: true, data }) }
    }
    const states = panelStates({
      9: { type: 'commit', hash: HASHES[0], hashes: [HASHES[0], HASHES[1]], anchor: HASHES[0] },
      21: true,
    })
    const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next }), holder))
    const rows = commitRows(renderPanel(registrations))
    rows[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 3, clientY: 3 })
    updates.filter((entry) => entry.index === 18).pop().next.items
      .find((item) => item.label === 'menu.squashCount').onSelect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const dialog = updates.filter((entry) => entry.index === 19).pop().next
    return { text: walk(dialog.extra()).text.join(''), requests }
  }

  const patch = ['diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1 +1 @@', '-old', '+new'].join('\n')
  try {
    const real = await run(patch)
    assert.ok(real.requests.includes('diff'), 'the panel asks for the range diff')
    assert.ok(real.text.includes('dialog.squash.stat'), 'a real net change is shown')
    assert.equal(real.text.includes('dialog.squash.netEmpty'), false)

    const cancelled = await run('')
    assert.ok(cancelled.text.includes('dialog.squash.netEmpty'), 'an empty net change is flagged')
  } finally {
    delete globalThis.fetch
  }
})

test('the toolbar offers 更新项目 where pull used to be, and pull moves into the menu', async () => {
  const updates = []
  const { registrations } = install(loadBundle(panelStates(), (index, next) => updates.push({ index, next })))
  const tree = renderPanel(registrations)
  const buttons = []
  const collect = (element) => {
    if (!element || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(collect)
      return
    }
    if (element.$$element !== true) return
    if (element.type === 'button') buttons.push(element)
    element.children.forEach(collect)
    // Inline components (Button, Menu triggers) render on invocation.
    if (typeof element.type === 'function') collect(element.type(element.props))
  }
  collect(tree)
  // Button passes its label through props.children, so read both places.
  const labelOf = (button) => walk(button).text.join('')
    + (typeof button.props.children === 'string' ? button.props.children : '')
  const labels = buttons.map(labelOf)
  assert.ok(labels.includes('action.update'), 'the toolbar grows an update-project button')
  assert.equal(labels.includes('action.pull'), false, 'pull is no longer a top-level button')

  // The More menu keeps pull reachable and repeats update for the dialog path.
  const more = buttons.find((button) => labelOf(button).includes('action.more'))
  assert.ok(more, 'the More button renders')
  more.props.onClick({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) } })
  const items = updates.filter((entry) => entry.index === 18).pop().next.items
  assert.ok(items.some((item) => item.label === 'action.update'))
  assert.ok(items.some((item) => item.label === 'action.pull'))
})

test('更新项目 asks for a strategy, remembers it, and resets on demand', async () => {
  const requests = []
  let behind = 2
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    let data = SNAPSHOT
    if (body.op === 'updateProject') {
      data = {
        branch: 'thq-dev', remote: 'origin', upstream: 'origin/thq-dev',
        strategy: body.strategy, ahead: 0, behind, updated: behind > 0, output: '', summary: SNAPSHOT.summary,
      }
    }
    return { ok: true, json: async () => ({ ok: true, data }) }
  }
  const store = {}
  globalThis.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const buttons = (tree) => {
    const found = []
    const collect = (element) => {
      if (!element || typeof element !== 'object') return
      if (Array.isArray(element)) { element.forEach(collect); return }
      if (element.$$element !== true) return
      if (element.type === 'button') {
        found.push({
          element,
          text: walk(element).text.join('') + (typeof element.props.children === 'string' ? element.props.children : ''),
        })
      }
      element.children.forEach(collect)
      if (typeof element.type === 'function') collect(element.type(element.props))
    }
    collect(tree)
    return found
  }
  try {
    // `localeBind` makes the bundle fall back to its own dictionary, so this test
    // sees the strings a user sees, placeholders and all.
    const updates = []
    const holder = { refs: [] }
    const { registrations } = install(
      loadBundle(panelStates(), (index, next) => updates.push({ index, next }), holder),
      { localeBind: () => () => undefined },
    )
    // The shim consumes its state queue once, so every lookup reuses this tree.
    const tree = renderPanel(registrations)
    const find = (text) => buttons(tree).find((entry) => entry.text === text).element
    const updateButton = find('更新项目')
    const notice = () => updates.filter((entry) => entry.index === 5).pop()?.next

    // In the panel the snapshot arrives on mount; the test triggers it by hand so
    // the dialog can quote the branch and its upstream.
    find('刷新').props.onClick()
    await flush()
    assert.deepEqual(requests.map((body) => body.op), ['snapshot'])
    requests.length = 0

    // 1) The first click asks, exactly like IDEA's dialog.
    updateButton.props.onClick()
    await flush()
    const dialog = updates.filter((entry) => entry.index === 19).pop().next
    assert.equal(dialog.kind, 'choice')
    assert.equal(dialog.title, '更新项目')
    assert.equal(dialog.value, 'merge', 'merge is IDEA’s default')
    assert.deepEqual(dialog.options.map((option) => option.value), ['merge', 'rebase'])
    assert.equal(dialog.options[0].label, '把远端的新提交合并到当前分支')
    assert.equal(dialog.options[1].label, '把当前分支变基到远端的新提交之上')
    assert.equal(dialog.checkedLabel, '记住我的选择，以后不再询问')
    assert.equal(dialog.footExtra.label, '重置到远程分支')
    assert.equal(dialog.confirmText, '更新项目')
    // Nothing runs until the dialog is answered.
    assert.deepEqual(requests, [])
    assert.equal(dialog.text, '当前分支 thq-dev，跟踪 origin/thq-dev。')

    assert.equal(typeof holder.refs[0].current, 'function', 'the dialog resolver is pending')
    holder.refs[0].current({ value: 'rebase', checked: true })
    await flush()
    await flush()
    assert.deepEqual(requests.map((body) => body.op), ['updateProject', 'snapshot'])
    assert.equal(requests[0].strategy, 'rebase')
    assert.equal(requests[0].repo, '/repo/plm')
    assert.equal(store['dsh-git-manager.updateStrategy'], 'rebase', 'the choice is remembered')
    assert.equal(notice().text, '已把 origin/thq-dev 的 2 个提交变基到 thq-dev')

    // 2) The remembered strategy skips the dialog on the next click.
    requests.length = 0
    updates.length = 0
    updateButton.props.onClick()
    await flush()
    await flush()
    assert.equal(updates.some((entry) => entry.index === 19), false, 'no dialog the second time')
    assert.deepEqual(requests.map((body) => body.op), ['updateProject', 'snapshot'])
    assert.equal(requests[0].strategy, 'rebase')

    // 3) Up to date: the notice says so instead of reporting a phantom update.
    behind = 0
    requests.length = 0
    updates.length = 0
    updateButton.props.onClick()
    await flush()
    await flush()
    assert.equal(requests[0].op, 'updateProject')
    assert.equal(notice().text, '已经是最新的（origin/thq-dev）')

    // 4) The dialog's extra footer button resets, behind a danger confirm.
    behind = 2
    const more = buttons(tree).find((entry) => entry.text.includes('更多')).element
    more.props.onClick({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) } })
    updates.filter((entry) => entry.index === 18).pop().next.items
      .find((item) => item.label === '更新项目').onSelect()
    await flush()
    const second = updates.filter((entry) => entry.index === 19).pop().next
    assert.equal(second.kind, 'choice', 'the menu path always asks, even when a strategy is remembered')
    holder.refs[0].current({ value: 'merge', checked: false, action: 'extra' })
    await flush()
    const confirm = updates.filter((entry) => entry.index === 19).pop().next
    assert.equal(confirm.kind, 'confirm')
    assert.equal(confirm.danger, true)
    assert.equal(confirm.text, '把 thq-dev 硬重置到 origin/thq-dev？\n本地未推送的提交和未提交的改动都会丢失。')
    requests.length = 0
    holder.refs[0].current(true)
    await flush()
    await flush()
    assert.deepEqual(requests.map((body) => body.op), ['updateProject', 'snapshot'])
    assert.equal(requests[0].strategy, 'reset')
    assert.equal(notice().text, '已把 origin/thq-dev 的 2 个提交重置到 thq-dev')
    assert.equal(store['dsh-git-manager.updateStrategy'], 'rebase', 'reset does not overwrite the remembered strategy')
  } finally {
    delete globalThis.fetch
    delete globalThis.localStorage
  }
})

test('更新项目 tells the user to restart when the Host cannot update projects', async () => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ ok: true, data: SNAPSHOT }) }
  }
  try {
    const updates = []
    const states = panelStates()
    states[22] = false // supportsUpdate: the capabilities probe said no
    const { registrations } = install(loadBundle(states, (index, next) => updates.push({ index, next })))
    const tree = renderPanel(registrations)
    const buttons = []
    const collect = (element) => {
      if (!element || typeof element !== 'object') return
      if (Array.isArray(element)) { element.forEach(collect); return }
      if (element.$$element !== true) return
      if (element.type === 'button') buttons.push(element)
      element.children.forEach(collect)
      if (typeof element.type === 'function') collect(element.type(element.props))
    }
    collect(tree)
    const update = buttons.find((button) => button.props.children === 'action.update')
    assert.ok(update, 'the update button still renders on an old Host')
    assert.ok(String(update.props.title).includes('action.updateRestart'), 'the tooltip explains why')
    update.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(requests, [], 'nothing is sent to a Host that cannot do it')
    const notice = updates.filter((entry) => entry.index === 5).pop()
    assert.equal(notice.next.kind, 'error')
    assert.equal(notice.next.text, 'action.updateRestart')
    assert.equal(updates.some((entry) => entry.index === 19), false, 'no dialog is opened either')
  } finally {
    delete globalThis.fetch
  }
})

test('编辑提交信息 stays disabled until the Host reports the operation', () => {
  const updates = []
  const holder = { refs: [] }
  const { registrations } = install(
    loadBundle(panelStates({ 23: false }), (index, next) => updates.push({ index, next }), holder),
    { localeBind: () => () => undefined },
  )
  const tree = renderPanel(registrations)
  const rows = commitRows(tree)
  const unpushed = rows.find((element) => String(element.props.title).startsWith('c'.repeat(40)))
  unpushed.props.onContextMenu({ clientX: 4, clientY: 8, preventDefault() {}, stopPropagation() {} })
  const item = updates.filter((entry) => entry.index === 18).pop().next.items
    .find((entry) => entry.label === '编辑提交信息…')
  // An un-restarted Host would answer `未知操作 reword`, so stay disabled and say why.
  assert.equal(item.disabled, true)
  assert.equal(item.hint, '宿主尚未实现该操作，重启 DSH 后可用')
})

test('编辑提交信息 pre-fills the whole message and refuses published commits', async () => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    let data = SNAPSHOT
    if (body.op === 'commit') {
      data = { commit: { hash: body.sha, subject: 'fix(web-core): 页面内容区无法滚动', body: '原来的正文行', author: 'tianhaiqing' } }
    } else if (body.op === 'reword') {
      data = { sha: body.sha, subject: 'fix(web-core): 页面内容区可以滚动了', changed: true, output: '', summary: SNAPSHOT.summary }
    }
    return { ok: true, json: async () => ({ ok: true, data }) }
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const updates = []
  const holder = { refs: [] }
  const { registrations } = install(
    loadBundle(panelStates(), (index, next) => updates.push({ index, next }), holder),
    { localeBind: () => () => undefined },
  )
  const tree = renderPanel(registrations)
  const commitRows = (root) => {
    const found = []
    const collect = (element) => {
      if (!element || typeof element !== 'object') return
      if (Array.isArray(element)) { element.forEach(collect); return }
      if (element.$$element !== true) return
      if (typeof element.props?.className === 'string' && element.props.className.startsWith('dg-commit')) found.push(element)
      element.children.forEach(collect)
      if (typeof element.type === 'function') collect(element.type(element.props))
    }
    collect(root)
    return found
  }
  const rows = commitRows(tree)
  const row = (hash) => rows.find((element) => String(element.props.title).startsWith(hash))
  const unpushed = row('c'.repeat(40))
  const published = row('d'.repeat(40))
  assert.equal(typeof unpushed.props.onContextMenu, 'function', 'commits open a context menu')
  const menuItems = () => updates.filter((entry) => entry.index === 18).pop().next.items
  const editItem = (element) => {
    element.props.onContextMenu({ clientX: 12, clientY: 34, preventDefault() {}, stopPropagation() {} })
    return menuItems().find((item) => item.label === '编辑提交信息…')
  }
  const notice = () => updates.filter((entry) => entry.index === 5).pop()?.next

  // Published commits cannot be rewritten: the entry stays, greyed out, with a reason.
  const blocked = editItem(published)
  assert.equal(blocked.disabled, true)
  assert.equal(blocked.hint, '只能改写尚未推送到远端的提交')

  const editable = editItem(unpushed)
  assert.notEqual(editable.disabled, true)
  assert.equal(editable.hint, undefined)

  editable.onSelect()
  await flush()
  assert.deepEqual(requests.map((body) => body.op), ['commit'])
  assert.equal(requests[0].sha, 'c'.repeat(40))
  const dialog = updates.filter((entry) => entry.index === 19).pop().next
  assert.equal(dialog.kind, 'text')
  assert.equal(dialog.multiline, true)
  assert.equal(dialog.title, '编辑提交信息')
  assert.equal(dialog.confirmText, '保存')
  assert.equal(dialog.text, '提交 cccccccc，作者 tianhaiqing。改写会重写此后的提交哈希。')
  assert.equal(dialog.value, 'fix(web-core): 页面内容区无法滚动\n\n原来的正文行', 'the body must be pre-filled too')

  // A `text` dialog resolves to `{ value, checked }` — resolving with a bare
  // string is not what the real Dialog does, and doing so once hid a bug that
  // sent the literal "[object Object]" to git.
  holder.refs[0].current({ value: 'fix(web-core): 页面内容区可以滚动了\n\n改后的正文', checked: false })
  await flush()
  assert.deepEqual(requests.map((body) => body.op), ['commit', 'reword', 'snapshot'])
  assert.equal(requests[1].sha, 'c'.repeat(40))
  assert.equal(requests[1].message, 'fix(web-core): 页面内容区可以滚动了\n\n改后的正文')
  assert.equal(notice().kind, 'ok')
  assert.equal(notice().text, '已改写 cccccccc 的提交信息')
  // Later commits got new hashes, so the old selection cannot survive.
  assert.equal(updates.filter((entry) => entry.index === 9).pop().next, null)

  // An empty message never reaches the engine.
  editable.onSelect()
  await flush()
  holder.refs[0].current({ value: '   ', checked: false })
  await flush()
  assert.equal(notice().kind, 'error')
  assert.equal(notice().text, '提交信息不能为空')
  assert.deepEqual(requests.map((body) => body.op), ['commit', 'reword', 'snapshot', 'commit'])
})
