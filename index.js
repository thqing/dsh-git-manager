/**
 * Host half of the Git manager bundle.
 *
 * Registers one authenticated JSON endpoint on the Connection `/api` bridge
 * (`POST /api/dsh-git`) and one agent tool. Both call the same engine in
 * `git.js`, so the panel and the model share one implementation.
 *
 * @module @local/dsh-git-manager
 */
import { GitError, dispatch } from './git.js'

export const name = 'dsh-git-manager'

/** The exact Fetch route the Client half posts to, inside the `/api` fence. */
const API_PATH = '/api/dsh-git'

/** Mutating operations that must not interleave on the same repository. */
const SERIALIZED_OPS = new Set([
  'stage',
  'stageAll',
  'unstage',
  'unstageAll',
  'discard',
  'commitStaged',
  'checkout',
  'createBranch',
  'deleteBranch',
  'renameBranch',
  'merge',
  'mergeAbort',
  'rebase',
  'rebaseAbort',
  'rebaseContinue',
  'cherryPick',
  'revert',
  'reset',
  'squash',
  'reword',
  'fetch',
  'pull',
  'updateProject',
  'push',
  'deleteRemoteBranch',
  'addRemote',
  'removeRemote',
  'setRemoteUrl',
  'createTag',
  'deleteTag',
  'pushTag',
  'stashPush',
  'stashPop',
  'stashApply',
  'stashDrop',
  'identity',
  'init',
])

/** One JSON response; the panel reads `{ ok, data }` or `{ ok: false, message }`. */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Serialize work per repository so a double click cannot interleave two mutations. */
function createQueue() {
  const tails = new Map()
  return function enqueue(key, run) {
    const previous = tails.get(key) ?? Promise.resolve()
    const next = previous.then(run, run)
    const settled = next.then(() => {}, () => {})
    tails.set(key, settled)
    settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key)
    })
    return next
  }
}

/** Turn any failure into the panel's failure envelope. */
function failureOf(error) {
  if (error instanceof GitError) return { ok: false, message: error.message, detail: error.detail ?? '', code: 'git' }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, message, detail: '', code: 'internal' }
}

/**
 * Host plugin body.
 * @param ctx Cordis Host context.
 * @param config bundle row config (`repos`, `maxCommits`, `timeoutMs`, `networkTimeoutMs`).
 */
export function apply(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {}
  const enqueue = createQueue()
  const deps = () => ({ config: settings, workspaceRegistry: ctx.get('workspaceRegistry') })

  async function run(payload) {
    const op = payload && typeof payload === 'object' ? payload.op : undefined
    if (typeof op === 'string' && SERIALIZED_OPS.has(op)) {
      const key = typeof payload.repo === 'string' ? payload.repo : '*'
      return enqueue(key, () => dispatch(payload, deps()))
    }
    return dispatch(payload, deps())
  }

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.fetch.register({
      path: API_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload
        try {
          payload = await request.json()
        } catch {
          return jsonResponse({ ok: false, message: '请求体不是合法 JSON', code: 'bad-request' }, 400)
        }
        try {
          return jsonResponse({ ok: true, data: await run(payload) })
        } catch (error) {
          return jsonResponse(failureOf(error))
        }
      },
    })
  })

  // The same operations are reachable as one agent tool. A failure here must not
  // take the panel down, so registration is guarded and reported as a warning.
  ctx.inject(['tools'], (toolCtx) => {
    try {
      registerTool(toolCtx, run, settings)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-git-manager: git_manage tool not registered: ${error?.message ?? error}`)
    }
  })
}

/** Actions the agent tool exposes, mapped onto engine operations. */
const TOOL_ACTIONS = {
  status: 'status',
  repo_info: 'open',
  branches: 'branches',
  log: 'log',
  commit_detail: 'commit',
  diff: 'diff',
  fetch: 'fetch',
  pull: 'pull',
  update_project: 'updateProject',
  reword_commit: 'reword',
  push: 'push',
  stage: 'stage',
  unstage: 'unstage',
  discard: 'discard',
  commit_staged: 'commitStaged',
  checkout: 'checkout',
  create_branch: 'createBranch',
  delete_branch: 'deleteBranch',
  merge: 'merge',
  rebase: 'rebase',
  revert: 'revert',
  reset: 'reset',
  squash: 'squash',
  squash_preview: 'squashPreview',
  cherry_pick: 'cherryPick',
  stash_push: 'stashPush',
  stash_pop: 'stashPop',
  stash_list: 'stashes',
  create_tag: 'createTag',
  remotes: 'remotes',
  discover: 'discover',
}

/** Arguments accepted by the agent tool and forwarded to the engine verbatim. */
const TOOL_ARGUMENTS = [
  'repo',
  'ref',
  'name',
  'message',
  'paths',
  'remote',
  'branch',
  'sha',
  'mode',
  'startPoint',
  'strategy',
  'max',
  'shas',
]

/** Concise model-facing text for one operation result. */
function summarize(action, data) {
  if (!data || typeof data !== 'object') return `${action}: 完成`
  if (action === 'branches') {
    const remoteCount = (data.remotes ?? []).reduce((total, group) => total + (group.branches?.length ?? 0), 0)
    return `本地分支 ${data.local?.length ?? 0} 个，远程分支 ${remoteCount} 个（${data.remotes?.length ?? 0} 个远程），标签 ${data.tags?.length ?? 0} 个，当前分支 ${data.head ?? '(detached)'}`
  }
  if (action === 'log') return `返回 ${data.commits?.length ?? 0} 条提交`
  if (action === 'squash') {
    return `已把 ${data.squash?.count ?? 0} 个提交压缩为 ${data.squash?.sha ?? ''}（原 HEAD ${data.squash?.previousHead ?? ''}，可用 git reset --hard 恢复）`
  }
  if (action === 'squash_preview') {
    return `将压缩 ${data.commits?.length ?? 0} 个提交：${(data.commits ?? []).map((entry) => entry.subject).join(' | ')}`
  }
  if (action === 'status') return `当前分支 ${data.status?.branch ?? '(detached)'}，变更 ${data.status?.files?.length ?? 0} 个`
  if (action === 'update_project') {
    if (data.updated === false) return `${data.branch} 已经是最新的（${data.upstream}）`
    const verb = data.strategy === 'rebase' ? '变基' : data.strategy === 'reset' ? '重置' : '合并'
    return `已把 ${data.upstream} 的 ${data.behind} 个提交${verb}到 ${data.branch}`
  }
  if (action === 'reword_commit') {
    if (data.changed === false) return `${String(data.sha ?? '').slice(0, 8)} 的提交信息没有变化`
    return `已改写 ${String(data.sha ?? '').slice(0, 8)} 的提交信息：${data.subject ?? ''}`
  }
  if (action === 'diff') return data.diff ? `差异 ${String(data.diff).length} 字符${data.truncated ? '（已截断）' : ''}` : '无差异'
  if (action === 'discover') {
    const repos = (data.repos ?? []).filter((entry) => entry.isRepo)
    return `发现 ${repos.length} 个 Git 仓库：${repos.map((entry) => entry.path).join(', ') || '(无)'}`
  }
  if (typeof data.output === 'string' && data.output.trim() !== '') return data.output.trim()
  if (typeof data.sha === 'string') return `提交成功：${data.sha}`
  return `${action}: 完成`
}

/** Register the `git_manage` tool on a context that owns `tools`. */
function registerTool(toolCtx, run, settings) {
  toolCtx.tools.register({
    name: 'git_manage',
    description: [
      '在 Git 仓库上执行读取或修改操作（与 GUI 的 Git 管理面板共用同一实现）。',
      '`repo` 为仓库目录绝对路径；省略时使用配置中的默认仓库或在 `discover` 时列出可用仓库。',
      `可用 action：${Object.keys(TOOL_ACTIONS).join('、')}。`,
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: Object.keys(TOOL_ACTIONS), description: '要执行的操作。' },
        repo: { type: 'string', description: '仓库工作区绝对路径。' },
        ref: { type: 'string', description: '分支、标签或提交引用（checkout/merge/rebase/reset 的目标）。' },
        name: { type: 'string', description: '要创建的分支名或标签名。' },
        message: { type: 'string', description: '提交信息、合并信息或标签说明。' },
        paths: { type: 'array', items: { type: 'string' }, description: '文件路径列表（stage/unstage/discard/diff）。' },
        remote: { type: 'string', description: '远程仓库名，例如 origin。' },
        branch: { type: 'string', description: '远程分支名（pull/push/delete）。' },
        sha: { type: 'string', description: '提交哈希（commit_detail/revert/cherry_pick/reword_commit）。' },
        mode: { type: 'string', enum: ['soft', 'mixed', 'hard', 'keep'], description: 'reset 模式。' },
        startPoint: { type: 'string', description: '创建分支的起点。' },
        strategy: {
          type: 'string',
          enum: ['merge', 'rebase', 'reset'],
          description: 'update_project 的整合方式：merge 合并（默认）/ rebase 变基 / reset 硬重置到远端分支。',
        },
        shas: {
          type: 'array',
          items: { type: 'string' },
          description: '提交哈希列表（squash/squash_preview：必须是当前 HEAD 上一段连续的线性提交）。',
        },
        max: { type: 'integer', description: 'log 返回的最大提交数。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value && typeof value.summary === 'string' ? value.summary : '完成' },
      ],
    },
    async execute(args) {
      const input = args && typeof args === 'object' ? args : {}
      const action = TOOL_ACTIONS[input.action]
      if (action === undefined) throw new Error(`未知 action：${String(input.action)}`)
      const payload = { op: action }
      for (const key of TOOL_ARGUMENTS) {
        if (input[key] !== undefined) payload[key] = input[key]
      }
      if (payload.repo === undefined && typeof settings.repos?.[0] === 'string') payload.repo = settings.repos[0]
      const data = await run(payload)
      const text = summarize(input.action, data)
      return { ok: true, summary: text, data }
    },
  })
}
