/**
 * Pure Git engine for the DSH Git manager plugin.
 *
 * This module owns no Cordis concepts: it validates one request object, runs
 * `git` as a child process with an argv array (never a shell), and returns
 * JSON-safe data or throws a `GitError`. `index.js` wires it to a Host route
 * and a tool; `client.js` renders the results.
 */
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const US = '\u001f'
const RS = '\u001e'

/** Field/record separators git's pretty formats can emit verbatim. */
const LOG_FORMAT = `%H${US}%P${US}%an${US}%ae${US}%at${US}%ct${US}%D${US}%s${RS}`

/** One failed git invocation, carrying the command that failed. */
export class GitError extends Error {
  constructor(message, detail) {
    super(message)
    this.name = 'GitError'
    this.detail = detail ?? ''
  }
}

const DEFAULTS = {
  repos: [],
  maxCommits: 400,
  timeoutMs: 60_000,
  networkTimeoutMs: 180_000,
}

function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  config.repos = Array.isArray(config.repos) ? config.repos.filter((value) => typeof value === 'string') : []
  for (const key of ['maxCommits', 'timeoutMs', 'networkTimeoutMs']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) config[key] = DEFAULTS[key]
  }
  config.maxCommits = Math.min(Math.max(Math.trunc(config.maxCommits), 20), 5000)
  return config
}

/** Child environment: never prompt, never page, never take an optional lock. */
function gitEnv(extra) {
  return {
    ...process.env,
    LC_ALL: 'C',
    LANG: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    ...extra,
  }
}

/**
 * Run one git command.
 * @param cwd repository working directory (already validated).
 * @param args argv tail; every element is passed verbatim.
 * @param options timeout and buffer limits.
 * @returns `{ stdout, stderr, code }`; a non-zero exit still resolves when
 *          `allowFailure` is set, so callers can inspect plumbing output.
 */
export function runGit(cwd, args, options = {}) {
  const timeout = options.timeout ?? DEFAULTS.timeoutMs
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      env: gitEnv(options.env),
      timeout,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
      if (error && error.killed === true) {
        reject(new GitError(`git ${args.join(' ')} 超时（${timeout}ms）`, String(stderr ?? '')))
        return
      }
      if (error && !options.allowFailure) {
        const message = String(stderr ?? '').trim() || String(error.message ?? error)
        reject(new GitError(message, `git ${args.join(' ')}`))
        return
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
  })
}

/** One git command whose output is required to be valid. */
async function git(cwd, args, options) {
  const result = await runGit(cwd, args, options)
  if (result.code !== 0) {
    throw new GitError(result.stderr.trim() || `git ${args.join(' ')} 失败（exit ${result.code}）`, `git ${args.join(' ')}`)
  }
  return result.stdout
}

/** First non-empty line, or `undefined`. */
function firstLine(text) {
  const line = String(text).split('\n').find((value) => value.trim().length > 0)
  return line === undefined ? undefined : line.trim()
}

/**
 * Canonicalize a user-supplied repository path and prove it is a Git work tree.
 * @returns `{ root, gitDir, name, commonDir }` where `root` is the toplevel.
 */
export async function resolveRepo(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new GitError('缺少仓库路径')
  const candidate = path.resolve(input.trim())
  let stat
  try {
    stat = await fsp.stat(candidate)
  } catch {
    throw new GitError(`目录不存在：${candidate}`)
  }
  if (!stat.isDirectory()) throw new GitError(`不是目录：${candidate}`)
  const real = await fsp.realpath(candidate)
  let root
  try {
    root = firstLine(await git(real, ['rev-parse', '--show-toplevel']))
  } catch {
    throw new GitError(`不是 Git 仓库：${real}`)
  }
  if (!root) throw new GitError(`不是 Git 仓库：${real}`)
  const commonDir = firstLine(await git(root, ['rev-parse', '--git-common-dir']).catch(() => ''))
  const gitDir = firstLine(await git(root, ['rev-parse', '--git-dir']).catch(() => ''))
  return { root, gitDir, commonDir, name: path.basename(root) }
}

/** Reject anything a ref name must not be, before git sees it. */
function assertRefName(value, label = 'ref') {
  if (typeof value !== 'string' || value.trim() === '') throw new GitError(`缺少 ${label}`)
  const name = value.trim()
  if (name.startsWith('-')) throw new GitError(`非法的 ${label}：${name}`)
  if (/[\s\u0000-\u001f\u007f~^:?*[\\]/.test(name)) throw new GitError(`非法的 ${label}：${name}`)
  if (name.includes('..') || name.includes('@{') || name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) {
    throw new GitError(`非法的 ${label}：${name}`)
  }
  return name
}

/** A revision expression used for reading (branch, tag, sha, HEAD~2). */
function assertRevision(value, label = 'revision') {
  const name = assertRefName(value, label)
  if (name.startsWith('refs/') || name === 'HEAD') return name
  return name
}

/**
 * The remote a command should address.
 *
 * `git push`/`git pull` take `[<remote> [<branch>]]`, so a branch name passed
 * without a remote is read as the repository and git answers with the confusing
 * "does not appear to be a git repository". Resolve the position explicitly.
 */
async function resolveRemote(repo, branch, given) {
  if (typeof given === 'string' && given.trim() !== '') return assertNotOption(given, '远程仓库')
  if (branch) {
    // assertRefName already rejected every character that could break the key.
    const tracking = firstLine(await git(repo, ['config', '--get', `branch.${branch}.remote`]).catch(() => ''))
    if (tracking) return tracking
  }
  const list = await remotes(repo)
  if (list.length > 0) return list[0].name
  return 'origin'
}

/**
 * The remote-tracking ref a local branch integrates from.
 *
 * A branch that was pushed with `-u` records its upstream; a clone that only
 * checked out part of the work may not, so fall back to `<remote>/<branch>` and
 * prove the ref exists before handing it to `git merge`.
 */
async function upstreamRef(repo, branch, remote) {
  const configured = firstLine(await git(
    repo,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`],
  ).catch(() => ''))
  if (configured) return configured
  const candidate = `${remote}/${branch}`
  const probe = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`], { allowFailure: true })
  if (probe.code !== 0) {
    throw new GitError(`当前分支 ${branch} 在远端 ${remote} 上没有对应分支，无法更新`)
  }
  return candidate
}

/** Reject a value that would be interpreted as an option. */
function assertNotOption(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new GitError(`缺少 ${label}`)
  const text = value.trim()
  if (text.startsWith('-')) throw new GitError(`非法的 ${label}：${text}`)
  return text
}

function asPaths(value) {
  if (!Array.isArray(value) || value.length === 0) throw new GitError('缺少文件路径')
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry === '') throw new GitError('非法的文件路径')
    if (entry.includes('\u0000')) throw new GitError('非法的文件路径')
    return entry
  })
}

function asBoolean(value) {
  return value === true
}

/** `git status --porcelain=v2 -z --branch` projection. */
export function parseStatus(stdout) {
  const records = String(stdout).split('\u0000')
  const status = {
    branch: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
  }
  const files = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        status.branch = value === '(detached)' ? null : value
        status.detached = value === '(detached)'
      } else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const match = /\+(\d+)\s+-(\d+)/.exec(value)
        if (match) {
          status.ahead = Number(match[1])
          status.behind = Number(match[2])
        }
      }
      continue
    }
    const kind = record[0]
    if (kind === '1' || kind === 'u') {
      const parts = record.split(' ')
      const xy = parts[1] ?? '..'
      const filePath = parts.slice(kind === '1' ? 8 : 10).join(' ')
      files.push({
        path: filePath,
        origPath: null,
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        untracked: false,
        unmerged: kind === 'u',
      })
    } else if (kind === '2') {
      const parts = record.split(' ')
      const xy = parts[1] ?? '..'
      const filePath = parts.slice(9).join(' ')
      const origPath = records[index + 1] ?? null
      index += 1
      files.push({
        path: filePath,
        origPath,
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        untracked: false,
        unmerged: false,
      })
    } else if (kind === '?') {
      files.push({
        path: record.slice(2),
        origPath: null,
        index: '?',
        worktree: '?',
        untracked: true,
        unmerged: false,
      })
    }
  }
  status.files = files.map((file) => ({
    ...file,
    staged: !file.untracked && file.index !== '.' && file.index !== ' ',
    unstaged: file.untracked || (file.worktree !== '.' && file.worktree !== ' '),
  }))
  return status
}

/** `%(upstream:track)` with `LC_ALL=C`, e.g. `[ahead 1, behind 2]`. */
function parseTrack(value) {
  const match = /ahead (\d+)/.exec(value)
  const behind = /behind (\d+)/.exec(value)
  return { ahead: match ? Number(match[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

const BRANCH_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(authordate:unix)',
  '%(subject)',
].join(US)

/** Local/remote branches and tags from one `for-each-ref` pass. */
export async function branches(repo) {
  const stdout = await git(repo, [
    'for-each-ref',
    `--format=${BRANCH_FORMAT}`,
    '--sort=-committerdate',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])
  const local = []
  const remoteMap = new Map()
  const tags = []
  const head = await currentBranch(repo)
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const [refname, short, sha, headMark, upstream, track, date, subject] = line.split(US)
    if (!refname) continue
    const entry = {
      name: short ?? refname,
      refname,
      sha,
      upstream: upstream || null,
      ahead: 0,
      behind: 0,
      date: date ? Number(date) * 1000 : null,
      subject: subject ?? '',
      current: headMark === '*',
    }
    if (track) {
      const parsed = parseTrack(track)
      entry.ahead = parsed.ahead
      entry.behind = parsed.behind
    }
    if (refname.startsWith('refs/heads/')) local.push(entry)
    else if (refname.startsWith('refs/remotes/')) {
      // `%(refname:short)` of refs/remotes/<remote>/HEAD is just `<remote>`, so
      // the symbolic remote HEAD is identified from the full refname instead.
      const rest = refname.slice('refs/remotes/'.length)
      const remoteName = rest.split('/')[0]
      const branchPath = rest.slice(remoteName.length + 1)
      if (branchPath === 'HEAD' || branchPath === '') continue
      entry.name = `${remoteName}/${branchPath}`
      const group = remoteMap.get(remoteName) ?? []
      group.push(entry)
      remoteMap.set(remoteName, group)
    } else if (refname.startsWith('refs/tags/')) tags.push(entry)
  }
  const remotes = [...remoteMap.entries()]
    .map(([remote, list]) => ({ remote, branches: list }))
    .sort((left, right) => left.remote.localeCompare(right.remote))
  return {
    local,
    remotes,
    tags,
    head: head.branch,
    headSha: head.sha,
    detached: head.detached,
  }
}

/** Current branch facts, tolerant of a detached HEAD and an empty repository. */
export async function currentBranch(repo) {
  const oid = firstLine(await git(repo, ['rev-parse', '--verify', 'HEAD']).catch(() => ''))
  const name = firstLine(await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''))
  return { branch: name ?? null, sha: oid ?? null, detached: oid !== undefined && name === undefined }
}

/** Commit log with parents for client-side lane assignment. */
export async function log(repo, params = {}, config = DEFAULTS) {
  const max = Math.min(Math.trunc(Number(params.max) || config.maxCommits), 5000)
  const skip = Math.max(Math.trunc(Number(params.skip) || 0), 0)
  const args = ['log', '--date-order', '--no-color', `--max-count=${max}`, `--pretty=format:${LOG_FORMAT}`]
  if (skip > 0) args.push(`--skip=${skip}`)
  if (asBoolean(params.all)) args.push('--all')
  else if (typeof params.ref === 'string' && params.ref.trim() !== '') args.push(assertRevision(params.ref, '分支'))
  if (typeof params.path === 'string' && params.path.trim() !== '') args.push('--', params.path.trim())
  const result = await runGit(repo, args, { allowFailure: true })
  if (result.code !== 0) {
    const message = result.stderr.trim()
    // An empty repository has no HEAD yet: report an empty log, not a failure.
    if (/does not have any commits|unknown revision|bad revision/i.test(message)) {
      return { commits: [], end: true }
    }
    throw new GitError(message || '读取提交历史失败', `git ${args.join(' ')}`)
  }
  const commits = result.stdout
    .split(RS)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [hash, parents, author, email, authorDate, commitDate, refs, subject] = record.split(US)
      return {
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        email,
        authorDate: Number(authorDate) * 1000,
        commitDate: Number(commitDate) * 1000,
        refs: refs ? refs.split(',').map((value) => value.trim()).filter(Boolean) : [],
        subject: subject ?? '',
      }
    })
    .filter((commit) => typeof commit.hash === 'string' && commit.hash.length > 0)
  // History rewrite (reword) is only safe for commits no remote ref reaches, so
  // the panel needs one flag per row. A `--all` log mixes branches and gets none.
  if (!asBoolean(params.all) && commits.length > 0) {
    const target = typeof params.ref === 'string' && params.ref.trim() !== '' ? params.ref.trim() : 'HEAD'
    // The positive revision must come first: `--not` negates every revision
    // that follows it, so `rev-list --not --remotes HEAD` lists nothing at all
    // and would mark every commit as pushed.
    const published = await runGit(repo, ['rev-list', target, '--not', '--remotes'], { allowFailure: true })
    if (published.code === 0) {
      const unpushed = new Set(published.stdout.split('\n').filter((line) => line !== ''))
      for (const commit of commits) commit.pushed = !unpushed.has(commit.hash)
    }
  }
  return { commits, end: commits.length < max }
}

/** Full metadata and changed-file list of one commit. */
export async function commitDetail(repo, params) {
  const sha = assertRevision(params.sha, '提交')
  const header = await git(repo, [
    'show',
    '-s',
    `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%ct${US}%D${US}%s${US}%b`,
    sha,
  ])
  const [hash, parents, author, email, authorDate, commitDate, refs, subject, body] = header.split(US)
  const numstat = await git(repo, ['show', '--numstat', '--format=', '--no-color', sha]).catch(() => '')
  const files = []
  for (const line of numstat.split('\n')) {
    if (line.trim() === '') continue
    const [added, deleted, ...rest] = line.split('\t')
    if (rest.length === 0) continue
    files.push({
      path: rest.join('\t'),
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted),
      binary: added === '-',
    })
  }
  return {
    hash,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author,
    email,
    authorDate: Number(authorDate) * 1000,
    commitDate: Number(commitDate) * 1000,
    refs: refs ? refs.split(',').map((value) => value.trim()).filter(Boolean) : [],
    subject: subject ?? '',
    body: (body ?? '').replace(/\s+$/, ''),
    files,
  }
}

/** Size cap for one returned patch body. */
const DIFF_LIMIT = 400_000

/** The response shape every diff source shares. */
function diffResult(text, extra = {}) {
  const body = text.length > DIFF_LIMIT ? `${text.slice(0, DIFF_LIMIT)}\n…（差异过长，已截断）` : text
  return {
    diff: body,
    truncated: text.length > DIFF_LIMIT,
    binary: /^Binary files /m.test(text) || /^GIT binary patch$/m.test(text),
    ...extra,
  }
}

/** Whether a path exists only in the working tree, so `git diff` shows nothing. */
async function isUntracked(repo, filePath) {
  const stdout = await git(repo, ['ls-files', '--others', '--exclude-standard', '--', filePath]).catch(() => '')
  return stdout.split('\n').some((line) => line.trim() !== '')
}

/** An untracked file reads as one whole-file addition against /dev/null. */
async function diffUntracked(repo, filePath) {
  const result = await runGit(repo, ['diff', '--no-color', '--no-index', '--', '/dev/null', filePath], {
    allowFailure: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  // `--no-index` exits 1 whenever the two inputs differ, which is the normal case.
  return diffResult(result.stdout, { untracked: true })
}

/** Unified diff text for a commit, a file in a commit, or the working tree. */
export async function diff(repo, params = {}) {
  const target = typeof params.path === 'string' && params.path !== '' ? params.path : null
  const inCommit = typeof params.sha === 'string' && params.sha.trim() !== ''
  // An untracked file is invisible to `git diff`; render it against /dev/null.
  if (target && !inCommit && !asBoolean(params.staged) && asBoolean(params.untracked)) {
    return diffUntracked(repo, target)
  }
  const args = ['--no-pager', 'diff', '--no-color', '--find-renames']
  if (inCommit) {
    args.length = 0
    args.push('show', '--no-color', '--find-renames', '--format=', assertRevision(params.sha, '提交'))
  } else {
    if (asBoolean(params.staged)) args.push('--cached')
    if (typeof params.base === 'string' && params.base.trim() !== '') args.push(assertRevision(params.base, '基准'))
    if (typeof params.head === 'string' && params.head.trim() !== '') args.push(assertRevision(params.head, '目标'))
  }
  if (target) args.push('--', target)
  const result = await runGit(repo, args, { allowFailure: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.code !== 0 && result.stdout.trim() === '') {
    throw new GitError(result.stderr.trim() || '读取差异失败', `git ${args.join(' ')}`)
  }
  const text = result.stdout
  // The caller may not know the path is untracked (the agent tool passes only a
  // path); fall back instead of answering with an empty diff.
  if (text.trim() === '' && target && !inCommit && !asBoolean(params.staged) && await isUntracked(repo, target)) {
    return diffUntracked(repo, target)
  }
  return diffResult(text)
}

/** Stash entries. */
export async function stashes(repo) {
  const stdout = await git(repo, [
    'stash',
    'list',
    `--format=%gd${US}%H${US}%ct${US}%gs`,
  ]).catch(() => '')
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [selector, sha, date, subject] = line.split(US)
      const index = Number(/stash@\{(\d+)\}/.exec(selector ?? '')?.[1] ?? -1)
      return { index, selector, sha, date: date ? Number(date) * 1000 : null, subject: subject ?? '' }
    })
}

/** Configured remotes with their fetch and push URLs. */
export async function remotes(repo) {
  const stdout = await git(repo, ['remote', '-v']).catch(() => '')
  const map = new Map()
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const entry = map.get(match[1]) ?? { name: match[1], fetchUrl: '', pushUrl: '' }
    if (match[3] === 'fetch') entry.fetchUrl = match[2]
    else entry.pushUrl = match[2]
    map.set(match[1], entry)
  }
  return [...map.values()]
}

/** Effective user identity for commits made through the panel. */
export async function identity(repo) {
  return {
    userName: firstLine(await git(repo, ['config', '--get', 'user.name']).catch(() => '')) ?? '',
    userEmail: firstLine(await git(repo, ['config', '--get', 'user.email']).catch(() => '')) ?? '',
    defaultBranch: firstLine(await git(repo, ['config', '--get', 'init.defaultBranch']).catch(() => '')) ?? '',
  }
}

/** A short repository fingerprint used to switch between open repositories. */
export async function repoSummary(root) {
  const head = await currentBranch(root)
  const status = parseStatus(await git(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']).catch(() => ''))
  const remotesList = await remotes(root)
  return {
    path: root,
    name: path.basename(root),
    branch: head.branch,
    detached: head.detached,
    sha: head.sha,
    changeCount: status.files.length,
    remotes: remotesList.map((remote) => remote.name),
  }
}

/** Repositories offered by the panel: registered workspaces plus configured paths. */
export async function discover(config, workspaceRegistry, extraRepos = []) {
  const seen = new Set()
  const candidates = []
  const push = (value, title) => {
    if (typeof value !== 'string' || value.trim() === '') return
    const resolved = path.resolve(value.trim())
    if (seen.has(resolved)) return
    seen.add(resolved)
    candidates.push({ path: resolved, title: title ?? null })
  }
  if (workspaceRegistry) {
    try {
      for (const workspace of workspaceRegistry.list()) push(workspace.path, workspace.title)
    } catch {
      /* A registry that is not ready yet simply contributes nothing. */
    }
  }
  for (const entry of extraRepos ?? []) {
    if (typeof entry === 'string') push(entry)
    else if (entry && typeof entry === 'object') push(entry.path, entry.title ?? null)
  }
  for (const configured of config.repos ?? []) push(configured)
  const repos = []
  for (const candidate of candidates) {
    let stat
    try {
      stat = await fsp.stat(candidate.path)
    } catch {
      repos.push({ ...candidate, isRepo: false, reason: '目录不存在' })
      continue
    }
    if (!stat.isDirectory()) {
      repos.push({ ...candidate, isRepo: false, reason: '不是目录' })
      continue
    }
    try {
      const resolved = await resolveRepo(candidate.path)
      const summary = await repoSummary(resolved.root)
      repos.push({
        path: resolved.root,
        title: candidate.title ?? summary.name,
        isRepo: true,
        branch: summary.branch,
        detached: summary.detached,
        changeCount: summary.changeCount,
        remotes: summary.remotes,
      })
    } catch (error) {
      repos.push({
        path: candidate.path,
        title: candidate.title ?? path.basename(candidate.path),
        isRepo: false,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { repos }
}

/**
 * Resolve a selected commit set into the single linear chain a squash needs.
 *
 * Rejects anything that is not one contiguous run of single-parent commits on
 * the current HEAD, and reports the message every selected commit contributes.
 */
export async function planSquash(repo, rawShas) {
  if (!Array.isArray(rawShas)) throw new GitError('缺少要 Squash 的提交列表')
  const shas = []
  for (const value of rawShas) {
    const sha = assertRevision(value, '提交')
    if (!shas.includes(sha)) shas.push(sha)
  }
  if (shas.length < 2) throw new GitError('至少选择两个提交才能 Squash')
  const infos = []
  for (const sha of shas) {
    const line = firstLine(await git(repo, ['rev-list', '--parents', '-n', '1', sha]))
    if (!line) throw new GitError(`找不到提交：${sha}`)
    const [hash, ...parents] = line.split(/\s+/)
    infos.push({ hash, parents })
  }
  const selected = new Set(infos.map((entry) => entry.hash))
  const roots = infos.filter((entry) => !entry.parents[0] || !selected.has(entry.parents[0]))
  if (roots.length !== 1) throw new GitError('所选提交必须是同一分支上连续的一段（不含分叉）')
  const chain = [roots[0]]
  for (;;) {
    // Walk upward: the next selected commit is the one whose first parent is the
    // commit just appended, i.e. the child of the current tip of the chain.
    const next = infos.find((entry) => entry.parents[0] === chain[chain.length - 1].hash)
    if (!next) break
    chain.push(next)
  }
  if (chain.length !== infos.length) throw new GitError('所选提交必须是同一分支上连续的一段')
  for (const entry of chain) {
    if (entry.parents.length > 1) throw new GitError('所选范围内包含合并提交，无法 Squash')
  }
  const oldest = chain[0]
  const newest = chain[chain.length - 1]
  const ancestor = await runGit(repo, ['merge-base', '--is-ancestor', newest.hash, 'HEAD'], { allowFailure: true })
  if (ancestor.code !== 0) throw new GitError('只能 Squash 当前 HEAD 历史中的提交')
  const commits = []
  const format = `%H${US}%an${US}%ae${US}%at${US}%s${US}%b`
  for (const entry of chain) {
    const line = await git(repo, ['show', '-s', `--format=${format}`, entry.hash])
    const [hash, author, email, date, subject, body] = line.split(US)
    commits.push({
      hash,
      author,
      email,
      date: Number(date) * 1000,
      subject: subject ?? '',
      body: (body ?? '').replace(/\s+$/, ''),
    })
  }
  const status = await git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=no'])
  // Net change of the whole range: two commits that cancel each other leave the
  // squashed commit with no file changes at all, which must be visible up front.
  const base = oldest.parents[0] ?? null
  const statText = await git(repo, base
    ? ['diff', '--numstat', base, newest.hash]
    : ['show', '--numstat', '--format=', newest.hash]).catch(() => '')
  const stat = { files: 0, additions: 0, deletions: 0 }
  for (const line of statText.split('\n')) {
    if (line.trim() === '') continue
    const [added, deleted, ...rest] = line.split('\t')
    if (rest.length === 0) continue
    stat.files += 1
    if (added !== '-') stat.additions += Number(added)
    if (deleted !== '-') stat.deletions += Number(deleted)
  }
  return {
    chain,
    oldest,
    newest,
    base,
    stat,
    netEmpty: stat.files === 0,
    commits,
    defaultMessage: commits.map((entry) => [entry.subject, entry.body].filter(Boolean).join('\n\n')).join('\n\n'),
    dirty: status.trim() !== '',
  }
}

/** Quote one path for the shell command string git keeps in GIT_EDITOR. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * `git rebase -i` todo editor: turn the one line for our commit into `reword`.
 *
 * The todo prints abbreviated hashes, so the target is matched as a prefix of
 * the full sha. A merge commit shows up as `merge -C <sha> <label>`; `-c` is the
 * rewording form and keeps the label that tells git what to merge.
 */
const REWORD_SEQUENCE_SCRIPT = `// Mark exactly one commit for rewording in a \`git rebase -i\` todo list.
const fs = require('node:fs')
const file = process.argv[2]
const sha = process.env.DG_REWORD_SHA ?? ''
const lines = fs.readFileSync(file, 'utf8').split('\\n')
const rewritten = lines.map((line) => {
  const parts = line.split(/\\s+/)
  const hash = parts[1] ?? ''
  if (parts[0] === 'pick' && hash !== '' && sha.startsWith(hash)) return line.replace(/^pick\\s+/, 'reword ')
  if (parts[0] === 'merge' && parts[1] === '-C' && (parts[2] ?? '') !== '' && sha.startsWith(parts[2])) {
    return line.replace(/^merge\\s+-C\\s+/, 'merge -c ')
  }
  return line
})
fs.writeFileSync(file, rewritten.join('\\n'))
`

/**
 * `git rebase -i` message editor: install the caller's message instead of
 * opening an interactive editor. Reword is the only stopped commit, so this is
 * called exactly once.
 */
const REWORD_EDITOR_SCRIPT = `// Install the requested message where git expects the edited commit message.
const fs = require('node:fs')
fs.copyFileSync(process.env.DG_REWORD_MSG, process.argv[2])
`

/** Is this path present inside the git directory? */
async function exists(target) {
  return fsp.access(target).then(() => true, () => false)
}

/**
 * Edit the message of one local commit, keeping its tree, author and parents.
 *
 * A reword changes only the message, so the commit tree must survive verbatim;
 * the caller verifies that afterwards. Commits already reachable from a remote
 * are refused: rewriting them would fork the branch that was pushed.
 */
export async function rewordCommit(repo, params = {}) {
  const sha = firstLine(await git(repo, ['rev-parse', '--verify', `${assertRevision(params.sha, '提交')}^{commit}`]))
  if (!sha) throw new GitError('找不到要改写的提交')
  const message = typeof params.message === 'string'
    ? params.message.replace(/\r\n/g, '\n').replace(/\s+$/, '')
    : ''
  if (message.trim() === '') throw new GitError('提交信息不能为空')
  // `--not --remotes` counts the commits this one has that no remote ref has, so
  // zero means the commit is already published.
  const unpublished = Number(firstLine(await git(repo, ['rev-list', '--count', sha, '--not', '--remotes'])) ?? '0')
  if (unpublished === 0) {
    throw new GitError('这个提交已经推送到远端，改写提交信息会让本地分支与远端分叉；请只改写未推送的提交')
  }
  const original = (await git(repo, ['log', '-1', '--format=%B', sha])).replace(/\s+$/, '')
  const head = firstLine(await git(repo, ['rev-parse', '--verify', 'HEAD']).catch(() => ''))
  const result = { sha, subject: firstLine(message) ?? '', message, changed: false }
  if (original === message) return { ...result, output: '', summary: await repoSummary(repo) }
  const gitDir = firstLine(await git(repo, ['rev-parse', '--absolute-git-dir']))
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (await exists(path.join(gitDir, name))) {
      throw new GitError('仓库里有未完成的变基、合并或摘取，请先完成或中止它，再改写提交信息')
    }
  }
  const treeBefore = firstLine(await git(repo, ['rev-parse', 'HEAD^{tree}']))
  // HEAD is the common case and needs no history rewrite: `--only` keeps staged
  // changes out of the amended commit, so a dirty index is safe.
  if (head === sha) {
    const amended = await mutation(repo, ['commit', '--amend', '--only', '-m', message], '改写提交信息失败')
    return { ...result, changed: true, output: amended.output, summary: await repoSummary(repo) }
  }
  const ancestor = await runGit(repo, ['merge-base', '--is-ancestor', sha, 'HEAD'], { allowFailure: true })
  if (ancestor.code !== 0) throw new GitError('这个提交不在当前分支的历史上，无法在这里改写')
  const parent = firstLine(await git(repo, ['rev-parse', '--verify', '--quiet', `${sha}^`]).catch(() => ''))
  // A message-only rebase replays the commits above this one; without
  // `--rebase-merges` that would linearize every merge in the range.
  const range = parent ? `${parent}..HEAD` : 'HEAD'
  const merges = (await git(repo, ['rev-list', '--merges', range])).trim()
  const args = ['rebase', '--interactive']
  if (merges !== '') args.push('--rebase-merges')
  args.push(parent || '--root')
  // `--autostash` brings a dirty worktree back with a flat index, so stash by
  // hand and pop with `--index`: staged changes stay staged, the way the user
  // left them. The rewrite keeps every tree, so the pop cannot conflict.
  const stashMessage = `dsh-git-reword-${sha.slice(0, 8)}`
  let restored = true
  if ((await git(repo, ['status', '--porcelain'])).trim() !== '') {
    await mutation(repo, ['stash', 'push', '--include-untracked', '-m', stashMessage], '暂存未提交的改动失败')
    restored = false
  }
  const restore = async () => {
    if (restored) return ''
    restored = true
    const popped = await runGit(repo, ['stash', 'pop', '--index'], { allowFailure: true })
    return popped.code === 0 ? '' : `未提交的改动已保存在 stash（${stashMessage}），请手动执行 git stash pop --index 恢复。`
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-git-reword-'))
  try {
    const seqPath = path.join(dir, 'sequence.cjs')
    const editorPath = path.join(dir, 'message.cjs')
    const messagePath = path.join(dir, 'message.txt')
    await fsp.writeFile(seqPath, REWORD_SEQUENCE_SCRIPT)
    await fsp.writeFile(editorPath, REWORD_EDITOR_SCRIPT)
    await fsp.writeFile(messagePath, message)
    const rebased = await runGit(repo, args, {
      allowFailure: true,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        DG_REWORD_SHA: sha,
        DG_REWORD_MSG: messagePath,
        GIT_SEQUENCE_EDITOR: `${shellQuote(process.execPath)} ${shellQuote(seqPath)}`,
        GIT_EDITOR: `${shellQuote(process.execPath)} ${shellQuote(editorPath)}`,
      },
    })
    const output = `${rebased.stdout}${rebased.stderr}`.trim()
    if (rebased.code !== 0) {
      // The rewrite is ours (a pending operation was refused above), so aborting
      // here cannot disturb a rebase the user started.
      await runGit(repo, ['rebase', '--abort'], { allowFailure: true })
      const note = await restore()
      throw new GitError([output || '改写提交信息失败', note].filter(Boolean).join('\n'), `git ${args.join(' ')}`)
    }
    const treeAfter = firstLine(await git(repo, ['rev-parse', 'HEAD^{tree}']))
    const note = await restore()
    if (treeBefore !== treeAfter) {
      throw new GitError(
        [`改写提交信息后工作树发生变化（${treeBefore.slice(0, 8)} → ${treeAfter.slice(0, 8)}），已停止`, note].filter(Boolean).join('\n'),
        `git ${args.join(' ')}`,
      )
    }
    return { ...result, changed: true, output, summary: await repoSummary(repo) }
  } finally {
    await restore()
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** What the Squash dialog shows before the user confirms. */
export async function squashPreview(repo, params = {}) {
  const plan = await planSquash(repo, params.shas)
  return {
    commits: plan.commits,
    defaultMessage: plan.defaultMessage,
    base: plan.base,
    newest: plan.newest.hash,
    dirty: plan.dirty,
    stat: plan.stat,
    netEmpty: plan.netEmpty,
  }
}

/**
 * Collapse the selected chain into one commit and replay the commits above it.
 *
 * The new commit carries the newest commit's tree and the oldest commit's
 * author, which is what `git rebase -i` squash produces.
 */
export async function squash(repo, params = {}) {
  const plan = await planSquash(repo, params.shas)
  if (plan.dirty) throw new GitError('工作区或索引有未提交的改动，请先提交或暂存后再 Squash')
  const message = typeof params.message === 'string' && params.message.trim() !== ''
    ? params.message.replace(/\s+$/, '')
    : plan.defaultMessage
  const previousHead = firstLine(await git(repo, ['rev-parse', 'HEAD']))
  // The symbolic branch HEAD sits on, so the rewrite can be verified afterwards.
  const branchName = (await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null
  const tree = firstLine(await git(repo, ['rev-parse', `${plan.newest.hash}^{tree}`]))
  const [authorName, authorEmail, authorDate] = (await git(repo, [
    'show', '-s', `--format=%an${US}%ae${US}%at`, plan.oldest.hash,
  ])).split(US)
  const commitArgs = ['commit-tree', tree]
  if (plan.oldest.parents[0]) commitArgs.push('-p', plan.oldest.parents[0])
  commitArgs.push('-m', message)
  const created = firstLine(await git(repo, commitArgs, {
    env: {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_AUTHOR_DATE: `${authorDate} +0000`,
    },
  }))
  if (!created) throw new GitError('创建 Squash 提交失败')
  // Move the history onto the new commit. When the range ends at HEAD there is
  // nothing to replay, and `git rebase --onto … HEAD` would only perform its
  // detaching start-checkout and never re-attach the branch, so the current ref
  // is moved directly instead.
  const args = plan.newest.hash === previousHead
    ? ['reset', '--hard', created]
    : ['rebase', '--onto', created, plan.newest.hash, branchName ?? 'HEAD']
  const result = await runGit(repo, args, { allowFailure: true, maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout}${result.stderr}`.trim()
  if (result.code !== 0) {
    throw new GitError(
      `${output || 'Squash 失败'}\n（原 HEAD 为 ${previousHead}；可用 git reset --hard ${previousHead} 恢复，或 git rebase --abort）`,
      `git ${args.join(' ')}`,
    )
  }
  // Never leave a rewritten history behind a detached HEAD: a branch that was
  // checked out before the rewrite must still be checked out and moved.
  const headNow = firstLine(await git(repo, ['rev-parse', 'HEAD']))
  const branchNow = (await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null
  const stillAncestor = await runGit(repo, ['merge-base', '--is-ancestor', created, 'HEAD'], { allowFailure: true })
  const problems = []
  if (plan.newest.hash === previousHead && headNow !== created) problems.push(`HEAD 未指向 ${created.slice(0, 8)}（实际 ${String(headNow).slice(0, 8)}）`)
  if (branchName && branchNow !== branchName) problems.push(`HEAD 已脱离分支 ${branchName}`)
  if (stillAncestor.code !== 0) problems.push('新提交不在当前 HEAD 历史中')
  if (problems.length > 0) {
    throw new GitError(
      `Squash 后校验失败：${problems.join('；')}\n（原 HEAD 为 ${previousHead}，可用 git reset --hard ${previousHead} 恢复）`,
      `git ${args.join(' ')}`,
    )
  }
  return {
    squash: {
      sha: created,
      count: plan.chain.length,
      previousHead,
      branch: branchName,
      stat: plan.stat,
      netEmpty: plan.netEmpty,
      output,
      message,
    },
    summary: await repoSummary(repo),
  }
}

/**
 * Validate and execute one panel request.
 * @param request `{ op, ... }` as sent by the Client.
 * @param deps `{ config, workspaceRegistry }`.
 * @returns JSON-safe `data` for the `{ ok: true, data }` envelope.
 */
export async function dispatch(request, deps) {
  const config = normalizeConfig(deps?.config)
  const payload = request && typeof request === 'object' ? request : {}
  const op = typeof payload.op === 'string' ? payload.op : ''
  if (op === 'discover') return discover(config, deps?.workspaceRegistry, payload.extra)
  if (op === 'capabilities') {
    // The panel probes this to decide whether the running Host generation
    // implements the newest operations (a Host module only reloads on restart).
    return { engine: 4, ops: ['snapshot', 'squash', 'squashPreview', 'updateProject', 'reword', 'capabilities'] }
  }
  if (op === 'version') {
    const stdout = await git(process.cwd(), ['--version']).catch(() => 'git')
    return { version: firstLine(stdout) ?? 'git' }
  }
  if (op === 'init') {
    const target = await resolveDirectory(payload.path)
    await git(target, ['init'])
    return { path: target }
  }
  const repoInfo = await resolveRepo(payload.repo)
  const repo = repoInfo.root
  if (op === 'snapshot') {
    // One round trip for the whole panel: repository, work tree, refs and history.
    const [summary, currentIdentity, status, branchTree, history, stashList, remoteList] = await Promise.all([
      repoSummary(repo),
      identity(repo),
      git(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']).then(parseStatus),
      branches(repo),
      log(repo, payload, config),
      stashes(repo),
      remotes(repo),
    ])
    return {
      repo: repoInfo,
      summary,
      identity: currentIdentity,
      status,
      branches: branchTree,
      log: history,
      stashes: stashList,
      remotes: remoteList,
    }
  }
  switch (op) {
    case 'open':
      return { repo: repoInfo, summary: await repoSummary(repo), identity: await identity(repo) }
    case 'status':
      return { status: parseStatus(await git(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])) }
    case 'branches':
      return branches(repo)
    case 'log':
      return log(repo, payload, config)
    case 'commit':
      return { commit: await commitDetail(repo, payload) }
    case 'diff':
      return diff(repo, payload)
    case 'stashes':
      return { stashes: await stashes(repo) }
    case 'remotes':
      return { remotes: await remotes(repo) }
    case 'identity': {
      const current = await identity(repo)
      if (typeof payload.userName === 'string' || typeof payload.userEmail === 'string') {
        if (typeof payload.userName === 'string' && payload.userName.trim() !== '') {
          await git(repo, ['config', 'user.name', payload.userName.trim()])
        }
        if (typeof payload.userEmail === 'string' && payload.userEmail.trim() !== '') {
          await git(repo, ['config', 'user.email', payload.userEmail.trim()])
        }
        return { identity: await identity(repo) }
      }
      return { identity: current }
    }
    case 'stage':
      await git(repo, ['add', '--all', '--', ...asPaths(payload.paths)])
      return { staged: true }
    case 'unstage':
      await git(repo, ['reset', '--quiet', '--', ...asPaths(payload.paths)]).catch(async () => {
        await git(repo, ['rm', '--cached', '--quiet', '-r', '--', ...asPaths(payload.paths)])
      })
      return { unstaged: true }
    case 'stageAll':
      await git(repo, ['add', '--all'])
      return { staged: true }
    case 'unstageAll':
      await git(repo, ['reset', '--quiet'])
      return { unstaged: true }
    case 'discard': {
      const paths = asPaths(payload.paths)
      if (asBoolean(payload.untracked)) {
        await git(repo, ['clean', '-f', '-d', '--', ...paths])
      } else {
        await git(repo, ['checkout', '--', ...paths])
      }
      return { discarded: paths.length }
    }
    case 'commitStaged': {
      const message = typeof payload.message === 'string' ? payload.message : ''
      if (message.trim() === '' && !asBoolean(payload.amend)) throw new GitError('请输入提交信息')
      const args = ['commit', '--no-verify']
      if (message.trim() !== '') args.push('-m', message)
      else args.push('--no-edit')
      if (asBoolean(payload.amend)) args.push('--amend')
      if (asBoolean(payload.signOff)) args.push('--signoff')
      if (asBoolean(payload.all)) args.push('--all')
      const result = await runGit(repo, args, { allowFailure: true })
      if (result.code !== 0) throw new GitError(result.stderr.trim() || '提交失败', `git ${args.join(' ')}`)
      const sha = firstLine(await git(repo, ['rev-parse', 'HEAD']))
      return { sha, output: `${result.stdout}${result.stderr}`.trim() }
    }
    case 'checkout': {
      const ref = assertRevision(payload.ref, '目标')
      const args = ['checkout']
      if (asBoolean(payload.force)) args.push('--force')
      if (asBoolean(payload.create)) {
        args.push('-b', assertRefName(payload.name ?? ref, '分支名'))
        if (typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '') {
          args.push(assertRevision(payload.startPoint, '起点'))
        }
      } else if (asBoolean(payload.track)) {
        args.push('--track', ref)
      } else {
        args.push(ref)
      }
      const result = await runGit(repo, args, { allowFailure: true })
      if (result.code !== 0) throw new GitError(result.stderr.trim() || '检出失败', `git ${args.join(' ')}`)
      return { output: `${result.stdout}${result.stderr}`.trim(), summary: await repoSummary(repo) }
    }
    case 'createBranch': {
      const name = assertRefName(payload.name, '分支名')
      const args = ['branch', name]
      if (typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '') {
        args.push(assertRevision(payload.startPoint, '起点'))
      }
      if (asBoolean(payload.force)) args.splice(1, 0, '-f')
      const result = await runGit(repo, args, { allowFailure: true })
      if (result.code !== 0) throw new GitError(result.stderr.trim() || '创建分支失败', `git ${args.join(' ')}`)
      if (asBoolean(payload.checkout)) await git(repo, ['checkout', name])
      return { created: name, checkedOut: asBoolean(payload.checkout) }
    }
    case 'deleteBranch': {
      const name = assertRefName(payload.name, '分支名')
      const args = ['branch', asBoolean(payload.force) ? '-D' : '-d', name]
      const result = await runGit(repo, args, { allowFailure: true })
      if (result.code !== 0) throw new GitError(result.stderr.trim() || '删除分支失败', `git ${args.join(' ')}`)
      return { deleted: name }
    }
    case 'renameBranch': {
      const from = assertRefName(payload.from, '原分支名')
      const to = assertRefName(payload.to, '新分支名')
      const args = ['branch', '-m']
      if (asBoolean(payload.force)) args.push('-M')
      args.push(from, to)
      const result = await runGit(repo, args, { allowFailure: true })
      if (result.code !== 0) throw new GitError(result.stderr.trim() || '重命名分支失败', `git ${args.join(' ')}`)
      return { renamed: to }
    }
    case 'merge': {
      const ref = assertRevision(payload.ref, '合并目标')
      const args = ['merge', '--no-edit']
      if (messageOf(payload) !== null) args.push('-m', messageOf(payload))
      if (asBoolean(payload.noFf)) args.push('--no-ff')
      if (asBoolean(payload.squash)) args.push('--squash')
      if (asBoolean(payload.noCommit)) args.push('--no-commit')
      args.push(ref)
      return mutation(repo, args, '合并失败')
    }
    case 'rebase': {
      const ref = assertRevision(payload.ref, '变基目标')
      return mutation(repo, ['rebase', ref], '变基失败')
    }
    case 'mergeAbort':
      return mutation(repo, ['merge', '--abort'], '中止合并失败')
    case 'rebaseAbort':
      return mutation(repo, ['rebase', '--abort'], '中止变基失败')
    case 'rebaseContinue':
      return mutation(repo, ['rebase', '--continue'], '继续变基失败')
    case 'cherryPick': {
      const sha = assertRevision(payload.sha, '提交')
      return mutation(repo, ['cherry-pick', sha], '拣选提交失败')
    }
    case 'revert': {
      const sha = assertRevision(payload.sha, '提交')
      const args = ['revert', '--no-edit']
      if (asBoolean(payload.noCommit)) args.push('--no-commit')
      args.push(sha)
      return mutation(repo, args, '回滚提交失败')
    }
    case 'reword':
      return rewordCommit(repo, payload)
    case 'squashPreview':
      return squashPreview(repo, payload)
    case 'squash':
      return squash(repo, payload)
    case 'reset': {
      const mode = ['soft', 'mixed', 'hard', 'keep'].includes(payload.mode) ? payload.mode : 'mixed'
      const ref = assertRevision(payload.ref, '目标')
      return mutation(repo, ['reset', `--${mode}`, ref], '重置失败')
    }
    case 'fetch': {
      const args = ['fetch', '--prune']
      if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(assertNotOption(payload.remote, '远程仓库'))
      if (asBoolean(payload.tags)) args.push('--tags')
      return mutation(repo, args, '获取失败', { timeout: config.networkTimeoutMs, long: true })
    }
    case 'pull': {
      const branch = typeof payload.branch === 'string' && payload.branch.trim() !== ''
        ? assertRefName(payload.branch, '分支名')
        : null
      const args = ['pull', '--no-edit']
      if (asBoolean(payload.rebase)) args.push('--rebase')
      if (asBoolean(payload.ffOnly)) args.push('--ff-only')
      // Same positional hazard as push: a branch may never occupy the remote slot.
      if (branch || (typeof payload.remote === 'string' && payload.remote.trim() !== '')) {
        args.push(await resolveRemote(repo, branch, payload.remote))
      }
      if (branch) args.push(branch)
      return mutation(repo, args, '拉取失败', { timeout: config.networkTimeoutMs, long: true })
    }
    case 'updateProject': {
      const strategy = ['merge', 'rebase', 'reset'].includes(payload.strategy) ? payload.strategy : 'merge'
      const head = await currentBranch(repo)
      if (!head.branch) throw new GitError('当前是分离头指针，无法更新分支')
      const remote = await resolveRemote(repo, head.branch, payload.remote)
      // Fetch first: the counts below only describe the remote once its refs are
      // current, and the dialog promises to say how many commits are incoming.
      await mutation(repo, ['fetch', remote], '获取失败', { timeout: config.networkTimeoutMs })
      const upstream = await upstreamRef(repo, head.branch, remote)
      const counts = await git(repo, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
      const [behind, ahead] = counts.trim().split(/\s+/).map((value) => Number(value) || 0)
      const base = { branch: head.branch, remote, upstream, strategy, ahead, behind }
      if (behind === 0) return { ...base, updated: false, output: '', summary: await repoSummary(repo) }
      const args = strategy === 'reset'
        ? ['reset', '--hard', upstream]
        : strategy === 'rebase'
          ? ['rebase', upstream]
          : ['merge', '--no-edit', upstream]
      const failure = strategy === 'reset' ? '重置失败' : strategy === 'rebase' ? '变基失败' : '合并失败'
      const result = await mutation(repo, args, failure)
      return { ...base, updated: true, output: result.output, summary: await repoSummary(repo) }
    }
    case 'push': {
      const requested = typeof payload.branch === 'string' && payload.branch.trim() !== ''
        ? assertRefName(payload.branch, '分支名')
        : null
      const current = requested ?? firstLine(await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')) ?? null
      const remote = await resolveRemote(repo, requested, payload.remote)
      const args = ['push']
      // `-u` needs a refspec, so it is only passed when the branch is known.
      if (asBoolean(payload.setUpstream) && current) args.push('--set-upstream')
      if (asBoolean(payload.force)) args.push('--force-with-lease')
      if (asBoolean(payload.tags)) args.push('--tags')
      args.push(remote)
      if (requested) args.push(requested)
      return mutation(repo, args, '推送失败', { timeout: config.networkTimeoutMs, long: true })
    }
    case 'deleteRemoteBranch': {
      const remote = assertNotOption(payload.remote, '远程仓库')
      const branch = assertRefName(payload.branch, '分支名')
      return mutation(repo, ['push', remote, '--delete', branch], '删除远程分支失败', {
        timeout: config.networkTimeoutMs,
        long: true,
      })
    }
    case 'addRemote': {
      const name = assertNotOption(payload.name, '远程名')
      const url = assertNotOption(payload.url, '远程地址')
      return mutation(repo, ['remote', 'add', name, url], '添加远程失败')
    }
    case 'removeRemote': {
      const name = assertNotOption(payload.name, '远程名')
      return mutation(repo, ['remote', 'remove', name], '删除远程失败')
    }
    case 'setRemoteUrl': {
      const name = assertNotOption(payload.name, '远程名')
      const url = assertNotOption(payload.url, '远程地址')
      return mutation(repo, ['remote', 'set-url', name, url], '修改远程地址失败')
    }
    case 'createTag': {
      const name = assertRefName(payload.name, '标签名')
      const args = ['tag']
      const message = messageOf(payload)
      if (message !== null) args.push('-a', '-m', message)
      args.push(name)
      if (typeof payload.ref === 'string' && payload.ref.trim() !== '') args.push(assertRevision(payload.ref, '目标'))
      return mutation(repo, args, '创建标签失败')
    }
    case 'deleteTag': {
      const name = assertRefName(payload.name, '标签名')
      return mutation(repo, ['tag', '-d', name], '删除标签失败')
    }
    case 'pushTag': {
      const remote = assertNotOption(payload.remote ?? 'origin', '远程仓库')
      const name = assertRefName(payload.name, '标签名')
      return mutation(repo, ['push', remote, name], '推送标签失败', {
        timeout: config.networkTimeoutMs,
        long: true,
      })
    }
    case 'stashPush': {
      const args = ['stash', 'push']
      const message = messageOf(payload)
      if (message !== null) args.push('-m', message)
      if (asBoolean(payload.includeUntracked)) args.push('--include-untracked')
      if (asBoolean(payload.keepIndex)) args.push('--keep-index')
      return mutation(repo, args, '保存暂存失败')
    }
    case 'stashPop':
      return mutation(repo, ['stash', 'pop', stashSelector(payload.index)], '弹出暂存失败')
    case 'stashApply':
      return mutation(repo, ['stash', 'apply', stashSelector(payload.index)], '应用暂存失败')
    case 'stashDrop':
      return mutation(repo, ['stash', 'drop', stashSelector(payload.index)], '删除暂存失败')
    case 'stashShow':
      return diff(repo, {})
    case 'showFile': {
      const sha = assertRevision(payload.sha, '提交')
      const filePath = typeof payload.path === 'string' && payload.path !== '' ? payload.path : null
      if (!filePath) throw new GitError('缺少文件路径')
      const stdout = await runGit(repo, ['show', `${sha}:${filePath}`], { allowFailure: true, maxBuffer: 8 * 1024 * 1024 })
      if (stdout.code !== 0) throw new GitError(stdout.stderr.trim() || '读取文件内容失败')
      return { content: stdout.stdout.slice(0, 200_000) }
    }
    case 'blame': {
      const filePath = typeof payload.path === 'string' && payload.path !== '' ? payload.path : null
      if (!filePath) throw new GitError('缺少文件路径')
      const stdout = await git(repo, ['blame', '--date=unix', '--line-porcelain', '--', filePath], {
        maxBuffer: 32 * 1024 * 1024,
      })
      return { blame: parseBlame(stdout) }
    }
    default:
      throw new GitError(`未知操作：${op || '(空)'}`)
  }
}

/** Resolve a directory that may not exist yet, for `init`. */
async function resolveDirectory(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new GitError('缺少目录路径')
  const target = path.resolve(input.trim())
  try {
    const stat = await fsp.stat(target)
    if (!stat.isDirectory()) throw new GitError(`不是目录：${target}`)
  } catch (error) {
    if (error instanceof GitError) throw error
    await fsp.mkdir(target, { recursive: true })
  }
  return target
}

function messageOf(payload) {
  return typeof payload.message === 'string' && payload.message.trim() !== '' ? payload.message.trim() : null
}

function stashSelector(index) {
  const value = index === undefined || index === null ? 0 : Number(index)
  if (!Number.isInteger(value) || value < 0) throw new GitError('非法的暂存序号')
  return `stash@{${value}}`
}

/** Run one mutating command and report its human-readable output. */
async function mutation(repo, args, failureMessage, options = {}) {
  const result = await runGit(repo, args, {
    allowFailure: true,
    timeout: options.timeout ?? DEFAULTS.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env,
  })
  const output = `${result.stdout}${result.stderr}`.trim()
  if (result.code !== 0) {
    throw new GitError(output || failureMessage, `git ${args.join(' ')}`)
  }
  return { output, long: options.long === true, summary: options.long === true ? await repoSummary(repo) : undefined }
}

/** Minimal porcelain blame projection: one record per blamed line. */
function parseBlame(stdout) {
  const lines = []
  let current = null
  for (const line of stdout.split('\n')) {
    const header = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(line)
    if (header) {
      current = { sha: header[1], sourceLine: Number(header[2]), resultLine: Number(header[3]), author: '', time: null, text: '' }
      lines.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('author ')) current.author = line.slice(7)
    else if (line.startsWith('author-time ')) current.time = Number(line.slice(12)) * 1000
    else if (line.startsWith('\t')) current.text = line.slice(1)
  }
  return lines
}
