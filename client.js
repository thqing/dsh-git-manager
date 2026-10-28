/**
 * Client half of the Git manager bundle.
 *
 * Registers the sidebar panel icon and the `git` main panel. The panel is an
 * IDE-style tool window: a Local/Remote branch tree, a commit graph, a diff /
 * detail viewer, and a staged-changes area. Every operation goes through the
 * Host route `POST /api/dsh-git`, which shares its implementation with the
 * `git_manage` agent tool.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-git-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-git'
    const PANEL_ID = 'git'
    const API_PATH = '/api/dsh-git'
    const REPO_KEY = 'dsh-git-manager.repo'
    const EXTRA_KEY = 'dsh-git-manager.extraRepos'
    /** Remembered "update project" strategy: merge | rebase | reset. */
    const UPDATE_KEY = 'dsh-git-manager.updateStrategy'
    const MAX_COMMITS = 400

    // ---------------------------------------------------------------- locale

    const ZH = {
      'panel.title': 'Git 管理',
      'panel.tooltip': 'Git 管理',
      'action.refresh': '刷新',
      'action.fetch': '获取',
      'action.pull': '拉取',
      'action.push': '推送',
      'action.commit': '提交',
      'action.newBranch': '新建分支',
      'action.more': '更多',
      'action.addRepo': '添加仓库',
      'action.initRepo': '初始化仓库',
      'action.stash': '暂存修改',
      'action.stashPop': '恢复暂存',
      'action.identity': '配置提交身份',
      'action.remotes': '管理远程',
      'action.close': '关闭',
      'action.cancel': '取消',
      'action.confirm': '确定',
      'action.copy': '复制',
      'action.update': '更新项目',
      'action.updateTitle': '更新项目（Ctrl+T）：获取远程分支，把远端的新提交合并或变基到当前分支',
      'action.updateRestart': '宿主尚未实现该操作，重启 DSH 后可用',
      'dialog.update.title': '更新项目',
      'dialog.update.text': '当前分支 {branch}，跟踪 {upstream}。',
      'dialog.update.textNoUpstream': '当前分支 {branch} 还没有跟踪的远程分支。',
      'dialog.update.merge': '把远端的新提交合并到当前分支',
      'dialog.update.rebase': '把当前分支变基到远端的新提交之上',
      'dialog.update.remember': '记住我的选择，以后不再询问',
      'dialog.update.reset': '重置到远程分支',
      'dialog.update.resetConfirm': '把 {branch} 硬重置到 {upstream}？\n本地未推送的提交和未提交的改动都会丢失。',
      'dialog.update.upToDate': '已经是最新的（{upstream}）',
      'dialog.update.done': '已把 {upstream} 的 {count} 个提交{verb}到 {branch}',
      'verb.merge': '合并',
      'verb.rebase': '变基',
      'verb.reset': '重置',
      'repo.none': '没有找到 Git 仓库',
      'repo.noneHint': '添加一个仓库目录，或在此目录执行 git init。',
      'repo.path': '仓库路径',
      'toolbar.allRefs': '全部分支',
      'filter.placeholder': '搜索提交信息 / 作者 / 哈希',
      'tree.local': 'Local 本地分支',
      'tree.remote': 'Remote 远程分支',
      'tree.tags': 'Tags 标签',
      'tree.stashes': 'Stash 暂存',
      'tree.remotes': 'Remotes 远程仓库',
      'tree.empty': '（空）',
      'tab.changes': '变更',
      'tab.detail': '提交详情',
      'tab.diff': '差异',
      'header.author': '作者',
      'header.date': '日期',
      'header.hash': '提交',
      'changes.staged': '已暂存',
      'changes.unstaged': '未暂存',
      'changes.untracked': '未跟踪',
      'changes.stageAll': '全部暂存',
      'changes.unstageAll': '全部取消暂存',
      'changes.discardAll': '全部丢弃',
      'changes.empty': '工作区干净，没有待提交的变更。',
      'changes.message': '提交信息',
      'changes.messagePlaceholder': '填写提交信息…',
      'changes.amend': '修订上一次提交',
      'changes.commit': '提交已暂存变更',
      'changes.stage': '暂存',
      'changes.unstage': '取消暂存',
      'changes.discard': '丢弃更改',
      'changes.viewDiff': '查看差异',
      'changes.noneSelected': '选中文件后查看差异。',
      'diff.empty': '该文件没有可显示的文本差异。',
      'diff.binary': '二进制文件，不显示文本差异。',
      'detail.none': '选中一条提交查看详情。',
      'detail.files': '变更文件',
      'detail.parents': '父提交',
      'detail.branch': '分支',
      'status.clean': '工作区干净',
      'status.ahead': '领先',
      'status.behind': '落后',
      'status.changes': '个变更',
      'status.loading': '读取中…',
      'status.detached': '分离头指针',
      'menu.checkout': '检出',
      'menu.newBranchHere': '从此新建分支…',
      'menu.mergeInto': '合并到当前分支',
      'menu.rebaseOnto': '将当前分支变基到此',
      'menu.rename': '重命名…',
      'menu.delete': '删除分支',
      'menu.push': '推送到远程',
      'menu.deleteRemote': '删除远程分支',
      'menu.copyName': '复制名称',
      'menu.copyHash': '复制提交哈希',
      'menu.squash': 'Squash Commits…',
      'menu.squashCount': 'Squash {count} 个提交…',
      'menu.copyHashes': '复制 {count} 个提交哈希',
      'menu.clearSelection': '取消选择',
      'selection.count': '已选择 {count} 个相邻提交',
      'selection.hint': '右键可 Squash Commits；Shift 点击扩选、⌘/Ctrl 点击增减。',
      'selection.squashUnavailable': 'Squash 需要重启 App 后可用（插件 Host 半边随进程加载）。',
      'dialog.squash.title': 'Squash {count} 个提交',
      'dialog.squash.message': '合并后的提交信息',
      'dialog.squash.hint': '以下提交将压缩为一个，保留最旧提交的位置与作者：',
      'dialog.squash.dirty': '工作区或索引有未提交的改动，请先提交或暂存后再 Squash。',
      'dialog.squash.stat': '净变更：{files} 个文件，+{add} / -{del}',
      'dialog.squash.netEmpty': '⚠ 所选提交的改动相互抵消：压缩后会得到一个没有文件变更的提交（与 git/IDEA 的 squash 行为一致）。',
      'toast.squashedEmpty': '已压缩 {count} 个提交 → {sha}（净变更为空：所选提交的改动相互抵消）',
      'toast.squashed': '已压缩 {count} 个提交 → {sha}（可用 git reset --hard {previous} 恢复）',
      'menu.detachAt': '检出此提交（分离头指针）',
      'menu.cherryPick': '摘取此提交',
      'menu.revert': '回滚此提交',
      'menu.editMessage': '编辑提交信息…',
      'menu.editMessageHint': '只能改写尚未推送到远端的提交',
      'menu.editMessageRestart': '宿主尚未实现该操作，重启 DSH 后可用',
      'dialog.reword.title': '编辑提交信息',
      'dialog.reword.text': '提交 {sha}，作者 {author}。改写会重写此后的提交哈希。',
      'dialog.reword.empty': '提交信息不能为空',
      'dialog.reword.confirm': '保存',
      'dialog.reword.done': '已改写 {sha} 的提交信息',
      'dialog.reword.unchanged': '提交信息没有变化',
      'menu.resetSoft': '重置到此（soft）',
      'menu.resetMixed': '重置到此（mixed）',
      'menu.resetHard': '重置到此（hard）',
      'menu.tag': '创建标签…',
      'menu.stashApply': '应用',
      'menu.stashPop': '弹出',
      'menu.stashDrop': '删除',
      'menu.mergeAbort': '中止合并',
      'menu.rebaseAbort': '中止变基',
      'menu.merge': '合并…',
      'menu.rebase': '变基…',
      'menu.stashPush': '暂存当前修改…',
      'menu.fetchPrune': '获取并清理',
      'dialog.newBranch.title': '新建分支',
      'dialog.newBranch.name': '分支名',
      'dialog.newBranch.start': '起点（默认当前 HEAD）',
      'dialog.newBranch.checkout': '创建后立即检出',
      'dialog.merge.title': '合并分支',
      'dialog.merge.ref': '要合并进当前分支的引用',
      'dialog.merge.noFf': '始终创建合并提交（--no-ff）',
      'dialog.rebase.title': '变基',
      'dialog.rebase.ref': '当前分支变基到的目标',
      'dialog.rename.title': '重命名分支',
      'dialog.rename.name': '新名称',
      'dialog.tag.title': '创建标签',
      'dialog.tag.name': '标签名',
      'dialog.tag.message': '说明（填写后创建附注标签）',
      'dialog.tag.ref': '目标（默认 HEAD）',
      'dialog.identity.title': '提交身份',
      'dialog.identity.name': 'user.name',
      'dialog.identity.email': 'user.email',
      'dialog.stash.title': '暂存当前修改',
      'dialog.stash.message': '说明',
      'dialog.stash.untracked': '包含未跟踪文件',
      'dialog.repo.title': '添加仓库',
      'dialog.repo.path': '仓库或目录的绝对路径',
      'dialog.remote.title': '管理远程',
      'dialog.remote.name': '远程名',
      'dialog.remote.url': '远程地址',
      'confirm.deleteBranch': '删除分支 {name}？未合并的分支需要强制删除。',
      'confirm.deleteRemoteBranch': '删除远程分支 {name}？',
      'confirm.discard': '丢弃 {count} 个文件的更改？此操作不可撤销。',
      'confirm.resetHard': '硬重置到 {ref}？工作区与索引的修改都会丢失。',
      'confirm.force': '强制',
      'toast.done': '完成',
      'search.empty': '没有匹配的提交',
    }

    const EN = {
      'panel.title': 'Git',
      'panel.tooltip': 'Git',
      'action.refresh': 'Refresh',
      'action.fetch': 'Fetch',
      'action.pull': 'Pull',
      'action.push': 'Push',
      'action.commit': 'Commit',
      'action.newBranch': 'New branch',
      'action.more': 'More',
      'action.addRepo': 'Add repository',
      'action.initRepo': 'Initialize repository',
      'action.stash': 'Stash changes',
      'action.stashPop': 'Pop stash',
      'action.identity': 'Commit identity',
      'action.remotes': 'Remotes',
      'action.close': 'Close',
      'action.cancel': 'Cancel',
      'action.confirm': 'OK',
      'action.copy': 'Copy',
      'action.update': 'Update Project',
      'action.updateTitle': 'Update Project (Ctrl+T): fetch the remote and merge or rebase its new commits into this branch',
      'action.updateRestart': 'The Host does not implement this yet; restart DSH',
      'dialog.update.title': 'Update Project',
      'dialog.update.text': 'Current branch {branch}, tracking {upstream}.',
      'dialog.update.textNoUpstream': 'Current branch {branch} has no tracked remote branch yet.',
      'dialog.update.merge': 'Merge incoming changes into the current branch',
      'dialog.update.rebase': 'Rebase the current branch on top of incoming changes',
      'dialog.update.remember': "Don't ask again: remember this choice",
      'dialog.update.reset': 'Reset to the Remote Branch',
      'dialog.update.resetConfirm': 'Hard reset {branch} to {upstream}?\nUnpushed commits and uncommitted changes will be lost.',
      'dialog.update.upToDate': 'Already up to date ({upstream})',
      'dialog.update.done': '{verb} {count} commit(s) from {upstream} into {branch}',
      'verb.merge': 'Merged',
      'verb.rebase': 'Rebased',
      'verb.reset': 'Reset',
      'repo.none': 'No Git repository found',
      'repo.noneHint': 'Add a repository directory, or run git init in one.',
      'repo.path': 'Repository path',
      'toolbar.allRefs': 'All branches',
      'filter.placeholder': 'Filter by message, author, or hash',
      'tree.local': 'Local branches',
      'tree.remote': 'Remote branches',
      'tree.tags': 'Tags',
      'tree.stashes': 'Stashes',
      'tree.remotes': 'Remotes',
      'tree.empty': '(none)',
      'tab.changes': 'Changes',
      'tab.detail': 'Details',
      'tab.diff': 'Diff',
      'header.author': 'Author',
      'header.date': 'Date',
      'header.hash': 'Commit',
      'changes.staged': 'Staged',
      'changes.unstaged': 'Unstaged',
      'changes.untracked': 'Untracked',
      'changes.stageAll': 'Stage all',
      'changes.unstageAll': 'Unstage all',
      'changes.discardAll': 'Discard all',
      'changes.empty': 'The working tree is clean.',
      'changes.message': 'Commit message',
      'changes.messagePlaceholder': 'Describe the change…',
      'changes.amend': 'Amend the last commit',
      'changes.commit': 'Commit staged changes',
      'changes.stage': 'Stage',
      'changes.unstage': 'Unstage',
      'changes.discard': 'Discard',
      'changes.viewDiff': 'Show diff',
      'changes.noneSelected': 'Select a file to see its diff.',
      'diff.empty': 'No text diff to show for this file.',
      'diff.binary': 'Binary file — no text diff.',
      'detail.none': 'Select a commit to see its details.',
      'detail.files': 'Changed files',
      'detail.parents': 'Parents',
      'detail.branch': 'Branch',
      'status.clean': 'Working tree clean',
      'status.ahead': 'ahead',
      'status.behind': 'behind',
      'status.changes': 'changes',
      'status.loading': 'Loading…',
      'status.detached': 'detached HEAD',
      'menu.checkout': 'Checkout',
      'menu.newBranchHere': 'New branch here…',
      'menu.mergeInto': 'Merge into current branch',
      'menu.rebaseOnto': 'Rebase current branch onto this',
      'menu.rename': 'Rename…',
      'menu.delete': 'Delete branch',
      'menu.push': 'Push to remote',
      'menu.deleteRemote': 'Delete remote branch',
      'menu.copyName': 'Copy name',
      'menu.copyHash': 'Copy commit hash',
      'menu.squash': 'Squash Commits…',
      'menu.squashCount': 'Squash {count} commits…',
      'menu.copyHashes': 'Copy {count} commit hashes',
      'menu.clearSelection': 'Clear selection',
      'selection.count': '{count} adjacent commits selected',
      'selection.hint': 'Right-click to Squash Commits; Shift-click extends, ⌘/Ctrl-click toggles.',
      'selection.squashUnavailable': 'Squash needs an app restart (the Host half loads per process).',
      'dialog.squash.title': 'Squash {count} commits',
      'dialog.squash.message': 'Combined commit message',
      'dialog.squash.hint': 'These commits collapse into one, keeping the oldest position and author:',
      'dialog.squash.dirty': 'The working tree or index has uncommitted changes; commit or stash them first.',
      'dialog.squash.stat': 'Net change: {files} file(s), +{add} / -{del}',
      'dialog.squash.netEmpty': '⚠ These commits cancel each other out: the squashed commit will have no file changes (same as a git/IDEA squash).',
      'toast.squashedEmpty': 'Squashed {count} commits → {sha} (net change is empty: the selected commits cancel out)',
      'toast.squashed': 'Squashed {count} commits → {sha} (recover with git reset --hard {previous})',
      'menu.detachAt': 'Checkout this commit (detached)',
      'menu.cherryPick': 'Cherry-pick this commit',
      'menu.revert': 'Revert this commit',
      'menu.editMessage': 'Edit Commit Message…',
      'menu.editMessageHint': 'Only commits that are not pushed yet can be edited',
      'menu.editMessageRestart': 'The Host does not implement this yet; restart DSH',
      'dialog.reword.title': 'Edit Commit Message',
      'dialog.reword.text': 'Commit {sha} by {author}. Rewriting it changes the hashes of later commits.',
      'dialog.reword.empty': 'The commit message cannot be empty',
      'dialog.reword.confirm': 'Save',
      'dialog.reword.done': 'Rewrote the message of {sha}',
      'dialog.reword.unchanged': 'The commit message did not change',
      'menu.resetSoft': 'Reset here (soft)',
      'menu.resetMixed': 'Reset here (mixed)',
      'menu.resetHard': 'Reset here (hard)',
      'menu.tag': 'Create tag…',
      'menu.stashApply': 'Apply',
      'menu.stashPop': 'Pop',
      'menu.stashDrop': 'Drop',
      'menu.mergeAbort': 'Abort merge',
      'menu.rebaseAbort': 'Abort rebase',
      'menu.merge': 'Merge…',
      'menu.rebase': 'Rebase…',
      'menu.stashPush': 'Stash current changes…',
      'menu.fetchPrune': 'Fetch with prune',
      'dialog.newBranch.title': 'New branch',
      'dialog.newBranch.name': 'Branch name',
      'dialog.newBranch.start': 'Start point (default HEAD)',
      'dialog.newBranch.checkout': 'Check out after creating',
      'dialog.merge.title': 'Merge branch',
      'dialog.merge.ref': 'Reference to merge into the current branch',
      'dialog.merge.noFf': 'Always create a merge commit (--no-ff)',
      'dialog.rebase.title': 'Rebase',
      'dialog.rebase.ref': 'Target the current branch rebases onto',
      'dialog.rename.title': 'Rename branch',
      'dialog.rename.name': 'New name',
      'dialog.tag.title': 'Create tag',
      'dialog.tag.name': 'Tag name',
      'dialog.tag.message': 'Message (creates an annotated tag)',
      'dialog.tag.ref': 'Target (default HEAD)',
      'dialog.identity.title': 'Commit identity',
      'dialog.identity.name': 'user.name',
      'dialog.identity.email': 'user.email',
      'dialog.stash.title': 'Stash current changes',
      'dialog.stash.message': 'Message',
      'dialog.stash.untracked': 'Include untracked files',
      'dialog.repo.title': 'Add repository',
      'dialog.repo.path': 'Absolute path of a repository or directory',
      'dialog.remote.title': 'Remotes',
      'dialog.remote.name': 'Remote name',
      'dialog.remote.url': 'Remote URL',
      'confirm.deleteBranch': 'Delete branch {name}? Unmerged branches need a force delete.',
      'confirm.deleteRemoteBranch': 'Delete remote branch {name}?',
      'confirm.discard': 'Discard changes in {count} file(s)? This cannot be undone.',
      'confirm.resetHard': 'Hard reset to {ref}? Index and working tree changes are lost.',
      'confirm.force': 'Force',
      'toast.done': 'Done',
      'search.empty': 'No matching commit',
    }

    // ------------------------------------------------------------------- api

    /** Absolute or same-origin base for the Host route. */
    function apiBase() {
      const transport = typeof globalThis === 'undefined' ? undefined : globalThis.__DSH_TRANSPORT__
      if (transport && typeof transport.httpBaseUrl === 'string') return transport.httpBaseUrl.replace(/\/+$/, '')
      if (transport && typeof transport.baseUrl === 'string') return transport.baseUrl.replace(/\/+$/, '')
      return ''
    }

    /** One Host call; a business failure throws an Error carrying its detail. */
    async function call(payload) {
      const response = await fetch(`${apiBase()}${API_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`Git 服务不可用（HTTP ${response.status}）`)
      const body = await response.json()
      if (!body || body.ok !== true) {
        const error = new Error(body && body.message ? body.message : '未知错误')
        error.detail = body && typeof body.detail === 'string' ? body.detail : ''
        throw error
      }
      return body.data
    }

    // --------------------------------------------------------------- helpers

    function readJson(key, fallback) {
      try {
        const raw = globalThis.localStorage?.getItem(key)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return parsed ?? fallback
      } catch {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value))
      } catch {
        /* Storage may be unavailable in a sandboxed frame; the panel still works. */
      }
    }

    function copyText(text) {
      try {
        void globalThis.navigator?.clipboard?.writeText(text)
      } catch {
        /* Clipboard access is best-effort. */
      }
    }

    function formatDate(ms) {
      if (!ms) return ''
      const date = new Date(ms)
      const now = Date.now()
      const diff = now - ms
      const pad = (value) => String(value).padStart(2, '0')
      if (diff >= 0 && diff < 60_000) return '刚刚'
      if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
      if (diff >= 0 && diff < 86_400_000) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
      if (diff >= 0 && diff < 7 * 86_400_000) return `${date.getMonth() + 1}月${date.getDate()}日`
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function shortHash(hash) {
      return typeof hash === 'string' ? hash.slice(0, 8) : ''
    }

    // Lane colors stay colorful in both themes; brand-primary is monochrome and
    // would paint a white lane on the dark theme.
    const LANE_COLORS = [
      'var(--dsw-alias-state-business-primary, #4176e6)',
      'var(--dsw-alias-state-success-primary, #34c724)',
      'var(--dsw-alias-state-warn-primary, #ff8800)',
      'var(--dsw-alias-state-error-primary, #f54a45)',
      'var(--dsw-alias-state-idle-primary, #8f959e)',
    ]

    /** Assign a lane to every commit so a stable graph can be drawn. */
    function buildGraph(commits) {
      const lanes = []
      const rows = []
      for (const commit of commits) {
        let lane = lanes.indexOf(commit.hash)
        if (lane === -1) {
          lane = lanes.indexOf(null)
          if (lane === -1) {
            lane = lanes.length
            lanes.push(null)
          }
        }
        const before = lanes.slice()
        for (let index = 0; index < lanes.length; index += 1) {
          if (lanes[index] === commit.hash) lanes[index] = null
        }
        const parents = commit.parents ?? []
        lanes[lane] = parents[0] ?? null
        for (let index = 1; index < parents.length; index += 1) {
          if (lanes.includes(parents[index])) continue
          let slot = lanes.indexOf(null)
          if (slot === -1) {
            lanes.push(null)
            slot = lanes.length - 1
          }
          lanes[slot] = parents[index]
        }
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
        const after = lanes.slice()
        const parentLanes = parents.map((parent) => after.indexOf(parent)).filter((index) => index >= 0)
        rows.push({
          commit,
          lane,
          before,
          after,
          parentLanes,
          width: Math.max(before.length, after.length, lane + 1, 1),
        })
      }
      return rows
    }

    /**
     * Split branch or tag names on `/` into folders and leaves, the way the IDE
     * tool window shows them: `backup/devOriginalMenuStyle` becomes the folder
     * `backup` holding the branch `devOriginalMenuStyle`.
     * @param entries ref entries carrying at least `name`.
     * @param stripPrefix remote prefix removed from every name (`origin`).
     * @returns `{ folders: Map, leaves: [], count }` with `count` = descendant leaves.
     */
    function buildBranchTree(entries, stripPrefix) {
      const root = { folders: new Map(), leaves: [], count: 0 }
      for (const entry of entries) {
        let name = String(entry.name ?? '')
        if (stripPrefix && name.startsWith(`${stripPrefix}/`)) name = name.slice(stripPrefix.length + 1)
        const parts = name.split('/').filter((part) => part !== '')
        const label = parts.length > 0 ? parts[parts.length - 1] : name
        let node = root
        root.count += 1
        for (let index = 0; index < parts.length - 1; index += 1) {
          const key = parts[index]
          let child = node.folders.get(key)
          if (!child) {
            child = { folders: new Map(), leaves: [], count: 0 }
            node.folders.set(key, child)
          }
          child.count += 1
          node = child
        }
        node.leaves.push({ entry, label, path: name })
      }
      return root
    }

    /** Whether a subtree holds the current branch, so it can be ranked first. */
    function subtreeHasCurrent(node) {
      if (node.leaves.some((leaf) => leaf.entry.current === true)) return true
      for (const child of node.folders.values()) {
        if (subtreeHasCurrent(child)) return true
      }
      return false
    }

    /** Classify unified-diff lines for rendering. */
    function parseDiff(text) {
      const out = []
      for (const line of String(text ?? '').split('\n')) {
        let type = 'context'
        if (
          line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('new file') ||
          line.startsWith('deleted file') ||
          line.startsWith('rename ') ||
          line.startsWith('similarity index') ||
          line.startsWith('old mode') ||
          line.startsWith('new mode') ||
          line.startsWith('Binary files')
        ) {
          type = 'meta'
        } else if (line.startsWith('@@')) type = 'hunk'
        else if (line.startsWith('+')) type = 'add'
        else if (line.startsWith('-')) type = 'del'
        out.push({ type, text: line })
      }
      return out
    }

    /**
     * Coarse net-change counts from a unified patch. Used when the running Host
     * generation predates the engine's own numstat report.
     */
    function statFromPatch(text) {
      let files = 0
      let additions = 0
      let deletions = 0
      for (const line of String(text ?? '').split('\n')) {
        if (line.startsWith('diff --git ')) files += 1
        else if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
        else if (line.startsWith('+')) additions += 1
        else if (line.startsWith('-')) deletions += 1
      }
      return { files, additions, deletions }
    }

    /** Short status letter for one work-tree entry. */
    function statusLetter(file) {
      if (file.untracked) return 'U'
      if (file.unmerged) return '!'
      const letter = file.worktree !== '.' && file.worktree !== ' ' ? file.worktree : file.index
      return letter === '.' || letter === ' ' || !letter ? 'M' : letter
    }

    // ---------------------------------------------------------------- styles

    const CSS = `
.dg-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;
  --dg-text:var(--dsw-alias-label-primary,#1f2329);
  --dg-dim:var(--dsw-alias-label-secondary,#646a73);
  --dg-faint:var(--dsw-alias-label-tertiary,#8f959e);
  --dg-border:var(--dsw-alias-border-l2,rgba(128,132,142,.24));
  --dg-border-strong:var(--dsw-alias-border-l3,rgba(128,132,142,.36));
  --dg-bg:var(--dsw-alias-bg-base,transparent);
  --dg-panel:var(--dsw-alias-bg-layer-1,rgba(128,132,142,.06));
  --dg-panel-2:var(--dsw-alias-bg-layer-2,rgba(128,132,142,.10));
  --dg-raised:var(--dsw-alias-bg-layer-3,rgba(128,132,142,.14));
  --dg-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,132,142,.12));
  /* A real accent: brand-primary is the monochrome contrast color (near-white in
     the dark theme), so it must never carry white text or a decorative tint. */
  --dg-accent:var(--dsw-alias-state-business-primary,#4176e6);
  --dg-accent-soft:color-mix(in srgb,var(--dg-accent) 15%,transparent);
  --dg-accent-line:color-mix(in srgb,var(--dg-accent) 36%,transparent);
  /* Filled controls use the host's primary-button pair, which flips its label. */
  --dg-fill:var(--dsw-alias-button-primary-fill,#0f1115);
  --dg-fill-fg:var(--dsw-alias-label-primary-foreground,#fff);
  --dg-fill-hover:var(--dsw-alias-button-primary-hover,#3a3d45);
  --dg-danger:var(--dsw-alias-state-error-primary,#f54a45);
  --dg-success:var(--dsw-alias-state-success-primary,#34c724);
  /* The checked-out branch is green, but the host green (green-500) is too light
     to read as 13px text on the light theme's white panel. Mixing it toward the
     theme's own label color yields a darker green on light and a brighter one on
     dark, without a theme selector. */
  --dg-current-ink:color-mix(in srgb,var(--dg-success) 62%,var(--dg-text));
  --dg-node-fill:var(--dsw-alias-bg-base,var(--dg-panel));
  --dg-radius:var(--dsw-radius-md,6px);
  color:var(--dg-text);font-size:13px;line-height:20px;background:var(--dg-bg);
  padding-top:var(--dsh-frame-top-clearance,0px);}
.dg-root *{box-sizing:border-box}
.dg-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--dg-border)}
.dg-title{font-weight:600;font-size:14px;margin-right:4px}
.dg-body{display:flex;flex:1;min-height:0}
.dg-side{width:280px;flex:none;border-right:1px solid var(--dg-border);overflow:auto;padding:6px 0 16px}
.dg-main{display:flex;flex-direction:column;flex:1;min-width:0}
.dg-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:var(--dg-radius);
  border:.5px solid var(--dg-border-strong);background:transparent;color:var(--dg-text);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.dg-btn:hover:not(:disabled){background:var(--dg-hover)}
.dg-btn:disabled{opacity:.45;cursor:default}
.dg-btn.dg-primary{background:var(--dg-fill);border-color:transparent;color:var(--dg-fill-fg)}
.dg-btn.dg-primary:hover:not(:disabled){background:var(--dg-fill-hover);filter:none}
.dg-btn.dg-danger{color:var(--dg-danger);border-color:color-mix(in srgb,var(--dg-danger) 35%,transparent)}
.dg-btn.dg-ghost{border-color:transparent}
.dg-btn.dg-sm{height:22px;padding:0 8px;font-size:12px}
.dg-select{height:26px;max-width:260px;border-radius:var(--dg-radius);border:.5px solid var(--dg-border-strong);
  background:var(--dg-panel);color:var(--dg-text);font:inherit;font-size:12.5px;padding:0 6px}
.dg-spacer{flex:1}
.dg-input{width:100%;height:28px;border-radius:var(--dg-radius);border:.5px solid var(--dg-border-strong);
  background:var(--dg-panel);color:var(--dg-text);font:inherit;font-size:12.5px;padding:0 8px;outline:none}
.dg-input:focus{border-color:var(--dg-accent)}
.dg-textarea{width:100%;min-height:64px;resize:vertical;border-radius:var(--dg-radius);border:.5px solid var(--dg-border-strong);
  background:var(--dg-panel);color:var(--dg-text);font:inherit;font-size:12.5px;padding:6px 8px;outline:none}
.dg-textarea:focus{border-color:var(--dg-accent)}
.dg-label{color:var(--dg-dim);font-size:12px}
.dg-hint{color:var(--dg-faint);font-size:12px}
.dg-section{display:flex;align-items:center;gap:6px;padding:6px 12px 2px;color:var(--dg-faint);font-size:11.5px;
  letter-spacing:.03em;text-transform:none;font-weight:600}
.dg-row{display:flex;align-items:center;gap:6px;height:25px;padding:0 12px;cursor:default;border-radius:4px;margin:0 6px;white-space:nowrap}
.dg-row:hover{background:var(--dg-hover)}
.dg-row.dg-active{background:var(--dg-accent-soft)}
/* The checked-out branch anchors the whole tree: bold, with a green name and
   branch glyph. Colour alone carries it, so hover and selection keep the fill. */
.dg-row.dg-current{font-weight:600}
.dg-row.dg-folder{color:var(--dg-dim)}
.dg-row .dg-name{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.dg-row.dg-current .dg-name{color:var(--dg-current-ink)}
.dg-row .dg-tag{color:var(--dg-faint);font-size:11px;font-variant-numeric:tabular-nums}
.dg-indent{padding-left:22px}
/* The disclosure arrow is the only affordance separating a folder from a leaf,
   so it needs real area: a 10px text triangle is illegible and ▾/▸ read alike.
   One filled triangle rotates instead, which keeps both states obviously the
   same control at a glance. */
.dg-caret{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;
  color:var(--dg-dim)}
.dg-caret svg{transition:transform .12s ease}
.dg-caret.dg-open svg{transform:rotate(90deg)}
.dg-caret.dg-clickable:hover{color:var(--dg-text)}
.dg-glyph{display:inline-flex;flex:none;color:var(--dg-faint)}
.dg-row.dg-current .dg-glyph{color:var(--dg-success)}
.dg-row.dg-folder .dg-glyph{color:var(--dg-dim)}
.dg-badge{display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:3px;font-size:10.5px;
  border:.5px solid var(--dg-border-strong);color:var(--dg-dim);background:var(--dg-panel);white-space:nowrap}
.dg-badge.dg-head{color:var(--dg-accent);background:var(--dg-accent-soft);border-color:var(--dg-accent-line)}
.dg-badge.dg-remote{color:var(--dg-dim)}
.dg-badge.dg-tagb{color:var(--dg-success);border-color:color-mix(in srgb,var(--dg-success) 40%,transparent)}
.dg-logbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dg-border)}
.dg-log{flex:1 1 52%;min-height:120px;overflow:auto;padding:2px 0 8px}
.dg-commit{display:flex;align-items:center;gap:8px;height:26px;padding-right:14px;cursor:default;white-space:nowrap}
.dg-commit:hover{background:var(--dg-hover)}
.dg-commit.dg-active{background:var(--dg-accent-soft)}
.dg-commit.dg-primary{box-shadow:inset 2px 0 0 var(--dg-accent)}
.dg-selection{display:flex;flex-direction:column;gap:3px;padding:8px 10px;margin-bottom:10px;border-radius:var(--dg-radius);
  background:var(--dg-accent-soft);font-size:12.5px}
.dg-selection .dg-sel-title{font-weight:600}
.dg-squash-list{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow:auto;
  border-top:1px solid var(--dg-border);padding-top:6px;font-size:12px;color:var(--dg-dim)}
.dg-squash-stat{color:var(--dg-dim);font-variant-numeric:tabular-nums}
.dg-squash-empty{color:var(--dsw-alias-state-warn-primary,#ff8800);white-space:pre-wrap}
.dg-commit .dg-subj{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dg-commit .dg-meta{color:var(--dg-faint);font-size:11.5px;flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.dg-commit .dg-sha{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);
  color:var(--dg-dim);font-size:11.5px;flex:none}
.dg-graph{flex:none;display:block}
.dg-detail{flex:0 0 46%;min-height:170px;border-top:1px solid var(--dg-border);display:flex;flex-direction:column;overflow:hidden}
.dg-tabs{display:flex;align-items:center;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--dg-border)}
.dg-tab{height:26px;padding:0 10px;border:0;background:transparent;color:var(--dg-dim);font:inherit;font-size:12.5px;
  cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.dg-tab.dg-on{color:var(--dg-text);border-bottom-color:var(--dg-accent);font-weight:600}
.dg-tabbody{flex:1;min-height:0;overflow:auto;padding:8px 12px 16px}
.dg-diff{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;
  white-space:pre;margin:0;overflow:auto}
.dg-diff .dg-l-add{color:var(--dg-success)}
.dg-diff .dg-l-del{color:var(--dg-danger)}
.dg-diff .dg-l-hunk{color:var(--dg-accent)}
.dg-diff .dg-l-meta{color:var(--dg-faint)}
.dg-filelist{display:flex;flex-direction:column;gap:1px}
.dg-file{display:flex;align-items:center;gap:8px;height:24px;padding:0 6px;border-radius:4px;cursor:default}
.dg-file:hover{background:var(--dg-hover)}
.dg-file.dg-active{background:var(--dg-accent-soft)}
.dg-file .dg-fp{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.dg-file .dg-lst{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11.5px;color:var(--dg-faint)}
.dg-stat-add{color:var(--dg-success)}
.dg-stat-del{color:var(--dg-danger)}
.dg-status{display:flex;align-items:center;gap:10px;padding:6px 14px;border-top:1px solid var(--dg-border);
  color:var(--dg-faint);font-size:11.5px;flex-wrap:wrap}
/* Same green as the tree row, so the branch that HEAD points at is recognisable
   in the status bar too. */
.dg-status .dg-cur-branch{color:var(--dg-current-ink);font-weight:600}
.dg-notice{display:flex;align-items:flex-start;gap:8px;margin:8px 12px;padding:8px 10px;border-radius:var(--dg-radius);
  background:var(--dg-panel-2);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.dg-notice.dg-error{background:color-mix(in srgb,var(--dg-danger) 14%,transparent);color:var(--dg-danger)}
.dg-empty{color:var(--dg-faint);padding:18px 16px;font-size:12.5px;text-align:center;line-height:20px}
.dg-overlay{position:fixed;inset:0;background:rgba(15,17,20,.36);z-index:1300;display:flex;align-items:flex-start;
  justify-content:center;padding:14vh 16px 16px}
.dg-dialog{background:var(--dsw-alias-bg-overlay,var(--dg-panel-2));border:0;border-radius:var(--dsw-radius-lg,10px);
  box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.28));width:min(520px,100%);
  max-height:70vh;display:flex;flex-direction:column;color:var(--dg-text)}
.dg-dialog-head{padding:14px 16px 8px;font-size:15px;font-weight:600}
.dg-dialog-body{padding:0 16px 8px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.dg-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px 14px}
.dg-field{display:flex;flex-direction:column;gap:5px}
.dg-choices{display:flex;flex-direction:column;gap:2px}
.dg-choice{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dg-radius);
  cursor:pointer;font-size:12.5px;line-height:17px}
.dg-choice:hover{background:var(--dg-hover)}
.dg-choice input{flex:none;margin:0}
.dg-choice-check{display:flex;align-items:center;gap:7px;margin-top:4px;color:var(--dg-text);
  font-size:12px;cursor:pointer}
.dg-choice-check input{flex:none;margin:0}
/* The dialog's one explaining sentence is body copy, not a dim hint. */
.dg-dialog .dg-hint{color:var(--dg-text)}
.dg-menu{position:fixed;z-index:1400;min-width:198px;max-height:60vh;overflow:auto;padding:5px;
  background:var(--dsw-alias-bg-overlay,var(--dg-panel-2));border-radius:var(--dsw-radius-lg,10px);
  box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.28));color:var(--dg-text)}
.dg-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 10px;border:0;border-radius:5px;
  background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer;white-space:nowrap}
.dg-menu-item:hover:not(:disabled){background:var(--dg-hover)}
.dg-menu-item:disabled{opacity:.4;cursor:default}
.dg-menu-item.dg-danger{color:var(--dg-danger)}
.dg-menu-sep{height:1px;margin:4px 6px;background:var(--dg-border)}
.dg-scrim{position:fixed;inset:0;z-index:1390}
.dg-spin{display:inline-block;width:11px;height:11px;border:1.5px solid var(--dg-border-strong);
  border-top-color:var(--dg-accent);border-radius:50%;animation:dg-spin .7s linear infinite}
@keyframes dg-spin{to{transform:rotate(360deg)}}
.dg-clickable{cursor:pointer}
`

    // -------------------------------------------------------------- primitives

    function Button(props) {
      const className = [
        'dg-btn',
        props.primary ? 'dg-primary' : '',
        props.danger ? 'dg-danger' : '',
        props.ghost ? 'dg-ghost' : '',
        props.small ? 'dg-sm' : '',
      ].filter(Boolean).join(' ')
      return h('button', {
        type: 'button',
        className,
        title: props.title ?? undefined,
        disabled: props.disabled === true,
        onClick: props.onClick,
        children: props.children,
      })
    }

    function Dialog(props) {
      const dialog = props.dialog
      const [value, setValue] = useState(dialog.value ?? '')
      const [checked, setChecked] = useState(dialog.checked === true)
      const inputRef = useRef(null)
      useEffect(() => {
        if (dialog.kind === 'text' && inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select?.()
        }
      }, [dialog])
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            props.onClose(null)
          } else if (event.key === 'Enter' && dialog.kind === 'text' && !dialog.multiline && !event.shiftKey) {
            event.preventDefault()
            props.onClose(value)
          } else if (event.key === 'Enter' && dialog.multiline === true && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            props.onClose(value)
          } else if (event.key === 'Enter' && dialog.kind === 'choice') {
            event.preventDefault()
            props.onClose(dialog.checkedLabel ? { value, checked } : { value })
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [dialog, value, props])
      const fields = []
      // A text dialog may still explain itself ("commit abc by …, rewriting moves
      // every later hash"); the input is added below.
      if (dialog.kind === 'text' && dialog.text) fields.push(h('div', { key: 'm', className: 'dg-hint' }, dialog.text))
      if (dialog.kind === 'text') {
        fields.push(h('div', { className: 'dg-field', key: 'f' },
          dialog.label ? h('div', { className: 'dg-label' }, dialog.label) : null,
          dialog.multiline
            ? h('textarea', {
              key: 'i',
              ref: inputRef,
              className: 'dg-textarea',
              style: { minHeight: '132px' },
              value,
              placeholder: dialog.placeholder ?? '',
              onChange: (event) => setValue(event.target.value),
            })
            : h('input', {
              key: 'i',
              ref: inputRef,
              className: 'dg-input',
              value,
              placeholder: dialog.placeholder ?? '',
              onChange: (event) => setValue(event.target.value),
            })))
        if (dialog.checkedLabel) {
          fields.push(h('label', { className: 'dg-label', key: 'c', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            h('input', { type: 'checkbox', checked, onChange: (event) => setChecked(event.target.checked) }),
            dialog.checkedLabel))
        }
      } else if (dialog.kind === 'choice') {
        if (dialog.text) fields.push(h('div', { key: 'm', className: 'dg-hint' }, dialog.text))
        const options = Array.isArray(dialog.options) ? dialog.options : []
        fields.push(h('div', { key: 'o', className: 'dg-choices' }, options.map((option) => h('label', {
          key: option.value,
          className: `dg-choice${value === option.value ? ' dg-on' : ''}`,
        }, [
          h('input', {
            key: 'i',
            type: 'radio',
            name: 'dg-choice',
            checked: value === option.value,
            onChange: () => setValue(option.value),
          }),
          h('span', { key: 'l' }, option.label),
        ]))))
        if (dialog.checkedLabel) {
          fields.push(h('label', { key: 'c', className: 'dg-choice-check' }, [
            h('input', { key: 'i', type: 'checkbox', checked, onChange: (event) => setChecked(event.target.checked) }),
            h('span', { key: 'l' }, dialog.checkedLabel),
          ]))
        }
      } else {
        fields.push(h('div', { key: 'm', style: { whiteSpace: 'pre-wrap' } }, dialog.text))
      }
      const readValue = () => (dialog.kind === 'text' || dialog.kind === 'choice' ? { value, checked } : true)
      const extra = dialog.footExtra
      return h('div', {
        className: 'dg-overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) props.onClose(null)
        },
      }, h('div', { className: 'dg-dialog', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'dg-dialog-head' }, dialog.title),
        h('div', { className: 'dg-dialog-body' }, [
          ...fields,
          dialog.extra ? dialog.extra({ value, setValue }) : null,
        ]),
        h('div', { className: 'dg-dialog-foot' }, [
          extra
            ? h(Button, {
              key: 'x',
              ghost: true,
              danger: extra.danger === true,
              onClick: () => props.onClose({ ...readValue(), action: 'extra' }),
              children: extra.label,
            })
            : null,
          extra ? h('div', { key: 'sp', className: 'dg-spacer' }) : null,
          h(Button, { key: 'c', onClick: () => props.onClose(null), children: props.t('action.cancel') }),
          h(Button, {
            key: 'o',
            primary: true,
            danger: dialog.danger === true,
            onClick: () => props.onClose(readValue()),
            children: dialog.confirmText ?? props.t('action.confirm'),
          }),
        ])))
    }

    function Menu(props) {
      const menu = props.menu
      useEffect(() => {
        const close = () => props.onClose()
        const onKey = (event) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('keydown', onKey, true)
        globalThis.addEventListener?.('blur', close)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          globalThis.removeEventListener?.('blur', close)
        }
      }, [props])
      const width = 210
      const left = Math.min(menu.x, (globalThis.innerWidth ?? 1200) - width - 8)
      const top = Math.min(menu.y, Math.max(8, (globalThis.innerHeight ?? 800) - menu.items.length * 29 - 16))
      return h(React.Fragment, null,
        h('div', { className: 'dg-scrim', onMouseDown: () => props.onClose(), onContextMenu: (event) => { event.preventDefault(); props.onClose() } }),
        h('div', { className: 'dg-menu', style: { left, top }, role: 'menu' },
          menu.items.map((item, index) => (item.separator
            ? h('div', { className: 'dg-menu-sep', key: `s${index}` })
            : h('button', {
              key: `${item.label}${index}`,
              type: 'button',
              role: 'menuitem',
              className: `dg-menu-item${item.danger ? ' dg-danger' : ''}`,
              disabled: item.disabled === true,
              title: item.hint,
              onClick: () => {
                props.onClose()
                item.onSelect?.()
              },
              children: item.label,
            })))))
    }

    // ------------------------------------------------------------- graph parts

    /** Small 13px glyphs matching the sidebar's own icon weight. */
    function Glyph(props) {
      const paths = props.paths
      return h('svg', {
        width: 13,
        height: 13,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        className: 'dg-glyph',
      }, paths.map((path, index) => h(path.circle ? 'circle' : 'path', { key: index, ...path })))
    }

    /** Disclosure triangle for the tree: points right when collapsed and is
     *  rotated a quarter turn when open. Filled rather than stroked, because a
     *  thin chevron is what made the two states look alike. */
    function CaretGlyph() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'currentColor',
        stroke: 'none',
        'aria-hidden': true,
        className: 'dg-chevron',
      }, h('path', { d: 'M5.2 2.8 12.8 8 5.2 13.2z' }))
    }

    function FolderGlyph(props) {
      return h(Glyph, {
        paths: props.open === true
          ? [
            { d: 'M1.6 4.2h4.1l1.5 1.7h7.2v7.9H1.6z' },
            { d: 'M1.6 6h12.8' },
          ]
          : [{ d: 'M1.6 3.4h4.1l1.5 1.7h7.2v8.7H1.6z' }],
      })
    }

    function BranchGlyph() {
      return h(Glyph, {
        paths: [
          { circle: true, cx: 4.8, cy: 3.4, r: 1.7 },
          { circle: true, cx: 4.8, cy: 12.6, r: 1.7 },
          { circle: true, cx: 11.2, cy: 6.2, r: 1.7 },
          { d: 'M4.8 5.1v5.8' },
          { d: 'M11.2 7.9c0 2.2-1.9 3.6-4.4 3.9' },
        ],
      })
    }

    function RepoGlyph() {
      return h(Glyph, {
        paths: [
          { d: 'M2.4 4.6c0-1 2.5-1.8 5.6-1.8s5.6.8 5.6 1.8-2.5 1.8-5.6 1.8S2.4 5.6 2.4 4.6z' },
          { d: 'M2.4 4.6v6.8c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V4.6' },
          { d: 'M2.4 8c0 1 2.5 1.8 5.6 1.8S13.6 9 13.6 8' },
        ],
      })
    }

    function TagGlyph() {
      return h(Glyph, {
        paths: [
          { d: 'M8.4 1.8H2.2v6.2l6.4 6.2 6.2-6.2z' },
          { circle: true, cx: 5, cy: 4.6, r: 1.1 },
        ],
      })
    }

    function StackGlyph() {
      return h(Glyph, {
        paths: [
          { d: 'M8 1.9 1.9 5 8 8.1 14.1 5z' },
          { d: 'M2.6 8.2 8 11l5.4-2.8' },
          { d: 'M2.6 11.3 8 14.1l5.4-2.8' },
        ],
      })
    }

    function GraphCell(props) {
      const row = props.row
      const LANE = 12
      const HEIGHT = 26
      // Every row shares one width so the hash/subject columns stay aligned.
      const width = props.width ?? (row.width * LANE + 6)
      const colorOf = (index) => LANE_COLORS[index % LANE_COLORS.length]
      const x = (index) => index * LANE + LANE / 2 + 3
      const parts = []
      const count = Math.max(row.before.length, row.after.length, row.lane + 1)
      for (let index = 0; index < count; index += 1) {
        const up = row.before[index] ?? null
        const down = row.after[index] ?? null
        const cx = x(index)
        if (index === row.lane) {
          // The node's own lane: the upper half is drawn here, the lower half is
          // its parent edge. Skipping this half is what broke the line between
          // two adjacent rows.
          if (up) {
            parts.push(h('line', {
              key: `in${index}`,
              x1: cx, y1: -1, x2: cx, y2: HEIGHT / 2,
              stroke: colorOf(index), strokeWidth: 1.6, shapeRendering: 'crispEdges',
            }))
          }
          continue
        }
        if (!up && !down) continue
        if (up && down) {
          parts.push(h('line', { key: `v${index}`, x1: cx, y1: -1, x2: cx, y2: HEIGHT + 1, stroke: colorOf(index), strokeWidth: 1.6, shapeRendering: 'crispEdges' }))
        } else if (up) {
          parts.push(h('line', { key: `v${index}`, x1: cx, y1: -1, x2: cx, y2: HEIGHT / 2, stroke: colorOf(index), strokeWidth: 1.6, shapeRendering: 'crispEdges' }))
        } else {
          parts.push(h('line', { key: `v${index}`, x1: cx, y1: HEIGHT / 2, x2: cx, y2: HEIGHT + 1, stroke: colorOf(index), strokeWidth: 1.6, shapeRendering: 'crispEdges' }))
        }
      }
      const cx = x(row.lane)
      // Edges leave the node's centre and land exactly on the next row's top edge,
      // so the following row's incoming segment continues the same line.
      row.parentLanes.forEach((parentLane, index) => {
        const px = x(parentLane)
        if (px === cx) {
          // Straight continuation stays a plain line so it meets the next row's
          // incoming segment pixel-for-pixel.
          parts.push(h('line', {
            key: `e${index}`,
            x1: cx, y1: HEIGHT / 2, x2: cx, y2: HEIGHT + 1,
            stroke: colorOf(row.lane), strokeWidth: 1.6, shapeRendering: 'crispEdges',
          }))
          return
        }
        parts.push(h('path', {
          key: `e${index}`,
          d: `M${cx} ${HEIGHT / 2} C ${cx} ${HEIGHT * 0.8}, ${px} ${HEIGHT * 0.2}, ${px} ${HEIGHT}`,
          fill: 'none',
          stroke: colorOf(row.lane),
          strokeWidth: 1.6,
        }))
      })
      parts.push(h('circle', {
        key: 'node',
        cx,
        cy: HEIGHT / 2,
        r: props.selected ? 4.4 : 3.6,
        fill: 'var(--dg-node-fill, var(--dg-bg))',
        stroke: colorOf(row.lane),
        strokeWidth: 1.8,
      }))
      return h('svg', {
        className: 'dg-graph',
        width,
        height: HEIGHT,
        viewBox: `0 0 ${width} ${HEIGHT}`,
        // The 1px vertical overlap between stacked cells must not be clipped.
        style: { overflow: 'visible' },
        'aria-hidden': true,
      }, parts)
    }

    // ---------------------------------------------------------------- the panel

    function GitPanel(props) {
      const t = props.t
      const [repos, setRepos] = useState([])
      const [repoPath, setRepoPath] = useState(null)
      const [snapshot, setSnapshot] = useState(null)
      const [loading, setLoading] = useState(false)
      const [busy, setBusy] = useState(null)
      const [notice, setNotice] = useState(null)
      const [filter, setFilter] = useState('')
      const [allRefs, setAllRefs] = useState(false)
      const [logRef, setLogRef] = useState(null)
      const [selection, setSelection] = useState(null)
      const [detail, setDetail] = useState(null)
      const [diff, setDiff] = useState(null)
      const [diffLoading, setDiffLoading] = useState(false)
      const [tab, setTab] = useState('changes')
      const [message, setMessage] = useState('')
      const [amend, setAmend] = useState(false)
      const [checked, setChecked] = useState({})
      const [collapsed, setCollapsed] = useState({})
      const [menu, setMenu] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [repoError, setRepoError] = useState(null)
      const [supportsSquash, setSupportsSquash] = useState(false)
      const [supportsUpdate, setSupportsUpdate] = useState(null)
      const [supportsReword, setSupportsReword] = useState(null)
      const dialogResolver = useRef(null)
      const snapshotRef = useRef(null)
      const mountedRef = useRef(true)
      const rootRef = useRef(null)

      useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
      }, [])

      const tText = useCallback((key, params) => {
        let text = t(key)
        if (params) {
          for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }, [t])

      // -------------------------------------------------------- data loading

      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const caps = await call({ op: 'capabilities' })
            const ops = Array.isArray(caps?.ops) ? caps.ops : []
            if (alive) setSupportsSquash(ops.includes('squash'))
            if (alive) setSupportsUpdate(ops.includes('updateProject'))
            if (alive) setSupportsReword(ops.includes('reword'))
          } catch {
            // An older Host answers `未知操作`; history rewrite stays hidden.
            if (alive) setSupportsSquash(false)
            // Unknown stays null: the panel keeps trying and lets the Host answer.
          }
        })()
        return () => { alive = false }
      }, [])

      const loadRepos = useCallback(async () => {
        try {
          const extras = readJson(EXTRA_KEY, [])
          const data = await call({ op: 'discover', extra: extras })
          if (!mountedRef.current) return
          const usable = (data.repos ?? []).filter((entry) => entry.isRepo)
          setRepos(usable)
          const saved = globalThis.localStorage?.getItem(REPO_KEY)
          setRepoPath((current) => {
            if (current && usable.some((entry) => entry.path === current)) return current
            const preferred = usable.find((entry) => entry.path === saved) ?? usable[0]
            return preferred ? preferred.path : null
          })
          if (usable.length === 0) setRepoError(null)
        } catch (error) {
          if (mountedRef.current) setRepoError(error.message)
        }
      }, [])

      const load = useCallback(async (options = {}) => {
        if (!repoPath) return null
        setLoading(true)
        try {
          const data = await call({
            op: 'snapshot',
            repo: repoPath,
            ref: logRef ?? undefined,
            all: allRefs,
            max: MAX_COMMITS,
          })
          if (!mountedRef.current) return null
          snapshotRef.current = data
          setSnapshot(data)
          setRepoError(null)
          return data
        } catch (error) {
          if (mountedRef.current) setNotice({ kind: 'error', text: error.message })
          return null
        } finally {
          if (mountedRef.current) setLoading(false)
        }
      }, [repoPath, logRef, allRefs])

      useEffect(() => { void loadRepos() }, [loadRepos])
      useEffect(() => { void load() }, [load])

      useEffect(() => {
        const timer = globalThis.setInterval(() => {
          if (busy || dialog || globalThis.document?.visibilityState === 'hidden') return
          void load()
        }, 10_000)
        return () => globalThis.clearInterval(timer)
      }, [busy, dialog, load])

      useEffect(() => {
        const onFocus = () => { if (!busy) void load() }
        globalThis.addEventListener?.('focus', onFocus)
        return () => globalThis.removeEventListener?.('focus', onFocus)
      }, [busy, load])

      // ------------------------------------------------------------- actions

      const run = useCallback(async (payload, options = {}) => {
        setBusy(options.label ?? payload.op)
        try {
          const data = await call({ repo: repoPath, ...payload })
          if (options.refresh !== false) await load()
          if (data && typeof data.output === 'string' && data.output.trim() !== '') {
            setNotice({ kind: 'ok', text: data.output.trim().split('\n').slice(-4).join('\n') })
          } else if (options.silent !== true) {
            setNotice({ kind: 'ok', text: options.doneText ?? tText('toast.done') })
          }
          return data
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
          return null
        } finally {
          if (mountedRef.current) setBusy(null)
        }
      }, [load, repoPath, tText])

      const ask = useCallback((spec) => new Promise((resolve) => {
        dialogResolver.current = resolve
        setDialog({ id: `${Date.now()}-${Math.random()}`, ...spec })
      }), [])

      const closeDialog = useCallback((result) => {
        setDialog(null)
        const resolve = dialogResolver.current
        dialogResolver.current = null
        if (resolve) resolve(result)
      }, [])

      const askText = useCallback((spec) => ask({ kind: 'text', ...spec }), [ask])
      const askConfirm = useCallback((text, confirmText, danger = true) => ask({
        kind: 'confirm',
        title: confirmText ?? tText('action.confirm'),
        text,
        confirmText: confirmText ?? tText('action.confirm'),
        danger,
      }).then((value) => value !== null), [ask, tText])

      const showError = useCallback((error) => setNotice({ kind: 'error', text: error.message ?? String(error) }), [])

      // -------------------------------------------------------- update project

      /** Apply one remembered strategy, or ask the way IDEA's dialog does. */
      const runUpdate = useCallback(async (strategy, label) => {
        const data = await run({ op: 'updateProject', strategy }, { label, silent: true })
        if (!data || !mountedRef.current) return data
        if (data.updated === false) {
          setNotice({ kind: 'ok', text: tText('dialog.update.upToDate', { upstream: data.upstream }) })
        } else {
          setNotice({
            kind: 'ok',
            text: tText('dialog.update.done', {
              upstream: data.upstream,
              count: data.behind,
              branch: data.branch,
              verb: tText(`verb.${data.strategy}`),
            }),
          })
        }
        return data
      }, [run, tText])

      const resetToRemote = useCallback(async () => {
        const current = snapshotRef.current?.status
        const branch = current?.branch ?? ''
        const upstream = current?.upstream ?? branch
        const ok = await askConfirm(
          tText('dialog.update.resetConfirm', { branch, upstream }),
          tText('dialog.update.reset'),
        )
        if (!ok) return
        await runUpdate('reset', tText('dialog.update.reset'))
      }, [askConfirm, runUpdate, tText])

      const openUpdate = useCallback(async (forceDialog = false) => {
        if (!repoPath || busy) return
        if (supportsUpdate === false) {
          setNotice({ kind: 'error', text: t('action.updateRestart') })
          return
        }
        const current = snapshotRef.current?.status
        const remembered = globalThis.localStorage?.getItem(UPDATE_KEY)
        const known = remembered === 'merge' || remembered === 'rebase' || remembered === 'reset'
        if (known && !forceDialog) {
          await runUpdate(remembered, t('action.update'))
          return
        }
        const answer = await ask({
          kind: 'choice',
          title: tText('dialog.update.title'),
          text: current?.upstream
            ? tText('dialog.update.text', { branch: current.branch ?? '', upstream: current.upstream })
            : tText('dialog.update.textNoUpstream', { branch: current?.branch ?? '' }),
          value: known ? remembered : 'merge',
          options: [
            { value: 'merge', label: tText('dialog.update.merge') },
            { value: 'rebase', label: tText('dialog.update.rebase') },
          ],
          checkedLabel: tText('dialog.update.remember'),
          confirmText: t('action.update'),
          footExtra: { label: tText('dialog.update.reset') },
        })
        if (!answer) return
        if (answer.action === 'extra') {
          await resetToRemote()
          return
        }
        const chosen = answer.value === 'rebase' ? 'rebase' : 'merge'
        if (answer.checked === true) globalThis.localStorage?.setItem(UPDATE_KEY, chosen)
        else globalThis.localStorage?.removeItem(UPDATE_KEY)
        await runUpdate(chosen, t('action.update'))
      }, [ask, busy, repoPath, resetToRemote, runUpdate, supportsUpdate, t, tText])

      // IDEA binds Ctrl+T to "update project". Browsers reserve it for a new tab,
      // so the shortcut only fires while focus is inside this panel.
      useEffect(() => {
        const onKey = (event) => {
          if (dialog || menu || busy || !repoPath) return
          if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
          if (String(event.key ?? '').toLowerCase() !== 't') return
          const active = document.activeElement
          const inside = !active || active === document.body
            || (rootRef.current !== null && rootRef.current.contains(active))
          if (!inside) return
          event.preventDefault()
          void openUpdate(true)
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [busy, dialog, menu, openUpdate, repoPath])

      const status = snapshot?.status
      const branchTree = snapshot?.branches
      const commits = snapshot?.log?.commits ?? []
      const rows = useMemo(() => buildGraph(commits), [commits])
      // One graph column width for every row, so the sha/subject columns align.
      const graphWidth = useMemo(() => {
        let lanes = 1
        for (const row of rows) lanes = Math.max(lanes, row.width)
        return lanes * 12 + 6
      }, [rows])

      const visibleRows = useMemo(() => {
        const needle = filter.trim().toLowerCase()
        if (needle === '') return rows
        return rows.filter((row) => {
          const commit = row.commit
          return commit.subject.toLowerCase().includes(needle) ||
            commit.hash.toLowerCase().includes(needle) ||
            (commit.author ?? '').toLowerCase().includes(needle)
        })
      }, [rows, filter])

      // ------------------------------------------------------- selection work

      const loadCommit = useCallback(async (hash, focusTab) => {
        if (focusTab) setTab('detail')
        setDetail(null)
        try {
          const data = await call({ op: 'commit', repo: repoPath, sha: hash })
          if (mountedRef.current) setDetail(data.commit)
        } catch (error) {
          showError(error)
        }
        try {
          setDiffLoading(true)
          const data = await call({ op: 'diff', repo: repoPath, sha: hash })
          if (mountedRef.current) {
            setDiff({ title: `${shortHash(hash)} 提交差异`, text: data.diff, binary: data.binary === true })
          }
        } catch (error) {
          showError(error)
        } finally {
          if (mountedRef.current) setDiffLoading(false)
        }
      }, [repoPath, showError])

      /** Commit rows support plain, Shift-range and Cmd/Ctrl-toggle selection. */
      const selectCommit = useCallback((event, commit, index) => {
        const current = selection?.type === 'commit' ? selection : null
        const range = event?.shiftKey === true && current?.anchor
        if (range) {
          const anchorIndex = visibleRows.findIndex((row) => row.commit.hash === current.anchor)
          if (anchorIndex >= 0 && index >= 0) {
            const from = Math.min(anchorIndex, index)
            const to = Math.max(anchorIndex, index)
            const hashes = visibleRows.slice(from, to + 1).map((row) => row.commit.hash)
            setSelection({ type: 'commit', hash: commit.hash, hashes, anchor: current.anchor })
            void loadCommit(commit.hash, false)
            return
          }
        }
        if ((event?.metaKey === true || event?.ctrlKey === true) && current) {
          const hashes = current.hashes.includes(commit.hash)
            ? current.hashes.filter((hash) => hash !== commit.hash)
            : [...current.hashes, commit.hash]
          if (hashes.length === 0) {
            setSelection(null)
            setDetail(null)
            setDiff(null)
            return
          }
          setSelection({ type: 'commit', hash: commit.hash, hashes, anchor: commit.hash })
          void loadCommit(commit.hash, false)
          return
        }
        setSelection({ type: 'commit', hash: commit.hash, hashes: [commit.hash], anchor: commit.hash })
        void loadCommit(commit.hash, true)
      }, [visibleRows, selection, loadCommit])

      /** The remote the toolbar and branch actions should address. */
      const pushRemote = useMemo(() => {
        const upstream = snapshot?.status?.upstream
        if (typeof upstream === 'string' && upstream.includes('/')) return upstream.split('/')[0]
        return snapshot?.remotes?.[0]?.name ?? 'origin'
      }, [snapshot])

      const clearSelection = useCallback(() => {
        setSelection(null)
        setDetail(null)
        setDiff(null)
      }, [])

      /** Preview the range on the Host, then let the user edit the squashed message. */
      const startSquash = useCallback(async (hashes) => {
        let preview
        try {
          preview = await call({ op: 'squashPreview', repo: repoPath, shas: hashes })
        } catch (error) {
          showError(error)
          return
        }
        if (preview.dirty) {
          setNotice({ kind: 'error', text: tText('dialog.squash.dirty') })
          return
        }
        // Newer Hosts report the range's numstat; older ones are asked for the
        // plain diff so the net change is still shown before confirming.
        let stat = preview.stat ?? null
        if (!stat && preview.base) {
          try {
            const patch = await call({ op: 'diff', repo: repoPath, base: preview.base, head: preview.newest })
            stat = statFromPatch(patch.diff)
          } catch {
            stat = null
          }
        }
        const netEmpty = typeof preview.netEmpty === 'boolean'
          ? preview.netEmpty
          : (stat ? stat.files === 0 : false)
        const result = await ask({
          kind: 'text',
          multiline: true,
          title: tText('dialog.squash.title', { count: preview.commits.length }),
          label: tText('dialog.squash.message'),
          value: preview.defaultMessage,
          confirmText: 'Squash',
          extra: () => h('div', { className: 'dg-squash-list' }, [
            h('div', { key: 'hint' }, tText('dialog.squash.hint')),
            ...preview.commits.map((entry) => h('div', {
              key: entry.hash,
            }, `${shortHash(entry.hash)}  ${entry.subject}`)),
            !stat
              ? null
              : h('div', {
                key: 'stat',
                className: netEmpty ? 'dg-squash-empty' : 'dg-squash-stat',
              }, netEmpty
                ? tText('dialog.squash.netEmpty')
                : tText('dialog.squash.stat', {
                  files: stat.files,
                  add: stat.additions,
                  del: stat.deletions,
                })),
          ]),
        })
        if (!result) return
        const branchBefore = snapshot?.status?.branch ?? null
        // One reload is enough: the snapshot below decides whether a repair is needed.
        const data = await run(
          { op: 'squash', shas: hashes, message: result.value },
          { label: 'Squash Commits', refresh: false },
        )
        if (!data?.squash) return
        let after = await load()
        // A Host generation whose squash moved only HEAD leaves a detached HEAD
        // behind. Re-attach the branch and point it at the squashed commit, which
        // is exactly what the fixed engine does in one step.
        if (branchBefore && after && (after.status.detached || after.status.branch !== branchBefore)) {
          await run({ op: 'checkout', ref: branchBefore }, { refresh: false })
          await run({ op: 'reset', ref: data.squash.sha, mode: 'hard' }, { refresh: false })
          after = await load()
        }
        if (branchBefore && after && (after.status.detached || after.status.branch !== branchBefore)) {
          setNotice({
            kind: 'error',
            text: `Squash 已创建 ${shortHash(data.squash.sha)}，但 HEAD 未能回到分支 ${branchBefore}。`
              + `请手动执行：git checkout ${branchBefore} && git reset --hard ${data.squash.sha}`,
          })
          return
        }
        setNotice({
          kind: 'ok',
          text: data.squash.netEmpty
            ? tText('toast.squashedEmpty', {
              count: data.squash.count,
              sha: shortHash(data.squash.sha),
            })
            : tText('toast.squashed', {
              count: data.squash.count,
              sha: shortHash(data.squash.sha),
              previous: shortHash(data.squash.previousHead),
            }),
        })
        clearSelection()
      }, [ask, clearSelection, load, repoPath, run, showError, snapshot, tText])

      const openFileDiff = useCallback(async (spec) => {
        setSelection({ type: 'file', ...spec })
        setTab('diff')
        setDiffLoading(true)
        try {
          const payload = { op: 'diff', repo: repoPath, path: spec.path }
          if (spec.sha) payload.sha = spec.sha
          if (spec.staged) payload.staged = true
          // An untracked file has no `git diff`; the Host renders it against /dev/null.
          if (spec.untracked) payload.untracked = true
          const data = await call(payload)
          if (mountedRef.current) {
            setDiff({ title: spec.path, text: data.diff, binary: data.binary === true })
          }
        } catch (error) {
          showError(error)
        } finally {
          if (mountedRef.current) setDiffLoading(false)
        }
      }, [repoPath, showError])

      const refreshAfter = useCallback(async () => {
        const data = await load()
        setChecked({})
        return data
      }, [load])

      const doStage = useCallback(async (paths) => { await run({ op: 'stage', paths }); await refreshAfter() }, [run, refreshAfter])
      const doUnstage = useCallback(async (paths) => { await run({ op: 'unstage', paths }); await refreshAfter() }, [run, refreshAfter])
      const doDiscard = useCallback(async (paths, untracked) => {
        const ok = await askConfirm(tText('confirm.discard', { count: paths.length }), tText('changes.discard'))
        if (!ok) return
        await run({ op: 'discard', paths, untracked })
        await refreshAfter()
      }, [askConfirm, run, refreshAfter, tText])

      const doCommit = useCallback(async () => {
        if (!snapshot?.status) return
        const stagedCount = snapshot.status.files.filter((file) => file.staged).length
        if (stagedCount === 0 && !amend) {
          setNotice({ kind: 'error', text: '没有已暂存的变更' })
          return
        }
        const data = await run(
          { op: 'commitStaged', message, amend },
          { label: tText('action.commit') },
        )
        if (data) {
          setMessage('')
          setAmend(false)
          await refreshAfter()
        }
      }, [snapshot, amend, message, run, refreshAfter, tText])

      const doCheckout = useCallback(async (ref) => {
        const data = await run({ op: 'checkout', ref, label: tText('menu.checkout') }, { label: `checkout ${ref}` })
        if (data) {
          setLogRef(null)
          setSelection(null)
          setDetail(null)
          setDiff(null)
        }
      }, [run, tText])

      const newBranch = useCallback(async (startPoint, suggested) => {
        const result = await askText({
          title: tText('dialog.newBranch.title'),
          label: tText('dialog.newBranch.name'),
          value: suggested ?? '',
          checked: true,
          checkedLabel: tText('dialog.newBranch.checkout'),
        })
        if (!result || !result.value.trim()) return
        await run({
          op: 'createBranch',
          name: result.value.trim(),
          startPoint: startPoint ?? undefined,
          checkout: result.checked !== false,
        })
      }, [askText, run, tText])

      // ----------------------------------------------------------------- menu

      const openMenu = useCallback((event, items) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY, items })
      }, [])

      const branchMenu = useCallback((event, branch, kind) => {
        const isRemote = kind === 'remote'
        const items = []
        if (!isRemote) {
          items.push({ label: tText('menu.checkout'), disabled: branch.current, onSelect: () => void doCheckout(branch.name) })
          items.push({ label: tText('menu.newBranchHere'), onSelect: () => void newBranch(branch.name, '') })
        } else {
          const local = branch.name.split('/').slice(1).join('/')
          items.push({ label: tText('menu.checkout'), onSelect: () => void doCheckout(branch.name) })
          items.push({ label: tText('menu.newBranchHere'), onSelect: () => void newBranch(branch.name, local) })
        }
        items.push({ separator: true })
        items.push({
          label: tText('menu.mergeInto'),
          disabled: branch.current,
          onSelect: () => void run({ op: 'merge', ref: branch.name }, { label: tText('menu.mergeInto') }),
        })
        items.push({
          label: tText('menu.rebaseOnto'),
          disabled: branch.current,
          onSelect: () => void run({ op: 'rebase', ref: branch.name }, { label: tText('menu.rebaseOnto') }),
        })
        items.push({ separator: true })
        items.push({ label: tText('menu.copyName'), onSelect: () => copyText(branch.name) })
        if (!isRemote) {
          items.push({
            label: tText('menu.push'),
            onSelect: () => void run({
              op: 'push',
              remote: branch.upstream ? branch.upstream.split('/')[0] : pushRemote,
              branch: branch.name,
              setUpstream: !branch.upstream,
            }, { label: tText('menu.push') }),
          })
          items.push({ label: tText('menu.rename'), onSelect: () => void (async () => {
            const result = await askText({ title: tText('dialog.rename.title'), label: tText('dialog.rename.name'), value: branch.name })
            if (result && result.value.trim()) await run({ op: 'renameBranch', from: branch.name, to: result.value.trim() })
          })() })
          items.push({ label: tText('menu.tag'), onSelect: () => void createTag(branch.name) })
          items.push({
            label: tText('menu.delete'),
            danger: true,
            onSelect: () => void (async () => {
              const force = await askConfirm(tText('confirm.deleteBranch', { name: branch.name }), tText('menu.delete'))
              if (!force) return
              await run({ op: 'deleteBranch', name: branch.name, force: true })
            })(),
          })
        } else {
          const remote = branch.name.split('/')[0]
          const name = branch.name.split('/').slice(1).join('/')
          items.push({
            label: tText('menu.deleteRemote'),
            danger: true,
            onSelect: () => void (async () => {
              const ok = await askConfirm(tText('confirm.deleteRemoteBranch', { name: branch.name }), tText('menu.deleteRemote'))
              if (!ok) return
              await run({ op: 'deleteRemoteBranch', remote, branch: name })
            })(),
          })
        }
        openMenu(event, items)
      }, [askConfirm, askText, doCheckout, newBranch, openMenu, run, tText])

      const createTag = useCallback(async (ref) => {
        const name = await askText({ title: tText('dialog.tag.title'), label: tText('dialog.tag.name'), value: '' })
        if (!name || !name.value.trim()) return
        const messageResult = await askText({ title: tText('dialog.tag.title'), label: tText('dialog.tag.message'), value: '' })
        await run({ op: 'createTag', name: name.value.trim(), ref: ref ?? undefined, message: messageResult?.value ?? '' })
      }, [askText, run, tText])

      /** IDEA's "Edit Commit Message": only local commits can be rewritten. */
      const editMessage = useCallback(async (commit) => {
        if (!repoPath || busy) return
        let detail
        setBusy(t('dialog.reword.title'))
        try {
          const data = await call({ op: 'commit', repo: repoPath, sha: commit.hash })
          detail = data.commit
        } catch (error) {
          showError(error)
          return
        } finally {
          if (mountedRef.current) setBusy(null)
        }
        // The whole message, not just the subject: reword must not silently drop a body.
        const initial = [detail?.subject, detail?.body]
          .map((part) => (typeof part === 'string' ? part.replace(/\s+$/, '') : ''))
          .filter((part) => part !== '')
          .join('\n\n')
        const answer = await ask({
          kind: 'text',
          multiline: true,
          title: t('dialog.reword.title'),
          text: tText('dialog.reword.text', { sha: shortHash(commit.hash), author: commit.author }),
          value: initial,
          confirmText: t('dialog.reword.confirm'),
        })
        if (answer === null) return
        // A `text` dialog resolves to `{ value, checked }`, so reading the whole
        // answer would send the literal string "[object Object]" to git.
        const message = String(answer?.value ?? '')
        if (message.trim() === '') {
          setNotice({ kind: 'error', text: t('dialog.reword.empty') })
          return
        }
        setBusy(t('dialog.reword.title'))
        try {
          const data = await call({ op: 'reword', repo: repoPath, sha: commit.hash, message })
          await load()
          if (mountedRef.current) {
            if (data?.changed === false) {
              setNotice({ kind: 'ok', text: t('dialog.reword.unchanged') })
            } else {
              setNotice({ kind: 'ok', text: tText('dialog.reword.done', { sha: shortHash(commit.hash) }) })
              // Every later commit got a new hash: keep no stale selection behind.
              setSelection(null)
              setDetail(null)
            }
          }
        } catch (error) {
          showError(error)
        } finally {
          if (mountedRef.current) setBusy(null)
        }
      }, [ask, busy, call, load, repoPath, showError, t, tText])

      const commitMenu = useCallback((event, commit) => {
        const current = selection?.type === 'commit' && (selection.hashes ?? []).includes(commit.hash)
          ? selection
          : null
        const hashes = current ? current.hashes : [commit.hash]
        const multi = hashes.length > 1
        const items = []
        if (multi) {
          // Range actions first, exactly like the IDE tool window.
          items.push({
            label: supportsSquash ? tText('menu.squashCount', { count: hashes.length }) : tText('menu.squash'),
            disabled: !supportsSquash,
            onSelect: () => void startSquash(hashes),
          })
          items.push({ label: tText('menu.copyHashes', { count: hashes.length }), onSelect: () => copyText(hashes.join('\n')) })
          items.push({ label: tText('menu.clearSelection'), onSelect: clearSelection })
          items.push({ separator: true })
        }
        items.push(
          { label: tText('menu.detachAt'), disabled: multi, onSelect: () => void doCheckout(commit.hash) },
          { label: tText('menu.newBranchHere'), disabled: multi, onSelect: () => void newBranch(commit.hash, '') },
          { label: tText('menu.tag'), disabled: multi, onSelect: () => void createTag(commit.hash) },
          { separator: true },
          { label: tText('menu.cherryPick'), disabled: multi, onSelect: () => void run({ op: 'cherryPick', sha: commit.hash }, { label: tText('menu.cherryPick') }) },
          { label: tText('menu.revert'), disabled: multi, onSelect: () => void run({ op: 'revert', sha: commit.hash }, { label: tText('menu.revert') }) },
          {
            label: t('menu.editMessage'),
            disabled: multi || commit.pushed === true || supportsReword === false,
            hint: commit.pushed === true
              ? t('menu.editMessageHint')
              : (supportsReword === false ? t('menu.editMessageRestart') : undefined),
            onSelect: () => void editMessage(commit),
          },
          { separator: true },
          { label: tText('menu.resetSoft'), disabled: multi, onSelect: () => void run({ op: 'reset', ref: commit.hash, mode: 'soft' }) },
          { label: tText('menu.resetMixed'), disabled: multi, onSelect: () => void run({ op: 'reset', ref: commit.hash, mode: 'mixed' }) },
          {
            label: tText('menu.resetHard'),
            danger: true,
            disabled: multi,
            onSelect: () => void (async () => {
              const ok = await askConfirm(tText('confirm.resetHard', { ref: shortHash(commit.hash) }), tText('menu.resetHard'))
              if (!ok) return
              await run({ op: 'reset', ref: commit.hash, mode: 'hard' })
            })(),
          },
          { separator: true },
          { label: tText('menu.copyHash'), onSelect: () => copyText(commit.hash) },
          { label: tText('menu.copyName'), onSelect: () => copyText(commit.subject) },
        )
        openMenu(event, items)
      }, [askConfirm, clearSelection, createTag, doCheckout, editMessage, newBranch, openMenu, run, selection, startSquash, supportsReword, supportsSquash, t, tText])

      const stashMenu = useCallback((event, stash) => {
        openMenu(event, [
          { label: tText('menu.stashApply'), onSelect: () => void run({ op: 'stashApply', index: stash.index }) },
          { label: tText('menu.stashPop'), onSelect: () => void run({ op: 'stashPop', index: stash.index }) },
          { label: tText('menu.stashDrop'), danger: true, onSelect: () => void run({ op: 'stashDrop', index: stash.index }) },
        ])
      }, [openMenu, run, tText])

      // ------------------------------------------------------------- rendering

      const staged = (status?.files ?? []).filter((file) => file.staged)
      // A partially staged file appears in both groups, like the IDE tool window.
      const unstaged = (status?.files ?? []).filter((file) => file.unstaged && !file.untracked)
      const untracked = (status?.files ?? []).filter((file) => file.untracked)

      const toggleCheck = (path) => setChecked((current) => ({ ...current, [path]: current[path] !== true }))
      const checkedPaths = Object.keys(checked).filter((path) => checked[path] === true)

      // ---------------------------------------------------------- toolbar bits

      const toolbar = h('div', { className: 'dg-toolbar' }, [
        h('span', { className: 'dg-title', key: 'title' }, t('panel.title')),
        h('select', {
          key: 'repo',
          className: 'dg-select',
          value: repoPath ?? '',
          onChange: (event) => {
            const value = event.target.value
            if (value === '__add__') {
              void (async () => {
                const result = await askText({ title: tText('dialog.repo.title'), label: tText('dialog.repo.path'), value: '' })
                if (!result || !result.value.trim()) return
                const path = result.value.trim()
                const extras = readJson(EXTRA_KEY, [])
                if (!extras.includes(path)) writeJson(EXTRA_KEY, [...extras, path])
                setRepoPath(path)
                globalThis.localStorage?.setItem(REPO_KEY, path)
                await loadRepos()
              })()
              return
            }
            if (value === '__init__') {
              void (async () => {
                const result = await askText({ title: tText('action.initRepo'), label: tText('dialog.repo.path'), value: repoPath ?? '' })
                if (!result || !result.value.trim()) return
                const data = await run({ op: 'init', path: result.value.trim() }, { refresh: false })
                if (data) {
                  const extras = readJson(EXTRA_KEY, [])
                  if (!extras.includes(data.path)) writeJson(EXTRA_KEY, [...extras, data.path])
                  setRepoPath(data.path)
                  await loadRepos()
                  await load()
                }
              })()
              return
            }
            setRepoPath(value || null)
            globalThis.localStorage?.setItem(REPO_KEY, value)
            setSelection(null)
            setDetail(null)
            setDiff(null)
          },
        }, [
          ...repos.map((repo) => h('option', { key: repo.path, value: repo.path }, `${repo.title || repo.name} — ${repo.branch ?? 'detached'}`)),
          h('option', { key: '__add__', value: '__add__' }, `＋ ${t('action.addRepo')}…`),
          h('option', { key: '__init__', value: '__init__' }, `＋ ${t('action.initRepo')}…`),
        ]),
        h(Button, { key: 'refresh', small: true, ghost: true, title: t('action.refresh'), onClick: () => void load(), children: t('action.refresh') }),
        h(Button, { key: 'fetch', small: true, ghost: true, disabled: !repoPath || Boolean(busy), onClick: () => void run({ op: 'fetch' }, { label: t('action.fetch') }), children: t('action.fetch') }),
        h(Button, {
          key: 'update',
          small: true,
          ghost: true,
          disabled: !repoPath || Boolean(busy),
          title: supportsUpdate === false
            ? `${t('action.updateTitle')} · ${t('action.updateRestart')}`
            : t('action.updateTitle'),
          onClick: () => void openUpdate(false),
          children: status?.behind ? `${t('action.update')} ↓${status.behind}` : t('action.update'),
        }),
        h(Button, {
          key: 'push',
          small: true,
          ghost: true,
          disabled: !repoPath || Boolean(busy),
          title: t('action.push'),
          onClick: () => void run({
            op: 'push',
            remote: pushRemote,
            setUpstream: !status?.upstream,
            branch: status?.branch ?? undefined,
          }, { label: t('action.push') }),
          children: t('action.push'),
        }),
        h(Button, { key: 'branch', small: true, ghost: true, disabled: !repoPath, onClick: () => void newBranch(undefined, ''), children: t('action.newBranch') }),
        h('div', { className: 'dg-spacer', key: 'spacer' }),
        busy ? h('span', { className: 'dg-hint', key: 'busy', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          h('span', { className: 'dg-spin' }), String(busy)) : null,
        h(Button, {
          key: 'more',
          small: true,
          ghost: true,
          disabled: !repoPath,
          children: t('action.more'),
          onClick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({
              x: rect.left,
              y: rect.bottom + 4,
              items: [
                { label: t('menu.stashPush'), onSelect: () => void (async () => {
                  const result = await askText({
                    title: tText('dialog.stash.title'),
                    label: tText('dialog.stash.message'),
                    value: '',
                    checked: true,
                    checkedLabel: tText('dialog.stash.untracked'),
                  })
                  if (!result) return
                  await run({ op: 'stashPush', message: result.value, includeUntracked: result.checked === true })
                })() },
                { label: t('action.stashPop'), onSelect: () => void run({ op: 'stashPop' }) },
                { separator: true },
                { label: t('action.update'), onSelect: () => void openUpdate(true) },
                { label: t('action.pull'), onSelect: () => void run({ op: 'pull' }, { label: t('action.pull') }) },
                { separator: true },
                { label: t('menu.fetchPrune'), onSelect: () => void run({ op: 'fetch', tags: true }, { label: t('menu.fetchPrune') }) },
                { label: t('menu.merge'), onSelect: () => void (async () => {
                  const result = await askText({
                    title: tText('dialog.merge.title'),
                    label: tText('dialog.merge.ref'),
                    value: '',
                    checked: false,
                    checkedLabel: tText('dialog.merge.noFf'),
                  })
                  if (!result || !result.value.trim()) return
                  await run({ op: 'merge', ref: result.value.trim(), noFf: result.checked === true })
                })() },
                { label: t('menu.rebase'), onSelect: () => void (async () => {
                  const result = await askText({ title: tText('dialog.rebase.title'), label: tText('dialog.rebase.ref'), value: '' })
                  if (!result || !result.value.trim()) return
                  await run({ op: 'rebase', ref: result.value.trim() })
                })() },
                { separator: true },
                { label: t('menu.mergeAbort'), onSelect: () => void run({ op: 'mergeAbort' }) },
                { label: t('menu.rebaseAbort'), onSelect: () => void run({ op: 'rebaseAbort' }) },
                { separator: true },
                { label: t('action.identity'), onSelect: () => void (async () => {
                  const current = snapshot?.identity ?? { userName: '', userEmail: '' }
                  const name = await askText({ title: tText('dialog.identity.title'), label: tText('dialog.identity.name'), value: current.userName })
                  if (!name) return
                  const email = await askText({ title: tText('dialog.identity.title'), label: tText('dialog.identity.email'), value: current.userEmail })
                  if (!email) return
                  await run({ op: 'identity', userName: name.value, userEmail: email.value }, { refresh: false })
                  await load()
                })() },
                { label: t('action.remotes'), onSelect: () => void (async () => {
                  const result = await askText({ title: tText('dialog.remote.title'), label: tText('dialog.remote.url'), value: '' })
                  if (!result || !result.value.trim()) return
                  const remoteName = await askText({ title: tText('dialog.remote.title'), label: tText('dialog.remote.name'), value: 'origin' })
                  if (!remoteName || !remoteName.value.trim()) return
                  await run({ op: 'addRemote', name: remoteName.value.trim(), url: result.value.trim() })
                })() },
              ],
            })
          },
        }),
      ])

      // ------------------------------------------------------------ tree parts

      function treeRow(key, label, options = {}) {
        const depth = options.depth ?? 0
        return h('div', {
          key,
          className: `dg-row${options.active ? ' dg-active' : ''}${options.current ? ' dg-current' : ''}${options.folder ? ' dg-folder' : ''}`,
          style: depth > 0 ? { paddingLeft: `${12 + depth * 14}px` } : undefined,
          title: options.title ?? label,
          onClick: options.onClick,
          onDoubleClick: options.onDoubleClick,
          onContextMenu: options.onContextMenu,
        }, [
          options.caret !== undefined
            ? h('span', {
              key: 'caret',
              className: `dg-caret dg-clickable${options.caret ? ' dg-open' : ''}`,
              onClick: (event) => { event.stopPropagation(); options.onToggle?.() },
            }, h(CaretGlyph))
            : h('span', { key: 'caret', className: 'dg-caret' }),
          options.icon ? h('span', { key: 'icon', className: 'dg-glyph' }, options.icon) : null,
          h('span', { key: 'name', className: 'dg-name' }, label),
          ...(options.badges ?? []),
          options.trailing ? h('span', { key: 'trailing', className: 'dg-tag' }, options.trailing) : null,
        ])
      }

      /**
       * Render one branch/tag subtree: folders first (alphabetical), then leaves,
       * with the current branch's own subtree ranked to the top, IDEA-style.
       */
      function renderTree(node, depth, keyPrefix, leafRow) {
        const items = []
        for (const [name, child] of node.folders) {
          items.push({ kind: 'folder', name, child, key: `${keyPrefix}/${name}`, rank: subtreeHasCurrent(child) ? 1 : 2 })
        }
        for (const leaf of node.leaves) {
          items.push({ kind: 'leaf', name: leaf.label, leaf, rank: leaf.entry.current === true ? 0 : 3 })
        }
        items.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
        const rows = []
        for (const item of items) {
          if (item.kind === 'folder') {
            const open = collapsed[item.key] !== true
            rows.push(treeRow(item.key, item.name, {
              depth,
              folder: true,
              caret: open,
              icon: h(FolderGlyph, { open }),
              trailing: item.child.count,
              title: `${item.name}/`,
              onToggle: () => setCollapsed((current) => ({ ...current, [item.key]: current[item.key] !== true })),
              onClick: () => setCollapsed((current) => ({ ...current, [item.key]: current[item.key] !== true })),
            }))
            if (open) rows.push(...renderTree(item.child, depth + 1, item.key, leafRow))
          } else {
            rows.push(leafRow(`leaf:${item.leaf.entry.name ?? item.name}`, item.leaf, depth))
          }
        }
        return rows
      }

      /** One local branch leaf. */
      function localBranchRow(key, leaf, depth) {
        const branch = leaf.entry
        return treeRow(key, leaf.label, {
          depth,
          current: branch.current,
          active: selection?.type === 'branch' && selection.name === branch.name,
          title: branch.name,
          icon: h(BranchGlyph),
          onClick: () => { setLogRef(branch.name); setSelection({ type: 'branch', name: branch.name }) },
          onDoubleClick: () => void doCheckout(branch.name),
          onContextMenu: (event) => branchMenu(event, branch, 'local'),
          badges: [
            branch.upstream ? h('span', { key: 'u', className: 'dg-badge' }, `→ ${branch.upstream}`) : null,
            branch.ahead ? h('span', { key: 'a', className: 'dg-badge' }, `↑${branch.ahead}`) : null,
            branch.behind ? h('span', { key: 'b', className: 'dg-badge' }, `↓${branch.behind}`) : null,
          ].filter(Boolean),
        })
      }

      /** One remote branch leaf inside its remote's subtree. */
      function remoteBranchRow(key, leaf, depth) {
        const branch = leaf.entry
        return treeRow(key, leaf.label, {
          depth,
          active: selection?.type === 'branch' && selection.name === branch.name,
          title: branch.name,
          icon: h(BranchGlyph),
          onClick: () => { setLogRef(branch.name); setSelection({ type: 'branch', name: branch.name }) },
          onDoubleClick: () => void doCheckout(branch.name),
          onContextMenu: (event) => branchMenu(event, branch, 'remote'),
          badges: [
            branch.ahead ? h('span', { key: 'a', className: 'dg-badge' }, `↑${branch.ahead}`) : null,
            branch.behind ? h('span', { key: 'b', className: 'dg-badge' }, `↓${branch.behind}`) : null,
          ].filter(Boolean),
        })
      }

      /** One tag leaf. */
      function tagRow(key, leaf, depth) {
        const tag = leaf.entry
        return treeRow(key, leaf.label, {
          depth,
          title: tag.name,
          icon: h(TagGlyph),
          onClick: () => { setLogRef(tag.name); setSelection({ type: 'branch', name: tag.name }) },
          onContextMenu: (event) => openMenu(event, [
            { label: t('menu.checkout'), onSelect: () => void doCheckout(tag.name) },
            { label: t('menu.push'), onSelect: () => void run({ op: 'pushTag', name: tag.name }) },
            { label: t('menu.delete'), danger: true, onSelect: () => void run({ op: 'deleteTag', name: tag.name }) },
          ]),
        })
      }

      const localTree = buildBranchTree(branchTree?.local ?? [])
      const tagTree = buildBranchTree(branchTree?.tags ?? [])

      const tree = h('aside', { className: 'dg-side' }, [
        h('div', { className: 'dg-section', key: 'h-local' }, [
          h('span', { key: 'c', className: `dg-caret dg-clickable${collapsed.local ? '' : ' dg-open'}`, onClick: () => setCollapsed((c) => ({ ...c, local: !c.local })) }, h(CaretGlyph)),
          t('tree.local'),
        ]),
        ...(collapsed.local
          ? []
          : (localTree.count > 0
            ? renderTree(localTree, 0, 'local', localBranchRow)
            : [h('div', { className: 'dg-hint dg-indent', key: 'e' }, t('tree.empty'))])),

        h('div', { className: 'dg-section', key: 'h-remote' }, [
          h('span', { key: 'c', className: `dg-caret dg-clickable${collapsed.remote ? '' : ' dg-open'}`, onClick: () => setCollapsed((c) => ({ ...c, remote: !c.remote })) }, h(CaretGlyph)),
          t('tree.remote'),
        ]),
        ...(collapsed.remote
          ? []
          : ((branchTree?.remotes?.length ?? 0) > 0
            ? branchTree.remotes.flatMap((group) => {
              const groupKey = `r-${group.remote}`
              const open = collapsed[groupKey] !== true
              return [
                treeRow(groupKey, group.remote, {
                  caret: open,
                  folder: true,
                  icon: h(RepoGlyph),
                  trailing: group.branches.length,
                  onToggle: () => setCollapsed((c) => ({ ...c, [groupKey]: c[groupKey] !== true })),
                  onClick: () => setCollapsed((c) => ({ ...c, [groupKey]: c[groupKey] !== true })),
                }),
                ...(open
                  // A symbolic refs/remotes/<remote>/HEAD can shorten to the bare
                  // remote name; never render it as a branch.
                  ? renderTree(
                    buildBranchTree(group.branches.filter((branch) => branch.name !== group.remote), group.remote),
                    1,
                    groupKey,
                    remoteBranchRow,
                  )
                  : []),
              ]
            })
            : [h('div', { className: 'dg-hint dg-indent', key: 'e' }, t('tree.empty'))])),

        h('div', { className: 'dg-section', key: 'h-tags' }, [
          h('span', { key: 'c', className: `dg-caret dg-clickable${collapsed.tags ? '' : ' dg-open'}`, onClick: () => setCollapsed((c) => ({ ...c, tags: !c.tags })) }, h(CaretGlyph)),
          `${t('tree.tags')}（${branchTree?.tags?.length ?? 0}）`,
        ]),
        ...(collapsed.tags ? [] : renderTree(tagTree, 0, 'tags', tagRow)),

        h('div', { className: 'dg-section', key: 'h-stash' }, [
          h('span', { key: 'c', className: `dg-caret dg-clickable${collapsed.stash ? '' : ' dg-open'}`, onClick: () => setCollapsed((c) => ({ ...c, stash: !c.stash })) }, h(CaretGlyph)),
          `${t('tree.stashes')}（${snapshot?.stashes?.length ?? 0}）`,
        ]),
        ...(collapsed.stash ? [] : (snapshot?.stashes ?? []).map((stash) => treeRow(`s-${stash.index}`, stash.subject || stash.selector, {
          depth: 1,
          icon: h(StackGlyph),
          onDoubleClick: () => void run({ op: 'stashPop', index: stash.index }),
          onContextMenu: (event) => stashMenu(event, stash),
          title: stash.subject,
        }))),

        h('div', { className: 'dg-section', key: 'h-remotes' }, [
          h('span', { key: 'c', className: `dg-caret dg-clickable${collapsed.remotes ? '' : ' dg-open'}`, onClick: () => setCollapsed((c) => ({ ...c, remotes: !c.remotes })) }, h(CaretGlyph)),
          t('tree.remotes'),
        ]),
        ...(collapsed.remotes ? [] : (snapshot?.remotes ?? []).map((remote) => treeRow(`rm-${remote.name}`, remote.name, {
          depth: 1,
          icon: h(RepoGlyph),
          title: remote.fetchUrl,
          trailing: remote.fetchUrl.replace(/^.*[/:]([^/:]+)$/, '$1'),
          onContextMenu: (event) => openMenu(event, [
            { label: t('action.fetch'), onSelect: () => void run({ op: 'fetch', remote: remote.name }) },
            { label: t('action.pull'), onSelect: () => void run({ op: 'pull', remote: remote.name }) },
            { label: t('action.push'), onSelect: () => void run({ op: 'push', remote: remote.name }) },
            { separator: true },
            { label: t('menu.delete'), danger: true, onSelect: () => void run({ op: 'removeRemote', name: remote.name }) },
          ]),
        }))),
      ])

      // ------------------------------------------------------------ commit log

      const logPane = h('div', { className: 'dg-log' }, visibleRows.length === 0
        ? h('div', { className: 'dg-empty' }, filter ? t('search.empty') : t('tree.empty'))
        : visibleRows.map((row, index) => {
          const commit = row.commit
          const picked = selection?.type === 'commit' && (selection.hashes ?? [selection.hash]).includes(commit.hash)
          const primary = picked && selection.hash === commit.hash && (selection.hashes ?? []).length > 1
          return h('div', {
            key: commit.hash,
            className: `dg-commit${picked ? ' dg-active' : ''}${primary ? ' dg-primary' : ''}`,
            onClick: (event) => selectCommit(event, commit, index),
            onContextMenu: (event) => commitMenu(event, commit),
            title: `${commit.hash}\n${commit.subject}`,
          }, [
            h(GraphCell, { key: 'g', row, width: graphWidth, selected: picked }),
            h('span', { key: 'sha', className: 'dg-sha' }, shortHash(commit.hash)),
            ...(commit.refs ?? []).flatMap((ref, index) => {
              // `%D` writes `HEAD -> branch`; show the pointer and the branch as
              // two readable chips instead of one blank-looking pill.
              const clean = ref.replace('tag: ', '')
              const chips = []
              if (clean.startsWith('HEAD -> ')) {
                chips.push({ key: `r${index}h`, className: 'dg-badge dg-head', text: 'HEAD' })
                chips.push({ key: `r${index}b`, className: 'dg-badge', text: clean.slice('HEAD -> '.length) })
              } else if (clean === 'HEAD') {
                chips.push({ key: `r${index}`, className: 'dg-badge dg-head', text: 'HEAD' })
              } else {
                chips.push({ key: `r${index}`, className: `dg-badge${ref.includes('tag:') ? ' dg-tagb' : ''}`, text: clean })
              }
              return chips.map((chip) => h('span', { key: chip.key, className: chip.className }, chip.text))
            }).slice(0, 6),
            h('span', { key: 'subject', className: 'dg-subj' }, commit.subject),
            h('span', { key: 'author', className: 'dg-meta' }, commit.author),
            h('span', { key: 'date', className: 'dg-meta', style: { maxWidth: '96px' } }, formatDate(commit.commitDate)),
          ])
        }))

      // ------------------------------------------------------- changes / detail

      function fileRow(file, mode) {
        const active = selection?.type === 'file' && selection.path === file.path && selection.staged === (mode === 'staged')
        return h('div', {
          key: `${mode}:${file.path}`,
          className: `dg-file${active ? ' dg-active' : ''}`,
          onClick: () => void openFileDiff({
            path: file.path,
            staged: mode === 'staged',
            untracked: file.untracked === true,
          }),
          onContextMenu: (event) => openMenu(event, [
            mode === 'staged'
              ? { label: t('changes.unstage'), onSelect: () => void doUnstage([file.path]) }
              : { label: t('changes.stage'), onSelect: () => void doStage([file.path]) },
            {
              label: t('changes.viewDiff'),
              onSelect: () => void openFileDiff({
                path: file.path,
                staged: mode === 'staged',
                untracked: file.untracked === true,
              }),
            },
            { separator: true },
            { label: t('changes.discard'), danger: true, onSelect: () => void doDiscard([file.path], file.untracked) },
          ]),
        }, [
          h('input', {
            key: 'cb',
            type: 'checkbox',
            checked: checked[file.path] === true,
            onClick: (event) => event.stopPropagation(),
            onChange: () => toggleCheck(file.path),
          }),
          h('span', { key: 'letter', className: 'dg-badge' }, statusLetter(file)),
          h('span', { key: 'path', className: 'dg-fp' }, file.origPath ? `${file.origPath} → ${file.path}` : file.path),
        ])
      }

      function group(title, files, mode, actions) {
        return h('div', { key: `g-${title}`, style: { marginBottom: '10px' } }, [
          h('div', {
            key: 'head',
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', color: 'var(--dg-dim)', fontSize: '12px' },
          }, [
            h('span', { key: 't', style: { fontWeight: 600 } }, `${title}（${files.length}）`),
            h('div', { key: 's', className: 'dg-spacer' }),
            ...(actions ?? []),
          ]),
          files.length === 0
            ? h('div', { key: 'empty', className: 'dg-hint', style: { padding: '0 8px' } }, t('tree.empty'))
            : h('div', { key: 'list', className: 'dg-filelist' }, files.map((file) => fileRow(file, mode))),
        ])
      }

      const changesTab = h('div', null, [
        h('div', { key: 'msg', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' } }, [
          h('textarea', {
            key: 'ta',
            className: 'dg-textarea',
            placeholder: t('changes.messagePlaceholder'),
            value: message,
            onChange: (event) => setMessage(event.target.value),
            onKeyDown: (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void doCommit()
              }
            },
          }),
          h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
            h('label', { key: 'amend', className: 'dg-label', style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
              h('input', { key: 'i', type: 'checkbox', checked: amend, onChange: (event) => setAmend(event.target.checked) }),
              t('changes.amend'),
            ]),
            h('div', { key: 'sp', className: 'dg-spacer' }),
            h(Button, {
              key: 'commit',
              primary: true,
              disabled: Boolean(busy) || (staged.length === 0 && !amend),
              onClick: () => void doCommit(),
              children: t('changes.commit'),
            }),
          ]),
        ]),
        group(t('changes.staged'), staged, 'staged', [
          h(Button, {
            key: 'stage-all',
            small: true,
            ghost: true,
            disabled: Boolean(busy),
            onClick: () => void (async () => { await run({ op: 'stageAll' }); await refreshAfter() })(),
            children: t('changes.stageAll'),
          }),
          h(Button, {
            key: 'unstage-all',
            small: true,
            ghost: true,
            disabled: Boolean(busy) || staged.length === 0,
            onClick: () => void (async () => { await run({ op: 'unstageAll' }); await refreshAfter() })(),
            children: t('changes.unstageAll'),
          }),
        ]),
        group(t('changes.unstaged'), unstaged, 'unstaged', [
          h(Button, {
            key: 'discard',
            small: true,
            ghost: true,
            danger: true,
            disabled: Boolean(busy) || unstaged.length === 0,
            onClick: () => void doDiscard(unstaged.map((file) => file.path), false),
            children: t('changes.discardAll'),
          }),
        ]),
        group(t('changes.untracked'), untracked, 'untracked', []),
        checkedPaths.length > 0
          ? h('div', { key: 'bulk', style: { display: 'flex', gap: '8px', padding: '6px', borderTop: '1px solid var(--dg-border)' } }, [
            h(Button, {
              key: 'stage',
              small: true,
              onClick: () => void doStage(checkedPaths),
              children: `${t('changes.stage')} (${checkedPaths.length})`,
            }),
            h(Button, {
              key: 'unstage',
              small: true,
              onClick: () => void doUnstage(checkedPaths),
              children: `${t('changes.unstage')} (${checkedPaths.length})`,
            }),
          ])
          : null,
      ])

      const pickedHashes = selection?.type === 'commit' ? (selection.hashes ?? [selection.hash]) : []
      const selectionBanner = pickedHashes.length > 1
        ? h('div', { className: 'dg-selection', key: 'selection' }, [
          h('div', { key: 'count', className: 'dg-sel-title' }, tText('selection.count', { count: pickedHashes.length })),
          h('div', { key: 'hint', className: 'dg-hint' },
            supportsSquash ? t('selection.hint') : t('selection.squashUnavailable')),
        ])
        : null

      const detailTab = h('div', null, [
        selectionBanner,
        !detail
          ? h('div', { className: 'dg-empty' }, t('detail.none'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
          h('div', { key: 'subj', style: { fontWeight: 600, fontSize: '13.5px' } }, detail.subject),
          h('div', { key: 'meta', className: 'dg-hint' },
            `${detail.author} <${detail.email}>  ·  ${new Date(detail.commitDate).toLocaleString()}`),
          h('div', { key: 'sha', className: 'dg-hint', style: { fontFamily: 'var(--ds-font-family-code,monospace)' } },
            `${detail.hash}${(detail.parents ?? []).length ? `  ←  ${detail.parents.map(shortHash).join(' ')}` : ''}`),
          (detail.refs ?? []).length
            ? h('div', { key: 'refs', style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
              detail.refs.map((ref, index) => h('span', { key: index, className: 'dg-badge' }, ref)))
            : null,
          detail.body ? h('div', { key: 'body', className: 'dg-diff', style: { whiteSpace: 'pre-wrap' } }, detail.body) : null,
          h('div', { key: 'files-head', className: 'dg-label', style: { marginTop: '4px' } }, `${t('detail.files')}（${(detail.files ?? []).length}）`),
          h('div', { key: 'files', className: 'dg-filelist' }, (detail.files ?? []).map((file) => h('div', {
            key: file.path,
            className: `dg-file${selection?.type === 'file' && selection.path === file.path && selection.sha === detail.hash ? ' dg-active' : ''}`,
            onClick: () => void openFileDiff({ path: file.path, sha: detail.hash }),
          }, [
            h('span', { key: 'p', className: 'dg-fp' }, file.path),
            h('span', { key: 's', className: 'dg-lst' }, file.binary
              ? 'bin'
              : h(React.Fragment, null, [
                h('span', { key: 'a', className: 'dg-stat-add' }, `+${file.additions ?? 0}`),
                ' ',
                h('span', { key: 'd', className: 'dg-stat-del' }, `-${file.deletions ?? 0}`),
              ])),
          ]))),
        ]),
      ])

      const diffTab = h('div', null, diffLoading
        ? h('div', { className: 'dg-empty' }, t('status.loading'))
        : !diff
          ? h('div', { className: 'dg-empty' }, t('changes.noneSelected'))
          : diff.text
            ? h('div', { className: 'dg-diff' }, parseDiff(diff.text).map((line, index) => h('div', {
              key: index,
              className: line.type === 'add' ? 'dg-l-add' : line.type === 'del' ? 'dg-l-del' : line.type === 'hunk' ? 'dg-l-hunk' : line.type === 'meta' ? 'dg-l-meta' : undefined,
            }, line.text === '' ? ' ' : line.text)))
            : h('div', { className: 'dg-empty' }, diff.binary ? t('diff.binary') : t('diff.empty')))

      const detailTabs = h('div', { className: 'dg-tabs' }, [
        ...[['changes', t('tab.changes')], ['detail', t('tab.detail')], ['diff', t('tab.diff')]].map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: `dg-tab${tab === id ? ' dg-on' : ''}`,
          onClick: () => setTab(id),
        }, id === 'changes' ? `${label}（${(status?.files ?? []).length}）` : label)),
        h('div', { key: 'sp', className: 'dg-spacer' }),
        diff?.title ? h('span', { key: 'title', className: 'dg-hint' }, diff.title) : null,
      ])

      const detailBody = tab === 'changes' ? changesTab : tab === 'detail' ? detailTab : diffTab

      // ------------------------------------------------------------ empty pane

      if (!repoPath) {
        return h('div', { className: 'dg-root', ref: rootRef }, [
          h('style', { key: 'css' }, CSS),
          toolbar,
          h('div', { className: 'dg-empty', key: 'empty' }, [
            h('div', { key: 't', style: { fontWeight: 600, marginBottom: '6px' } }, t('repo.none')),
            h('div', { key: 'h' }, t('repo.noneHint')),
            repoError ? h('div', { key: 'e', style: { marginTop: '10px', color: 'var(--dg-danger)' } }, repoError) : null,
          ]),
        ])
      }

      // --------------------------------------------------------------- panel

      return h('div', { className: 'dg-root', ref: rootRef }, [
        h('style', { key: 'css' }, CSS),
        toolbar,
        notice
          ? h('div', { key: 'notice', className: `dg-notice${notice.kind === 'error' ? ' dg-error' : ''}` }, [
            h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, notice.text),
            h('button', {
              key: 'x',
              type: 'button',
              className: 'dg-btn dg-sm dg-ghost',
              onClick: () => setNotice(null),
              children: '×',
            }),
          ])
          : null,
        h('div', { className: 'dg-body', key: 'body' }, [
          tree,
          h('div', { className: 'dg-main', key: 'main' }, [
            h('div', { className: 'dg-logbar', key: 'logbar' }, [
              h('input', {
                key: 'filter',
                className: 'dg-input',
                style: { maxWidth: '260px' },
                placeholder: t('filter.placeholder'),
                value: filter,
                onChange: (event) => setFilter(event.target.value),
              }),
              logRef ? h('span', { key: 'ref', className: 'dg-badge' }, logRef) : null,
              logRef ? h(Button, { key: 'clear', small: true, ghost: true, onClick: () => setLogRef(null), children: '×' }) : null,
              h('div', { key: 'sp', className: 'dg-spacer' }),
              h('label', { key: 'all', className: 'dg-label', style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: allRefs,
                  onChange: (event) => setAllRefs(event.target.checked),
                }),
                t('toolbar.allRefs'),
              ]),
              loading ? h('span', { key: 'spin', className: 'dg-spin' }) : null,
            ]),
            logPane,
            h('div', { className: 'dg-detail', key: 'detail' }, [detailTabs, h('div', { key: 'tabbody', className: 'dg-tabbody' }, detailBody)]),
          ]),
        ]),
        h('div', { className: 'dg-status', key: 'status' }, [
          h('span', { key: 'repo', title: repoPath }, `${snapshot?.repo?.name ?? ''}  ${repoPath}`),
          status
            ? h('span', { key: 'branch' }, [
              '⑂ ',
              h('span', { key: 'name', className: status.detached ? undefined : 'dg-cur-branch' },
                status.detached ? t('status.detached') : (status.branch ?? t('status.detached'))),
              status.ahead ? `  ↑${status.ahead}` : '',
              status.behind ? `  ↓${status.behind}` : '',
              status.upstream ? `  → ${status.upstream}` : '',
            ])
            : null,
          status
            ? h('span', { key: 'changes' }, status.files.length === 0
              ? t('status.clean')
              : `${status.files.length} ${t('status.changes')}`)
            : null,
          h('div', { key: 'sp', className: 'dg-spacer' }),
          snapshot?.identity?.userName ? h('span', { key: 'id' }, `${snapshot.identity.userName} <${snapshot.identity.userEmail}>`) : null,
        ]),
        menu ? h(Menu, { key: 'menu', menu, onClose: () => setMenu(null) }) : null,
        dialog ? h(Dialog, { key: dialog.id, dialog, t, onClose: closeDialog }) : null,
      ])
    }

    // ------------------------------------------------------------ panel icon

    function GitIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 20
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      }, [
        h('circle', { key: 'a', cx: 7, cy: 5, r: 2.4 }),
        h('circle', { key: 'b', cx: 7, cy: 19, r: 2.4 }),
        h('circle', { key: 'c', cx: 17, cy: 9, r: 2.4 }),
        h('path', { key: 'd', d: 'M7 7.4v9.2' }),
        h('path', { key: 'e', d: 'M17 11.4c0 3.1-2.6 5.2-6.2 5.6' }),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-git: zh dictionary')
          ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-git: en dictionary')
        } catch (error) {
          ctx.logger?.warn?.(`dsh-git-manager: locale dictionaries not registered: ${error?.message ?? error}`)
        }
        let translate
        try {
          translate = ctx.locale.bind(NS)
        } catch {
          translate = (key) => ZH[key] ?? key
        }
        const t = (key) => {
          try {
            const value = translate(key)
            return typeof value === 'string' && value !== '' ? value : (ZH[key] ?? key)
          } catch {
            return ZH[key] ?? key
          }
        }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 7,
          label: () => t('panel.title'),
        }, GitIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, (props) => h(GitPanel, { ...props, t })))
      },
    }
  },
})
