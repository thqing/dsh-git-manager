# @local/dsh-git-manager — Git 管理插件（DSH / Cordis）

一个仿 IDEA Git 工具窗口的 DeepSeek Harness 插件：左侧 **Local / Remote 分支树**，
中间 **提交图（commit graph）**，下方 **提交详情 / 差异 / 变更** 三个页签，
工具栏与右键菜单覆盖常用 Git 操作。

## 功能

**仓库**
- 自动列出已注册的 workspace（Host 侧 `workspaceRegistry`）+ 手动添加/记忆的仓库目录；
- 支持在一个目录上执行 `git init`；
- 切换仓库即重新加载全部视图。

**分支树（左侧，IDEA 风格目录层级）**
- 分支名按 `/` 拆成**可折叠文件夹**：`backup/devOriginalMenuStyle` 显示为文件夹 `backup` ▸ 分支 `devOriginalMenuStyle`，
  `origin/cursor/drop-service-prefix-e035` 显示为 `origin` ▸ `cursor` ▸ `drop-service-prefix-e035`；
- 排序：当前分支的子树最前，其次文件夹（按名），最后叶子分支（按名）；
- `Local`：当前分支加粗，并显示上游与 `↑ahead / ↓behind`；
- `Remote`：按 remote 分组，组内同样分层；
- `Tags`：同样支持 `/` 分层；`Stash`、`Remotes` 为平铺分组，双击 stash 直接弹出；
- 每组尾部显示其后代条目数，折叠状态在面板内保持；
- 符号引用 `refs/remotes/<remote>/HEAD` 不会被当作分支列出。

**提交图（中间）**
- 泳道图（lane graph）按父子关系绘制，支持合并提交的多泳道；**每行的线段都刻意越过分隔线 1px 并与上下行重叠**，
  加上 `overflow:visible`，因此相邻两行之间不会出现断线/接缝（`test/client.test.mjs` 有逐行几何断言，含合并提交）；
- 整列使用**统一宽度**（取所有可见行的最大泳道数），短 hash 与提交信息列因此不会左右错位；
- 行内显示短 hash、ref 徽标（HEAD / 分支 / 标签）、提交信息、作者、时间；
- 搜索框按提交信息 / 作者 / hash 过滤；`全部分支` 开关切换 `git log --all`。

**详情 / 差异 / 变更**
- **未跟踪文件也能看差异**：`git diff` 对未跟踪文件没有输出，Host 会改用 `git diff --no-index -- /dev/null <path>` 渲染成「新文件」补丁（二进制文件则提示不显示文本差异）。
- 提交详情：作者、时间、完整 hash、父提交、refs、正文、变更文件与增删行数；
- 差异：统一 diff 着色（新增 / 删除 / hunk / 元信息），支持按文件查看；
- 变更：已暂存 / 未暂存 / 未跟踪三组，可勾选批量暂存、取消暂存、丢弃（未跟踪文件用 `git clean`，有二次确认），
  并带提交信息输入框（`Cmd/Ctrl+Enter` 提交）与 `--amend` 开关。

**图形化操作**
| 位置 | 操作 |
| --- | --- |
| 工具栏 | 刷新、获取、**更新项目**（<kbd>⌘/Ctrl</kbd>+<kbd>T</kbd>）、推送、新建分支、更多（更新项目（总是询问）/ 拉取 / 暂存修改 / 弹出暂存 / 获取并清理 / 合并 / 变基 / 中止合并 / 中止变基 / 提交身份 / 添加远程） |
| 本地分支右键 | 检出、从此新建分支、合并到当前分支、变基当前分支到此、推送、重命名、创建标签、删除、复制名称 |
| 远程分支右键 | 检出、新建本地分支、合并、变基、删除远程分支、复制名称 |
| 提交右键（单选） | 检出（分离头指针）、从此新建分支、创建标签、摘取、回滚、**编辑提交信息…**（仅未推送的提交）、重置（soft/mixed/hard）、复制 hash/信息 |
| 提交右键（**多选区间**） | **Squash Commits…**、复制多个 hash、取消选择（区间内其余单提交操作自动禁用） |
| 文件右键 | 暂存、取消暂存、丢弃、查看差异 |
| 标签 / 远程 / 暂存右键 | 检出、推送标签、删除标签；获取 / 拉取 / 推送 / 删除远程；应用 / 弹出 / 删除 stash |

**Agent 工具**
插件同时注册 `git_manage` 工具，UI 与模型共用同一套 Host 实现
（`action` 取值：`status`、`branches`、`log`、`diff`、`stage`、`unstage`、`commit_staged`、
`checkout`、`create_branch`、`merge`、`rebase`、`revert`、`reset`、`cherry_pick`、
`stash_push`、`stash_pop`、`stash_list`、`create_tag`、`remotes`、`discover`、
`update_project`（`strategy`：`merge` / `rebase` / `reset`）、`reword_commit`（`sha` + `message`）等）。

## 更新项目（Update Project）

IDEA 里对着迁出分支按 <kbd>Ctrl</kbd>+<kbd>T</kbd> 弹出的那个窗口，在这里叫**更新项目**：先 `git fetch`，
再把远端的新提交整合进当前分支。工具栏按钮显示未拉取提交数（如 `更新项目 ↓3`），快捷键
<kbd>⌘</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>T</kbd> 打开同一个对话框（浏览器通常把 Ctrl+T 留给新标签页，
所以快捷键只在焦点位于本面板内时生效，按钮与「更多」菜单始终可用）。

- **两种整合方式**：`merge`（把远端的新提交合并到当前分支，默认）/ `rebase`（把当前分支变基到远端的新提交之上），
  与 IDEA 的两个单选项一致；勾选「记住我的选择，以后不再询问」后，下次点工具栏按钮直接执行，不再弹窗
  （存在 `localStorage` 的 `dsh-git-manager.updateStrategy`），「更多 → 更新项目」则总是询问。
- **重置到远程分支**：对话框左下角的破坏性操作，会把当前分支 `git reset --hard` 到上游，二次确认里写明
  「本地未推送的提交和未提交的改动都会丢失」。
- 上游解析与 `pull` 一致：优先 `@{upstream}`，没有配置跟踪分支时回退到 `<remote>/<branch>`，都没有则明确报错
  「当前分支 X 在远端 Y 上没有对应分支，无法更新」；分离头指针直接拒绝。
- 已经是最新时不会产生空合并提交，只提示「已经是最新的（origin/xxx）」。
- 与 `拉取（pull）` 的区别：pull 直接用 `git pull`（可带 `--rebase` / `--ff-only`），是「一条命令跑到底」；
  更新项目是自己 `fetch` + 自己选策略，会先把 behind/ahead 数算出来再决定要不要动历史，行为更可控。

## 多选与 Squash Commits

- **Shift + 点击**：以锚点扩选一段相邻提交；**⌘/Ctrl + 点击**：单个增减；普通点击：单选并打开「提交详情」。
  选中行高亮，主选中行左侧有强调条；「提交详情」页会显示 `已选择 N 个相邻提交`。
- 多选后右键第一条即 **Squash Commits…**，点击会先在 Host 侧**预校验**，再弹出可编辑的多行提交信息框：
  - 预校验拒绝：不足两个提交、不是同一分支上连续的一段、区间含合并提交、提交不在当前 HEAD 历史中、工作区/索引有未提交改动；
  - 默认信息按「最旧 → 最新」拼接各提交的标题与正文（与 `git rebase -i` 的 squash 一致），可任意编辑；
  - 对话框里会显示这段区间的**净变更**（`git diff --numstat <最旧提交的父> <最新提交>`：文件数 / +行 / -行）。
    若净变更为 0（例如两个提交把同一行改过去又改回来），会明确提示「改动相互抵消，压缩后会得到一个没有文件变更的提交」——
    这与 `git rebase -i` / IDEA 的 squash 行为一致：压缩提交的 tree 取最新提交的 tree，净变更为空时它本身就没有文件差异。
    此时「提交详情」的 `变更文件（0）` 是**正确结果**，不是丢失改动（可用 `git diff <区间起点> <最新提交>` 复核净变更）。
- 实现分两步：
  1. `git commit-tree <最新提交的 tree> -p <最旧提交的父> -m <message>` 造出压缩提交（**作者取最旧提交**，与 IDE 一致）；
  2. 移动历史——**区间就在 HEAD 时用 `git reset --hard <新提交>` 直接移动当前分支**；
     区间之上还有提交时用 `git rebase --onto <新提交> <最新提交> <当前分支名>` 重放（所以压缩中间一段也不会丢后续提交）。
     > 这里踩过一个坑：`git rebase --onto <新> <最新> HEAD` 在「没有提交需要重放」时只会执行它那一步 detach 的 start-checkout
     > （git 自己的提示是 `Successfully rebased and updated detached HEAD.`），结果**分支不动、HEAD 变成分离头指针**。
     因此现在改写完成后会**校验** `HEAD` 是否仍在原来的分支上、分支是否已移动到新提交，不满足就报错并给出 `git reset --hard` 恢复命令。
- 失败时错误信息会带上 `原 HEAD`，可直接 `git reset --hard <原 HEAD>` 回退。
- 该操作在 Host 侧与同一仓库的其它写操作**串行化**，并通过 `git_manage` 工具（`action: squash` / `squash_preview`）暴露给 Agent。

- 客户端在压缩完成后还会检查一次快照：若发现「原本有分支、却变成了分离头指针」，会自己 `checkout <分支>` + `reset --hard <新提交>` 修好，
  因此即使在未重启（旧 Host 代次）的环境下点 Squash，也不会留下分离头指针。

> ⚠️ Squash 属于 Host 半边的新操作：DSH 每个进程只加载一代 Host 模块，**替换已安装的插件包需要重启 App 才生效**。
> 面板启动时会调用 `capabilities` 探测当前 Host 代次，未生效时右键里的 Squash 显示为**禁用**并在「提交详情」提示原因，不会静默失败。

## 编辑提交信息（Edit Commit Message）

IDEA 里对着未 push 的提交右键那个 **Edit Commit Message**：在提交右键菜单里选「编辑提交信息…」，
对话框会带上**完整提交信息**（标题 + 正文，不只是标题），改完点「保存」。

- 只改写**本地未推送**的提交（`git rev-list --count <sha> --not --remotes` 必须大于 0）：
  已推送的提交在菜单里是**禁用**状态，`title` 说明原因——改写它们会让本地分支与远端分叉。
- 改写 HEAD 用 `git commit --amend --only`，`--only` 保证**索引里已暂存的改动不会被卷进这次提交**；
  改写更早的提交用 `git rebase --interactive` + 自动生成的 sequence/editor 脚本
  （todo 里的缩写 sha 用前缀匹配，避免改写错行）；区间含合并提交时自动加 `--rebase-merges`，
  merge 行的 `merge -C` 改成 `merge -c` 并保留 label，否则会报 `nothing to merge: ''`。
- 工作区/索引有未提交改动时先 `git stash push --include-untracked`，改写后 `git stash pop --index`
  恢复——**已暂存的还算已暂存**（`--autostash` 会把索引状态摊平，所以没用它）。
- 改写前后校验 `HEAD^{tree}` 不变：只是改信息，绝不该动文件内容；不变才认为是成功。
- 拒绝的情况：提交信息为空、消息没有实际变化（返回 `changed: false`，面板提示「提交信息没有变化」）、
  提交已推送、提交不在当前分支历史上、仓库里有未完成的变基 / 合并 / 摘取（先完成或中止它们）。
- 与 `squash` 一样在 Host 侧**串行化**，并通过 `git_manage`（`action: reword_commit`）暴露给 Agent。

> ⚠️ 同样是 Host 半边的新操作：**替换插件包后需重启 App**，面板才不会提示「宿主尚未实现该操作」。

## 提交图渲染说明

连线连续性由三个设计共同保证（见图 `docs/graph-merge-preview.png`）：

1. 节点所在泳道的**上半段**由本行绘制（`-1 → H/2`），下半段由「到父提交的边」绘制（`H/2 → H+1`）；
2. 每段竖线两端各**越出单元格 1px** 并让 `svg { overflow: visible }`，相邻两行因此共享 2px 墨迹，任何渲染器都不会留缝；
3. 直线型连接用 `<line>`（`shape-rendering: crispEdges`）而不是 `<path>`，与上下行的线段逐像素对齐；仅跨泳道的连接使用三次贝塞尔曲线。

整列共用**一个宽度**（`最大泳道数 × 12 + 6`），短 hash 与提交信息列不会因单行泳道数变化而左右跳动。

![合并提交图预览](docs/graph-merge-preview.png)

## 架构

```
dsh-git-manager/
├── package.json        # 名为 @local/dsh-git-manager 的 bundle：dsh.bundle.patch + dsh.client
├── cordis.patch.yml    # 插入 Host 行（repos / maxCommits / timeoutMs / networkTimeoutMs）
├── index.js            # Host：注册 POST /api/dsh-git 精确 Fetch 路由 + git_manage 工具
├── git.js              # 纯 Git 引擎：校验请求 → execFile('git', argv) → JSON 结果
├── client.js           # Client：sidebar.panellist 图标 + main 插槽 key=git 的工具窗口
├── icon.svg / locale/  # 插件卡片图标与标题文案
└── test/               # node --test：引擎、Host 装配、Client 渲染共 27 个用例
```

- **通道**：Client 以同源 `POST /api/dsh-git` 调用 Host，走 `ctx.connection.fetch.register`
  注册的**精确 Fetch 路由**，因此经过 `/api` 的 Host/Origin 校验与浏览器会话 Cookie 鉴权，
  无需自建服务或绕过鉴权。
- **安全**：所有参数以 argv 数组传给 `git`（无 shell）；仓库路径经 `realpath` + `rev-parse` 校验；
  引用名、远程名、路径都会拒绝以 `-` 开头及非法字符；破坏性操作（丢弃、`reset --hard`、删除分支/远程分支）都有确认弹窗；
  同一仓库的写操作在 Host 侧串行化，避免双击造成竞态。
- **主题**：仅使用 `--dsw-alias-*` 设计令牌，浅色/深色自动适配；样式随组件挂载，卸载即移除。
  注意 `--dsw-alias-brand-primary` 是**单色对比色**（浅色主题近黑、深色主题近白，见 `--dsw-static-neutral-bluish-1000/50`），
  只能配合 `--dsw-alias-label-primary-foreground` 作填充按钮底色，**不能**当强调色或承载白字；
  强调色请用 `--dsw-alias-state-business-primary`（两种主题下都是蓝色）。`test/client.test.mjs` 中有针对这一点的回归断言。

## 安装 / 迁移 / 升级

完整步骤见 **[INSTALL.md](INSTALL.md)**（跨机器的 Git 仓库方式、本机源码目录方式、单 tgz 方式、私有 registry 方式、
自检清单、升级与卸载流程）。要点：

```bash
# 跨机器（推荐 Git 仓库，不绑定本地路径）
git clone git@github.com:thqing/dsh-git-manager.git ~/dsh-plugins/dsh-git-manager
#   然后让 Agent：plugin_manager install_bundle  target = ~/dsh-plugins/dsh-git-manager
# 本机源码方式（直接指向本目录绝对路径）
#   plugin_manager install_bundle   target = <本目录绝对路径>
# 若提示 restart-required，退出并重开 DSH
```

> ⚠️ 本地目录 / 本地 tgz 方式会把**绝对路径**写进 profile 清单，之后不能移动或删除该来源，
> 否则以后安装任何插件都会 ENOENT（详见 INSTALL.md「先读」一节）。

安装后侧边栏「全局面板」区出现 **Git** 图标，点击打开 Git 工具窗口。

## 测试

```bash
npm test        # node --test test/ ，62 个用例，不需要 DSH
```
