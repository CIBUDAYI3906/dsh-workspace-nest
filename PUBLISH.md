# 发布到 GitHub / npm / 目录

本地代码已按可分发包准备好。账号相关的动作按顺序做。

## 1. 本地检查

```sh
npm install
npm run build      # 改了 client-source.jsx 就要重跑
node scripts/preflight.mjs
npm pack --dry-run
```

## 2. 推到 GitHub

仓库：`https://github.com/CIBUDAYI3906/dsh-workspace-nest`（public，topic `dsh-plugin`）。
用户侧安装：

```sh
dsh plugin --profile web add dsh-workspace-nest
```

只发 GitHub（不 npm）也可以：`dsh plugin --profile web add github:CIBUDAYI3906/dsh-workspace-nest`。

## 3. 发 npm

```sh
npm login                                  # 首次
npm --userconfig ./.npmrc --cache ./.npm-cache publish --access public
npm view dsh-workspace-nest version
```

- `prepublishOnly` 会跑 preflight；
- 账号开了 2FA（安全密钥/Touch ID），publish 会要求在浏览器确认；
- 预发布用 `npm publish --tag next`。

## 4. 提交目录收录

收录入口：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。

1. Fork；
2. 把 `submission/CIBUDAYI3906__dsh-workspace-nest.yml` 放到 `data/plugins/`；
3. 提 PR（一个 PR 只加这一个文件）；
4. CI 要求仓库创建满 1 天，所以建仓次日再提。

审核会读代码、核对描述是否属实、判断分类与是否重复。本插件与已有条目的差异：**多级嵌套工作区**（父子由目录祖先推导）+ **任意一级开会话** + **置顶到最近一级文件夹**。

## 5. 版本

```sh
npm version patch && npm --userconfig ./.npmrc --cache ./.npm-cache publish --access public
```

目录每晚刷新，npm 映射按 `repository` 自动关联。
