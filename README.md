# dsh-workspace-nest

侧边栏「工作区」区域的多级树：父工作区下可以继续建子工作区，每一级既能直接新建会话，也能再往下建一层；会话可以**置顶到它所属的那一级文件夹**。

![多级工作区树](https://raw.githubusercontent.com/CIBUDAYI3906/dsh-workspace-nest/main/assets/screenshot-1-tree.png)

## 安装

```sh
dsh plugin --profile web add dsh-workspace-nest
```

重启 `dsh web`。侧边栏的工作区区域会换成本插件渲染的多级树；不想用时停用这一行，自带的工作区浏览器立刻回来。

## 它做什么

- **多级子工作区**：任意工作区行的悬停菜单里点「新增子工作区」，会在该工作区目录下创建一个子文件夹并把它注册成普通工作区。层级由目录的祖先关系推导，所以想看几层就看几层。
- **每一级都能开会话**：父工作区既能放会话，也能放下级文件夹；行菜单里的「新建会话」把会话建在当前这一级。
- **会话置顶**：会话行菜单里的「置顶」把它排到**所属最近一级文件夹**的会话列表最前面，行尾带图钉标记；置顶集合由 Host 持久化，刷新、重启都不丢。
- **常用行操作**：重命名、删除、归档、分叉、会话搜索都走真实服务，和自带浏览器一致。

## 为什么需要一个 Host 半边

「新增子工作区」要建目录。浏览器侧的 `createDirectory` 走组合进来的目录选择器；很多部署（比如 macOS 原生选择器）只提供 `pick`、不提供 `createDirectory`，于是那条路永远失败。

本插件的 Host 半边用真实文件系统能力补上这一步：一条本地 JSON POST 路由，名字必须是单个路径段，落点必须仍在父工作区目录内；创建的目录里留一个空的 `.dsh-workspace-nest` 标记文件。路由不可达时，客户端会退回浏览器侧的 `createDirectory`。

## 兼容性

- 目标：DSH **0.2.x**（Web / 桌面端），声明在 `package.json` 的 `engines.dsh`；
- 置顶位和置顶动词是 0.2 的 Host 能力；更旧的客户端上整个置顶入口不出现，而不是点了报错；
- 客户端 bundle 同时兼容两代符号命名（图标与 store 包名），见 `build.mjs` 里的 `requireAny` / `pickIcon`。

## 数据与隐私

- Host 半边只在**父工作区目录内**创建子目录，并写一个空标记文件；不删除任何目录。
- 没有遥测、没有外部网络请求；置顶状态由 DSH 自己的 workspace 注册表保存，插件不另存一份。
- 卸载后子工作区目录与其中的文件都保留。

## 卸载

```sh
dsh plugin --profile web remove dsh-workspace-nest
```

已创建的子工作区就是普通工作区，会继续出现在自带的工作区浏览器里。

## 开发

```sh
npm install
npm run build     # client-source.jsx → client.js
node scripts/preflight.mjs   # 发布前检查
```

发布流程见 [PUBLISH.md](PUBLISH.md)。

## License

MIT
