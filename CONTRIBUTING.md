# Contributing

Thanks for taking a look. Issues and focused PRs are welcome.

## 开发环境

- Node.js 20+（构建用 esbuild）；
- 一个可运行的 DSH 0.2.x profile（Web 或桌面端）用于真机验证；
- 不需要数据库或网络服务。

```sh
npm install
npm run build     # client-source.jsx → client.js
node scripts/preflight.mjs
```

## 改哪里

| 文件 | 说明 |
| --- | --- |
| `client-source.jsx` | 客户端实现（侧边栏槽位、树、对话框），**改这里** |
| `client.js` | 构建产物，不要手改；提交前重新 `npm run build` |
| `index.js` | Host 半边：创建子工作区目录的本地 POST 路由与守卫 |
| `cordis.patch.yml` | 安装时挂载插件的 patch 层 |
| `README.md` / `CHANGELOG.md` | 文档 |

## 提交 PR 前

- [ ] `npm run build` 后 `git diff --exit-code client.js` 为空；
- [ ] `node scripts/preflight.mjs` 通过；
- [ ] 改了行为的话，写清楚验证方式（DSH 版本、步骤、结果）；
- [ ] 不要夹带无关重构或格式化。

## 提交信息

Conventional Commits，例如：

```text
feat: adopt an existing folder in the sub-workspace dialog
fix: trim trailing separator before the containment check
docs: add a demo GIF
chore: widen engines.dsh to <0.4.0
```

## Issue

请用仓库的 issue 模板，附上：

- DSH 版本（`dsh --version`）、操作系统、插件版本；
- 复现步骤、预期/实际结果；
- 截图或控制台报错（不要贴 token、密钥、会话内容）。

## 发布（维护者）

```sh
npm version patch
npm run build
node scripts/preflight.mjs
npm publish --access public
```

目录（awesome-dsh-plugin）会在每日刷新时自动更新版本与下载量。
