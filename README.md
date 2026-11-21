# dsh-workspace-nest

[![npm](https://img.shields.io/npm/v/dsh-workspace-nest)](https://www.npmjs.com/package/dsh-workspace-nest)
[![downloads](https://img.shields.io/npm/dm/dsh-workspace-nest)](https://www.npmjs.com/package/dsh-workspace-nest)
[![license](https://img.shields.io/npm/l/dsh-workspace-nest)](LICENSE)
![DSH](https://img.shields.io/badge/DSH-0.2.x%20%7C%200.3.x-blue)

把侧边栏「工作区」变成**多级文件夹**：父工作区下继续建子工作区，每一级都能开会话；会话可以**置顶到它所属的那一级文件夹**。

![演示：新建子工作区 → 树展开](https://raw.githubusercontent.com/CIBUDAYI3906/dsh-workspace-nest/main/assets/demo.gif)

## English

A nested workspace tree for the DeepSeek Harness sidebar. Create a sub-workspace at any level, start sessions at any level, and pin a session to the top of its nearest folder. Nesting is derived from directory ancestry — no new data model. Pins are persisted by the Host, so they survive reloads.

```sh
dsh plugin --profile web add dsh-workspace-nest
```

## 30 秒上手

```sh
dsh plugin --profile web add dsh-workspace-nest
```

重启 `dsh web` → 工作区行悬停菜单 → 「新增子工作区」→ 填名字或点「系统选择器」挑一个已存在的文件夹 → 子行出现，父行自动展开。

![多级工作区树](https://raw.githubusercontent.com/CIBUDAYI3906/dsh-workspace-nest/main/assets/screenshot-1-tree.png)

## 它做什么

- **多级子工作区**：任意工作区行的悬停菜单里点「新增子工作区」，会在该工作区目录下创建子文件夹并注册为普通工作区。层级由目录的祖先关系推导，想看几层就看几层。
- **子工作区也能选已有目录**：对话框里的「系统选择器」可以直接把**已存在**的文件夹注册成子工作区，不新建目录；目录之外的位置会被拦下并提示。
- **每一级都能开会话**：父工作区既能放会话，也能放下级文件夹；行菜单里的「新建会话」把会话建在当前这一级。
- **会话置顶**：会话行菜单里的「置顶」把它排到**所属最近一级文件夹**的最前面，行尾带图钉；置顶集合由 Host 持久化，刷新、重启都不丢。
- **常用行操作**：重命名、删除、归档、分叉、会话搜索都走真实服务，和自带浏览器一致。

## 适合谁 / 不适合谁

**适合**：项目有明确分组（团队 / 客户 / 产品线）、希望侧边栏像文件树一样有层级、并且想让置顶只在当前文件夹生效的人。

**不适合**：只想按最近活跃排序工作区（用 `dsh-workspace-manager`）；只想要一个跨工作区的置顶汇总（用 `dsh-pinned-sessions`）；仍在使用 DSH 0.1 客户端的用户（置顶入口不会出现）。

## 和同类插件的区别

| 插件 | 做什么 | 和本插件的区别 |
| --- | --- | --- |
| **dsh-workspace-nest** | 多级工作区树 + 每级会话 + 置顶到所属文件夹 | 父子关系由目录祖先推导，不引入新数据模型 |
| `@aeroscis/dsh-workspace-manager` | 工作区排序、自动置顶、清理空工作区 | 管顺序，不管层级 |
| `@vfvrpq/dsh-pinned-sessions` | 跨工作区的置顶汇总分组 | 汇总，不改变树结构 |

## 为什么需要 Host 半边

「新增子工作区」要建目录。浏览器侧的 `createDirectory` 走组合进来的目录选择器；很多部署（比如 macOS 原生选择器）只提供 `pick`、不提供 `createDirectory`，于是那条路永远失败。

本插件的 Host 半边用真实文件系统能力补上这一步：一条本地 JSON POST 路由，名字必须是单个路径段，落点必须仍在父工作区目录内；创建的目录里留一个空的 `.dsh-workspace-nest` 标记文件。路由不可达时，客户端会退回浏览器侧的 `createDirectory`。

「系统选择器」那条路不需要这条路由：挑中的目录已经存在，注册即可。

## 局限（诚实说明）

- 只支持 **Web / 桌面端**（`platform: web`），TUI 没有侧边栏；
- 置顶依赖 DSH 0.2 的 Host 能力；更旧客户端上入口直接不出现；
- 新建子工作区会在磁盘上创建目录，删除子工作区不会删除目录（插件不持有删除能力）。

## 兼容性

- 目标：DSH **0.2.x / 0.3.x**（`engines.dsh: >=0.2.0-rc.1 <0.4.0`），实测于 0.2.0-rc.2；
- 客户端对 `sidebar.workspaces` 槽位、`uiWorkspace` / `workspaces` / `sessions` 服务都做能力探测：缺失时降级为无操作，不会让页面崩溃；
- DSH 0.3 尚未正式发布，0.3 上的行为会在发布后回归；遇到问题请开 issue。

## 数据与隐私

- Host 半边只在**父工作区目录内**创建子目录，并写一个空标记文件；不删除任何目录；
- 没有遥测、没有外部网络请求；置顶状态由 DSH 自己的 workspace 注册表保存，插件不另存一份。

## 卸载

```sh
dsh plugin --profile web remove dsh-workspace-nest
```

已创建的子工作区就是普通工作区，会继续出现在自带的工作区浏览器里。

## 同作者的另一款插件

如果你也嫌每次开新会话都要重复交代背景：[`dsh-prompt-trove`](https://github.com/CIBUDAYI3906/dsh-prompt-trove) —— 两层 Markdown 提示词库，点一下或 `@` 追加进草稿。

## 开发

```sh
npm install
npm run build     # client-source.jsx → client.js
node scripts/preflight.mjs
```

发布流程、issue/PR 规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。特别感谢 [@NotTheOrange21](https://github.com/NotTheOrange21) 贡献了子工作区的「系统选择器」。

## License

MIT
