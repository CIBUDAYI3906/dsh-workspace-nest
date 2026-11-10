/**
 * Source of `dsh-workspace-nest`'s client bundle.
 *
 * Not loaded directly: `build.mjs` transpiles this file (JSX → `jsx` calls,
 * ESM → CJS) and wraps the result in the `window.__ModuleLoader__.load({ id,
 * factory: (require) => … })` shell the browser module registry serves.
 *
 * What it renders: the `sidebar.workspaces` region as a NESTED workspace tree.
 *
 * - A sub-workspace is an ordinary Host Workspace whose canonical directory
 *   lives inside another Workspace's directory, so nesting is derived from
 *   `WorkspaceView.path` ancestry and needs no new data model. Creating one is
 *   `createDirectory(parent.path, name)` followed by `create({ path })`,
 *   resolved per client generation (see `firstMethod` and `apply`).
 * - Every workspace row keeps the shipped "new Session here" verb and adds
 *   "new sub-workspace here", so one level can hold conversations and child
 *   levels at the same time.
 * - `sidebar.workspaces` is a `single` slot: this entry competes with the
 *   shipped browser for the same cell and renders at a lower (deployment)
 *   priority, so disabling the row in the profile restores the shipped UI.
 *
 * Generation discipline: this bundle must serve BOTH client generations, and
 * the two differ in ways that only show up when a row is clicked —
 *   - 0.1 serves `startSession` / `pickDirectory` / `createDirectory` from
 *     `workspaces`, opens conversations with `sessions.open`, renames through
 *     `sessions.binding(id).session.rename`, and publishes the selected Session
 *     as `useSessions(...).current`;
 *   - 0.2 moved those verbs to a `uiWorkspace` service, renamed the open verb
 *     to `openSession`, renames through a retained `sessions.using(...)`
 *     reference, and marks the selected Session by retaining it for the main
 *     view (`retainedBy.mainView`) instead of publishing `current`.
 * Nothing here may assume either shape, and nothing may resolve a verb once at
 * apply time: `uiWorkspace` is provided after this plugin's fiber activates.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import css from './WorkspaceTree.module.css'

/**
 * Components whose exported names are identical across client generations.
 * Everything that HAS moved between generations is resolved below rather than
 * named here: a named import of a symbol a build does not export is a load
 * failure on that build, which is exactly what this compatibility layer
 * exists to avoid.
 */
const { Button, HoverCard, Menu, Modal, StateDot, Tooltip } = primitives

/**
 * Icon exports moved between client generations, and the move was NOT a simple
 * rename:
 *   - older builds export one component per SIZE  (`IconFolderOpen16`, …20, …14);
 *   - newer builds export one component per STROKE WEIGHT (`IconFolderOpenRegular`,
 *     `IconFolderOpenMedium`) with `size` defaulting to 16, and export NEITHER
 *     the size-suffixed names NOR a bare `IconFolderOpen` — the bare spelling
 *     survives only inside their doc comments, so it is not a runtime symbol.
 * Probe in that order so ONE bundle serves both generations.
 * @param suffixed - the size-suffixed name older builds export.
 * @param base - the bare icon name; newer builds append a weight suffix to it.
 * @returns the icon component, or a no-op stand-in when the build has none.
 */
function pickIcon(suffixed, base) {
  const icon = primitives[suffixed]
    ?? primitives[base + 'Regular']
    ?? primitives[base + 'Medium']
    ?? primitives[base]
  if (icon !== undefined) return icon
  console.warn(`dsh-workspace-nest: none of ${suffixed} / ${base}Regular / ${base}Medium exists in this client build`)
  return function MissingIcon() { return null }
}

/**
 * Resolve an icon that exists in only ONE client generation.
 *
 * The pin glyphs are 0.2-only: the 0.1 build ships no pin icon at all, and a
 * warned no-op stand-in would either print noise on every 0.1 load or render
 * an empty icon slot. Returning null lets the caller omit the affordance —
 * pinning is a Host-persisted 0.2 capability, so 0.1 simply has no pin UI.
 * @param suffixed - the size-suffixed name 0.1-era builds export.
 * @param base - the bare icon name newer builds suffix with a stroke weight.
 * @returns the icon component, or null when this build has none.
 */
function optionalIcon(suffixed, base) {
  // Test membership with `in` before reading: the module registry's proxy fails
  // loudly on a READ of an export this build lacks, so an optional glyph has to
  // be probed without touching it.
  for (const name of [suffixed, base + 'Regular', base + 'Medium', base]) {
    if (!(name in primitives)) continue
    const icon = primitives[name]
    if (icon !== undefined && icon !== null) return icon
  }
  return null
}

const IconPinFill = optionalIcon('IconPinFill16', 'IconPinFill')
const IconPinOutline = optionalIcon('IconPinOutline16', 'IconPinOutline')
const IconArchiveOutline20 = pickIcon('IconArchiveOutline20', 'IconArchiveOutline')
const IconBranchOutline16 = pickIcon('IconBranchOutline16', 'IconBranchOutline')
const IconCloseFill14 = pickIcon('IconCloseFill14', 'IconCloseFill')
const IconEditOutline16 = pickIcon('IconEditOutline16', 'IconEditOutline')
const IconEllipsisOutline16 = pickIcon('IconEllipsisOutline16', 'IconEllipsisOutline')
const IconFolderClose16 = pickIcon('IconFolderClose16', 'IconFolderClose')
const IconFolderOpen16 = pickIcon('IconFolderOpen16', 'IconFolderOpen')
const IconPlusOutline16 = pickIcon('IconPlusOutline16', 'IconPlusOutline')
const IconProjectAddOutline16 = pickIcon('IconProjectAddOutline16', 'IconProjectAddOutline')
const IconSearchOutline16 = pickIcon('IconSearchOutline16', 'IconSearchOutline')
const IconTrashOutline16 = pickIcon('IconTrashOutline16', 'IconTrashOutline')
const IconTriangleRightFill14 = pickIcon('IconTriangleRightFill14', 'IconTriangleRightFill')

/**
 * Resolve a region verb by capability instead of by owning service.
 *
 * The 0.2 client generation moved every sidebar verb that is not pure registry
 * bookkeeping onto a single `uiWorkspace` service (`openSession`, `startSession`,
 * `pickDirectory`, `createDirectory`, `forkSession`, …); 0.1 keeps
 * `workspaces.startSession` / `sessions.open` / the directory-picker packages on
 * the controller faces. Names and owners differ, so the SAME bundle serves both
 * by asking each candidate whether it actually exposes the verb — the first
 * owner that does wins.
 *
 * Probing matters more than it looks: calling a verb that a generation moved
 * away throws `… is not a function` INSIDE a React click handler, which React
 * reports on the console while the operator sees nothing happen at all.
 * @param name - the method name on the owner.
 * @param owners - candidate services, most specific generation first.
 * @returns the bound method, or undefined when no owner exposes it.
 */
function firstMethod(name, ...owners) {
  for (const owner of owners) {
    if (owner === undefined || owner === null) continue
    const method = owner[name]
    if (typeof method === 'function') return method.bind(owner)
  }
  return undefined
}

/**
 * Turn "this generation has no such verb" into a legible failure at the call
 * site, rather than a bare TypeError that vanishes into the event loop.
 * @param name - the capability the caller needed.
 * @param method - the resolved method, or undefined.
 * @returns the method.
 * @throws when no client generation in this build exposes the capability.
 */
function requireVerb(name, method) {
  if (method === undefined) {
    throw new Error('这个客户端版本没有提供“' + name + '”能力，该操作暂时不可用。')
  }
  return method
}

/** Human-readable text for an unknown rejection reason. */
function reasonText(reason) {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Stable empty pin list: `rowsOf` memoizes on the pin list identity. */
const EMPTY_PIN_IDS = []

/** Bundle id; must equal the package name the profile row composes. */
export const PLUGIN_ID = 'dsh-workspace-nest'

/**
 * Host route that creates a sub-workspace's directory and adopts it (see this
 * package's `index.js`). The client asks the host FIRST because the create
 * verb delegates to the composed directory picker, and a deployment composing
 * the NATIVE picker does not serve a create capability.
 */
const CREATE_CHILD_URL = '/dsh-workspace-nest/create'

/** Debounce before a Host content search follows the query. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * Horizontal step per nesting level. One 22px step per level is what the
 * shipped tree uses for its single indent level; keeping that step means a
 * three-level tree still leaves the title most of the row.
 */
const INDENT_STEP = 22

/** Level past which rows keep the indentation ladder but drop the guide rail. */
const GUIDE_MAX_DEPTH = 3

/** Bundle-visible copy (this package registers no locale namespace). */
const TEXT = {
  section: '工作区',
  searchPlaceholder: '搜索工作区或会话…',
  searchPending: '正在搜索会话内容…',
  searchNone: '没有匹配的工作区或会话',
  empty: '还没有工作区，点右上角 ＋ 添加',
  loading: '正在加载工作区…',
  sessionsNone: '这个工作区还没有会话',
  newSession: '新会话',
  addWorkspace: '添加工作区',
  addHint: '注册一个已存在的目录为工作区。要做分类，请在某个工作区行上用「＋」新增子工作区。',
  addPathLabel: '目录绝对路径',
  addPathPlaceholder: '/Users/you/projects/foo',
  addPick: '系统选择器',
  addCommit: '添加',
  addBusy: '处理中…',
  subTitle: '新增子工作区',
  subHint: '将在该工作区目录下创建文件夹，并把它注册为子工作区：',
  subNameLabel: '子工作区文件夹名',
  subCommit: '创建',
  subBusy: '创建中…',
  subBadName: '请输入一个不含路径分隔符的文件夹名。',
  renameWorkspace: '重命名工作区',
  renameSession: '重命名会话',
  workspaceNameField: '工作区名称',
  sessionNameField: '会话名称',
  deleteWorkspace: '删除工作区',
  deleteDesc: '将把“{name}”从工作区列表中移除。文件夹与会话记录都会保留。',
  menuSub: '新增子工作区',
  menuPin: '置顶',
  menuUnpin: '取消置顶',
  pinAction: '置顶',
  unpinAction: '取消置顶',
  pinnedBadge: '已置顶',
  menuRename: '重命名',
  menuDelete: '删除工作区',
  menuFork: '分叉会话',
  menuArchiveSession: '归档会话',
  cancel: '取消',
  rename: '重命名',
  delete: '删除',
  close: '关闭',
  collapse: '折叠',
  expand: '展开',
  actionsWorkspace: '工作区“{name}”的操作',
  actionsSession: '会话“{name}”的操作',
  newSessionIn: '在“{name}”中新建会话',
  subIn: '在“{name}”中新增子工作区',
  statusRunning: '进行中',
  statusWaiting: '等待你处理',
  statusDone: '已完成',
  copy: '复制',
  copied: '已复制',
  openSessionAction: '打开会话',
  noticeFailed: '{action}失败：{reason}',
  hoverCreated: '创建于 {time}',
  countSessions: '{n} 个会话',
  countChildren: '{n} 个子工作区',
}

/** Fill `{name}`-style placeholders. */
function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined ? match : String(values[key])
  ))
}

/** Relative-time bucket label. */
function relTime(updatedAt, now) {
  const diff = Math.max(0, now - updatedAt)
  const MIN = 60000
  const HOUR = 3600000
  const DAY = 86400000
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return Math.floor(diff / MIN) + '分钟'
  if (diff < DAY) return Math.floor(diff / HOUR) + '小时'
  if (diff < 30 * DAY) return Math.floor(diff / DAY) + '天'
  if (diff < 365 * DAY) return Math.floor(diff / (30 * DAY)) + '个月'
  return Math.floor(diff / (365 * DAY)) + '年'
}

/** Absolute calendar time for the hover card. */
function absoluteTime(createdAt) {
  const d = new Date(createdAt)
  const pad = (value) => String(value).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** Whether `childPath` sits inside `parentPath`, respecting the separator. */
function isUnder(parentPath, childPath) {
  const cut = parentPath.length
  return childPath.length > cut
    && childPath.slice(0, cut) === parentPath
    && (childPath[cut] === '/' || childPath[cut] === '\\')
}

/** The path tail below an ancestor, used as a nested workspace's row label. */
function tailBelow(ancestorPath, childPath) {
  const rest = childPath.slice(ancestorPath.length).replace(/^[/\\]+/, '')
  return rest === '' ? childPath : rest
}

/**
 * Build the nesting forest over the Host's flat workspace order: every
 * workspace hangs under its DEEPEST registered ancestor directory, so any
 * depth works and a workspace whose ancestors are unregistered stays a root.
 * @param items - workspace views in Host order.
 * @returns parent map, children map, and roots, all in Host order.
 */
function buildForest(items) {
  const parent = new Map()
  for (const item of items) {
    let best
    for (const candidate of items) {
      if (candidate.workspaceId === item.workspaceId) continue
      if (!isUnder(candidate.path, item.path)) continue
      if (best === undefined || candidate.path.length > best.path.length) best = candidate
    }
    parent.set(item.workspaceId, best)
  }
  const childrenOf = new Map()
  const roots = []
  for (const item of items) {
    const up = parent.get(item.workspaceId)
    if (up === undefined) {
      roots.push(item)
      continue
    }
    const bucket = childrenOf.get(up.workspaceId)
    if (bucket === undefined) childrenOf.set(up.workspaceId, [item])
    else bucket.push(item)
  }
  return { parent, childrenOf, roots }
}

/**
 * Session status dot, or null when the row has nothing to announce.
 *
 * Only ACTIVE states earn a dot (pending user attention outranks running,
 * which outranks a finished-but-unviewed reminder). An idle or already-read
 * session shows none: a dot that is always there stops reading as a signal and
 * turns the list into a dotted line. The slot stays reserved either way, so
 * titles share one alignment whether or not a row carries a status.
 */
function statusOf(session, isCurrent) {
  if (session.pendingInteraction !== undefined) return { state: 'warning', label: TEXT.statusWaiting }
  if (session.running) return { state: 'ongoing', label: TEXT.statusRunning }
  if (session.completed === true && !isCurrent) return { state: 'done', label: TEXT.statusDone }
  return null
}

/** Browser-local view state: unfolding plus the per-workspace session order. */
function createWorkspaceTreeStore() {
  return defineStore({
    init: () => ({ expanded: {}, sessionOrder: {} }),
    persist: 'dsh.workspaceTree.view.v1',
    actions: {
      setExpanded: (draft, key, next) => {
        if (next) draft.expanded[key] = true
        else delete draft.expanded[key]
      },
      setSessionOrder: (draft, key, order) => { draft.sessionOrder[key] = order },
      retainKeys: (draft, keys) => {
        const keep = new Set(keys)
        draft.expanded = Object.fromEntries(
          Object.entries(draft.expanded).filter(([key]) => keep.has(key)),
        )
        draft.sessionOrder = Object.fromEntries(
          Object.entries(draft.sessionOrder).filter(([key]) => keep.has(key)),
        )
      },
    },
  })
}

/** Reconcile a stored order against the workspace's current session account. */
function reconcileOrder(sessionIds, stored, byId) {
  const result = []
  const seen = new Set()
  for (const key of stored === undefined ? [] : stored) {
    if (!sessionIds.includes(key) || seen.has(key) || byId[key] === undefined) continue
    result.push(key)
    seen.add(key)
  }
  const rest = sessionIds.filter((id) => !seen.has(id) && byId[id] !== undefined)
  rest.sort((a, b) => {
    const left = byId[a]
    const right = byId[b]
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    return a < b ? -1 : 1
  })
  return result.concat(rest)
}

/**
 * Front the pinned Sessions inside ONE account's session order.
 *
 * A pin's promised home is the top of its nearest folder, and the account here
 * IS that folder's own session list (`WorkspaceView.sessionIds`) — so fronting
 * the pinned ids in this one account is the whole placement rule. Pins lead in
 * pin-recency order (the Host reports `pinnedSessionIds` most recently pinned
 * first); every other member keeps the reconciled order, so unpinning restores
 * exactly the position the row had before it was pinned instead of appending it.
 * @param order - the reconciled order for this account.
 * @param pinnedSessionIds - Host-confirmed pinned ids, most recent first.
 * @returns the order with this account's pinned members leading.
 */
function frontPinned(order, pinnedSessionIds) {
  if (pinnedSessionIds.length === 0) return order
  const members = new Set(order)
  const leading = []
  const seen = new Set()
  for (const id of pinnedSessionIds) {
    if (!members.has(id) || seen.has(id)) continue
    leading.push(id)
    seen.add(id)
  }
  if (leading.length === 0) return order
  return leading.concat(order.filter((id) => !seen.has(id)))
}

/**
 * The conversation the main view is showing.
 *
 * 0.1 publishes the selection as `list.current`; 0.2 dropped that field and
 * marks the selected Session by RETAINING it for the main view instead
 * (`retainedBy.mainView`). Without this hop a 0.2 client reports "no current
 * conversation", which leaves every row looking unselected and hides a freshly
 * created Session while it is still blank.
 * @param list - the sessions snapshot handed to `useSessions`.
 * @returns the selected Session id, or undefined when the panel shows none.
 */
function currentSessionId(list) {
  if (list === undefined) return undefined
  if (list.current !== undefined) return list.current
  for (const session of Object.values(list.byId === undefined ? {} : list.byId)) {
    if (session !== undefined && (session.retainedBy === undefined ? 0 : session.retainedBy.mainView ?? 0) > 0) {
      return session.id
    }
  }
  return undefined
}

/** Hover-revealed row action button. */
function RowAction({ label, title, onClick, children }) {
  return (
    <button
      type="button"
      className={css.rowButton}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onClick() }}
    >
      <Tooltip label={title} side="bottom" delayMs={600}>{children}</Tooltip>
    </button>
  )
}

/**
 * One workspace row's trailing menu.
 *
 * The open flag is OWNED BY THE ROW (not by this component): the row has to
 * keep its `.rowActions` cell laid out while the menu is open, otherwise the
 * cell's `:hover` reveal collapses the moment the pointer leaves the row to
 * aim at the portaled menu — the anchor then reports a zero rect, the shipped
 * Menu re-places per frame onto the viewport corner, and the target becomes
 * unclickable. See `.menuOpenRow` in the stylesheet (the shipped browser
 * solves the same problem with its own `menuOpen` row class).
 * @param props.label - workspace row label (menu button's accessible name).
 * @param props.open - whether this row's menu is showing (row-owned).
 * @param props.onOpenChange - request the row to open/close the menu.
 * @param props.onSub - create a child workspace.
 * @param props.onRename - open the workspace rename dialog.
 * @param props.onDelete - open the workspace delete dialog.
 * @returns the Menu with the row's ellipsis anchor.
 */
function WorkspaceActions({ label, open, onOpenChange, onSub, onRename, onDelete }) {
  return (
    <Menu
      open={open}
      onClose={() => { onOpenChange(false) }}
      items={[
        { id: 'sub', label: TEXT.menuSub, icon: <IconProjectAddOutline16 size={16} /> },
        { id: 'rename', label: TEXT.menuRename, icon: <IconEditOutline16 /> },
        { id: 'delete', label: TEXT.menuDelete, icon: <IconTrashOutline16 />, danger: true },
      ]}
      onSelect={(id) => {
        onOpenChange(false)
        if (id === 'sub') onSub()
        else if (id === 'rename') onRename()
        else if (id === 'delete') onDelete()
      }}
      portal
      closeOnPointerLeave
      anchor={(
        <button
          type="button"
          className={css.rowButton}
          aria-label={fmt(TEXT.actionsWorkspace, { name: label })}
          onClick={(event) => { event.stopPropagation(); onOpenChange(!open) }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}

/**
 * One session row's trailing menu (row-owned open flag, same reason as
 * {@link WorkspaceActions}).
 * @param props.title - session title (menu button's accessible name).
 * @param props.open - whether this row's menu is showing (row-owned).
 * @param props.onOpenChange - request the row to open/close the menu.
 * @param props.pinSupported - the host exposes pin state and verbs (0.2 only).
 * @param props.pinned - this Session is currently pinned.
 * @param props.onTogglePin - pin or unpin this Session.
 * @param props.onRename - open the session rename dialog.
 * @param props.onFork - fork this session.
 * @param props.onArchive - archive this session.
 * @returns the Menu with the row's ellipsis anchor.
 */
function SessionActions({
  title, open, onOpenChange, pinSupported, pinned, onTogglePin, onRename, onFork, onArchive,
}) {
  // The pin row leads the menu (the shipped browser's order 100) and only
  // exists where the Host actually persists pins.
  const PinGlyph = pinned ? IconPinFill : IconPinOutline
  const pinItem = pinSupported
    ? [{
      id: 'pin',
      label: pinned ? TEXT.menuUnpin : TEXT.menuPin,
      icon: PinGlyph === null ? undefined : <PinGlyph size={16} />,
    }]
    : []
  return (
    <Menu
      open={open}
      onClose={() => { onOpenChange(false) }}
      items={[
        ...pinItem,
        { id: 'rename', label: TEXT.menuRename, icon: <IconEditOutline16 /> },
        { id: 'fork', label: TEXT.menuFork, icon: <IconBranchOutline16 /> },
        { id: 'archive', label: TEXT.menuArchiveSession, icon: <IconArchiveOutline20 size={16} /> },
      ]}
      onSelect={(id) => {
        onOpenChange(false)
        if (id === 'pin') onTogglePin()
        else if (id === 'rename') onRename()
        else if (id === 'fork') onFork()
        else if (id === 'archive') onArchive()
      }}
      portal
      closeOnPointerLeave
      anchor={(
        <button
          type="button"
          className={css.rowButton}
          aria-label={fmt(TEXT.actionsSession, { name: title })}
          onClick={(event) => { event.stopPropagation(); onOpenChange(!open) }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}

/**
 * The browsing region: section header, search, and the nested tree.
 * @param props - composed slot props (shell owner share + store + inject).
 * @returns the region element.
 */
function WorkspaceTree({
  wide, expandSidebar, useWorkspaces, useSessions, useStore, actions,
  startSession, openSession, renameSession, forkSession, archiveSession,
  pinSession, unpinSession,
  renameWorkspace, deleteWorkspace, createWorkspace, createChildWorkspace, insertSessionBefore,
  searchSessions, pickDirectory,
}) {
  const snapshot = useWorkspaces((state) => state)
  const sessionList = useSessions((state) => state)
  const expanded = useStore((state) => state.expanded)
  const sessionOrder = useStore((state) => state.sessionOrder)
  const items = snapshot.items
  const archived = snapshot.archivedSessionIds
  // Pin state is Host-persisted in 0.2 (`pinnedSessionIds`, most recent first).
  // The field's ABSENCE is the generation test: 0.1 has no pin store and no
  // pin verbs, so the whole affordance stays out of its UI instead of failing
  // after a click.
  const pinSupported = Array.isArray(snapshot.pinnedSessionIds)
  const pinnedSessionIds = useMemo(
    () => (Array.isArray(snapshot.pinnedSessionIds) ? snapshot.pinnedSessionIds : EMPTY_PIN_IDS),
    [snapshot.pinnedSessionIds],
  )
  const pinnedSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])

  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState({ query: '', status: 'idle', items: [] })
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState(null)
  const [subTarget, setSubTarget] = useState(null)
  const [subName, setSubName] = useState('')
  const [subBusy, setSubBusy] = useState(false)
  const [subError, setSubError] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  // Which row's trailing menu is showing, keyed `w:<workspaceId>` / `s:<id>`.
  // Row-level rather than menu-local: the row must keep its `.rowActions` cell
  // laid out while the menu is open, or that cell's `:hover` reveal collapses
  // as soon as the pointer leaves the row to aim at the portaled menu (see the
  // `.menuOpenRow` rules in the stylesheet).
  const [menuOpenRow, setMenuOpenRow] = useState(null)
  const [notice, setNotice] = useState(null)
  const [drag, setDrag] = useState(null)
  const [dropAt, setDropAt] = useState(null)
  const composing = useRef(false)

  const current = currentSessionId(sessionList)
  const needle = query.trim()
  const forest = useMemo(() => buildForest(items), [items])
  const now = Date.now()

  /**
   * Run one region verb and report a rejection inline.
   *
   * Every verb here is a Client service call, and the interesting failures are
   * service-level (a moved method, a refused Host operation), not render
   * errors: an uncaught rejection inside a click handler reaches the console
   * and nothing else, which reads as "the button does nothing". Surfacing the
   * reason on the region is what makes the button honest.
   * @param action - the human action name used in the message.
   * @param operation - the call to run.
   */
  const runAction = useCallback((action, operation) => {
    Promise.resolve().then(operation).then(() => { setNotice(null) }).catch((reason) => {
      setNotice(fmt(TEXT.noticeFailed, { action, reason: reasonText(reason) }))
    })
  }, [])

  // A notice is a transient report, not a persistent banner.
  useEffect(() => {
    if (notice === null) return undefined
    const timer = window.setTimeout(() => { setNotice(null) }, 8000)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  // Reveal the selected Session's ancestor chain ONCE per workspace. Doing it
  // on every render would re-open a workspace the operator just collapsed —
  // deleting the key would only make the next pass add it back, so the row
  // could never be folded while its own session stayed selected.
  const autoRevealed = useRef(new Set())
  useEffect(() => {
    if (current === undefined) return
    const owner = items.find((item) => item.sessionIds.includes(current))
    if (owner === undefined) return
    const chain = []
    let cursor = owner
    while (cursor !== undefined) {
      chain.push(cursor.workspaceId)
      cursor = forest.parent.get(cursor.workspaceId)
    }
    // Ancestors are revealed on every selection change (the selected row must
    // stay reachable); the workspace OWNING the session is revealed only the
    // first time it becomes current, so its row can be folded afterwards.
    const fresh = chain.filter((key, index) => index > 0 || !autoRevealed.current.has(key))
    if (fresh.length === 0) return
    for (const key of chain) autoRevealed.current.add(key)
    for (const key of fresh) {
      if (expanded[key] !== true) actions.setExpanded(key, true)
    }
  }, [actions, current, expanded, forest, items])

  // Drop view state for workspaces that no longer exist.
  useEffect(() => {
    if (snapshot.phase !== 'ready') return
    actions.retainKeys(items.map((item) => item.workspaceId))
  }, [actions, items, snapshot.phase])

  // Host content search merges into the local name match.
  useEffect(() => {
    if (needle === '') {
      setRemote({ query: '', status: 'idle', items: [] })
      return undefined
    }
    const controller = new AbortController()
    setRemote({ query: needle, status: 'loading', items: [] })
    const timer = window.setTimeout(() => {
      searchSessions(needle, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemote({ query: needle, status: 'ready', items: result.items })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemote({ query: needle, status: 'error', items: [] })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [needle, searchSessions])

  const visible = useCallback((session) => session.origin !== 'subagent'
    && !archived.includes(session.id)
    && (session.blank !== true || session.id === current), [archived, current])

  const rowsOf = useCallback((view) => {
    const ids = frontPinned(
      reconcileOrder(view.sessionIds, sessionOrder[view.workspaceId], sessionList.byId),
      pinnedSessionIds,
    )
    // A blank provisional Session (the selected "New Session" row) keeps the
    // folder's first slot ahead of pinned rows: it is the conversation being
    // created, not history, and the shipped browser orders placeholders first.
    const blankId = ids.find((id) => sessionList.byId[id] !== undefined && sessionList.byId[id].blank === true)
    const orderedIds = blankId === undefined || ids[0] === blankId
      ? ids
      : [blankId].concat(ids.filter((id) => id !== blankId))
    const rows = []
    for (const id of orderedIds) {
      const session = sessionList.byId[id]
      if (session === undefined || !visible(session)) continue
      rows.push(session)
    }
    return rows
  }, [pinnedSessionIds, sessionList.byId, sessionOrder, visible])

  /**
   * Pin or unpin one Session through the Host. The row lands at the top of its
   * nearest folder on the next snapshot; no local order is written, so unpinning
   * restores the row's previous position.
   * @param sessionId - the Session to pin/unpin.
   * @param pinned - current pin state (decides the verb and the report name).
   */
  const togglePin = (sessionId, pinned) => {
    runAction(pinned ? TEXT.unpinAction : TEXT.pinAction, () => (
      pinned ? unpinSession(sessionId) : pinSession(sessionId)
    ))
  }

  /** Reorder one session inside its workspace (view order + durable Host order). */
  const moveSession = (workspaceId, rows, movedId, anchorId) => {
    const next = rows.map((row) => row.id).filter((id) => id !== movedId)
    const at = anchorId === undefined ? next.length : next.indexOf(anchorId)
    next.splice(at === -1 ? next.length : at, 0, movedId)
    actions.setSessionOrder(workspaceId, next)
    insertSessionBefore(workspaceId, movedId, anchorId).catch((reason) => {
      console.warn('session reorder rejected:', reason)
    })
  }

  /** Nested workspace rows: a header, its child workspaces, then its sessions. */
  const renderWorkspace = (view, depth, trail) => {
    const kids = forest.childrenOf.get(view.workspaceId) ?? []
    const rows = rowsOf(view)
    const up = forest.parent.get(view.workspaceId)
    const label = trail === undefined ? view.title : tailBelow(trail, view.path)
    const open = expanded[view.workspaceId] === true
    const containsCurrent = current !== undefined && view.sessionIds.includes(current)
    const indent = 8 + depth * INDENT_STEP
    const menuKey = 'w:' + view.workspaceId
    const menuOpen = menuOpenRow === menuKey
    const counts = [
      rows.length > 0 ? fmt(TEXT.countSessions, { n: rows.length }) : '',
      kids.length > 0 ? fmt(TEXT.countChildren, { n: kids.length }) : '',
    ].filter((part) => part !== '').join(' · ')
    const child = [
      <HoverCard
        key={view.workspaceId + ':head'}
        anchor={(
          <div
            className={css.workspaceRow + (menuOpen ? ' ' + css.menuOpenRow : '')}
            role="treeitem"
            aria-expanded={open}
            aria-level={depth + 1}
            data-nested={up === undefined ? undefined : 'true'}
            style={{ paddingLeft: indent + 'px' }}
            onClick={() => { actions.setExpanded(view.workspaceId, !open) }}
          >
            <span
              className={css.chevron}
              role="button"
              tabIndex={-1}
              aria-label={open ? TEXT.collapse : TEXT.expand}
              onClick={(event) => {
                event.stopPropagation()
                actions.setExpanded(view.workspaceId, !open)
              }}
            >
              <IconTriangleRightFill14 className={open ? css.arrowOpen : css.arrow} />
            </span>
            <span className={css.slot}>
              {open ? <IconFolderOpen16 size={15} /> : <IconFolderClose16 size={15} />}
            </span>
            <span
              className={css.title}
              style={containsCurrent ? { color: 'var(--dsw-alias-state-business-primary)' } : undefined}
            >
              {label}
            </span>
            <span className={css.rowActions}>
              <RowAction
                label={fmt(TEXT.subIn, { name: label })}
                title={TEXT.menuSub}
                onClick={() => { setSubTarget(view); setSubName(''); setSubError(null) }}
              >
                <IconProjectAddOutline16 size={16} />
              </RowAction>
              <RowAction
                label={fmt(TEXT.newSessionIn, { name: label })}
                title={fmt(TEXT.newSessionIn, { name: label })}
                onClick={() => { runAction(TEXT.newSession, () => startSession(view.workspaceId)) }}
              >
                <IconPlusOutline16 size={16} />
              </RowAction>
              <WorkspaceActions
                label={label}
                open={menuOpen}
                onOpenChange={(next) => { setMenuOpenRow(next ? menuKey : null) }}
                onSub={() => { setSubTarget(view); setSubName(''); setSubError(null) }}
                onRename={() => {
                  setRenameError(null)
                  setRenameTarget({ kind: 'workspace', view, title: view.title })
                  setRenameDraft(view.title)
                }}
                onDelete={() => { setDeleteError(null); setDeleteTarget(view) }}
              />
            </span>
          </div>
        )}
        content={(
          <div className={css.hoverCard}>
            <div className={css.hoverTitle}>{view.title}</div>
            <div className={css.hoverPath}>{view.path}</div>
            <div className={css.hoverTime}>{counts}</div>
            <div className={css.hoverTime}>
              {fmt(TEXT.hoverCreated, { time: absoluteTime(Date.parse(view.createdAt)) })}
            </div>
          </div>
        )}
        copyText={view.path}
        copyLabel={TEXT.copy}
        copiedLabel={TEXT.copied}
      />,
    ]
    // A nested row keeps the indentation ladder plus a guide rail drawn by CSS;
    // the full path lives in the hover card, so no inline second line is spent.
    if (up !== undefined && depth <= GUIDE_MAX_DEPTH) {
      child.push(
        <span
          key={view.workspaceId + ':guide'}
          className={css.guide}
          style={{ left: (indent - INDENT_STEP / 2) + 'px' }}
          aria-hidden="true"
        />,
      )
    }
    if (open) {
      for (const kid of kids) child.push(renderWorkspace(kid, depth + 1, view.path))
      for (const session of rows) {
        const status = statusOf(session, session.id === current)
        const title = session.blank === true ? TEXT.newSession : session.displayTitle
        const marker = drag !== null && drag.workspaceId === view.workspaceId
          && dropAt !== null && dropAt.id === session.id
          ? dropAt
          : null
        const pinned = pinnedSet.has(session.id)
        const sessionMenuKey = 's:' + session.id
        child.push(
          <div
            key={session.id}
            className={css.sessionRow
              + (session.id === current ? ' ' + css.sessionRowCurrent : '')
              + (menuOpenRow === sessionMenuKey ? ' ' + css.menuOpenRow : '')
              + (marker !== null && marker.half === 'before' ? ' ' + css.dropBefore : '')
              + (marker !== null && marker.half === 'after' ? ' ' + css.dropAfter : '')}
            role="treeitem"
            aria-selected={session.id === current}
            aria-level={depth + 2}
            style={{ paddingLeft: indent + 'px' }}
            draggable={session.blank !== true}
            onDragStart={() => { setDrag({ workspaceId: view.workspaceId, sessionId: session.id }) }}
            onDragOver={(event) => {
              if (drag === null || drag.workspaceId !== view.workspaceId) return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
              setDropAt({ id: session.id, half })
            }}
            onDrop={(event) => {
              if (drag === null || drag.workspaceId !== view.workspaceId || dropAt === null) return
              event.preventDefault()
              const index = rows.findIndex((row) => row.id === dropAt.id)
              const anchor = dropAt.half === 'before' ? dropAt.id : rows[index + 1]?.id
              if (anchor !== drag.sessionId) moveSession(view.workspaceId, rows, drag.sessionId, anchor)
              setDrag(null)
              setDropAt(null)
            }}
            onDragEnd={() => { setDrag(null); setDropAt(null) }}
            onClick={() => { runAction(TEXT.openSessionAction, () => openSession(session.id)) }}
          >
            <span className={css.slot}>
              {status === null ? null : <StateDot state={status.state} />}
            </span>
            <span className={css.sessionTitle}>{title}</span>
            {session.blank === true ? null : (
              <span className={css.time}>{relTime(session.updatedAt, now)}</span>
            )}
            {session.blank === true || !pinSupported || !pinned ? null : (
              <span
                className={css.pinIndicator}
                role="img"
                aria-label={TEXT.pinnedBadge}
                title={TEXT.pinnedBadge}
              >
                {IconPinFill === null ? null : <IconPinFill size={14} />}
              </span>
            )}
            {session.blank === true ? null : (
              <span className={css.rowActions}>
                <SessionActions
                  title={title}
                  open={menuOpenRow === sessionMenuKey}
                  onOpenChange={(next) => { setMenuOpenRow(next ? sessionMenuKey : null) }}
                  pinSupported={pinSupported}
                  pinned={pinned}
                  onTogglePin={() => { togglePin(session.id, pinned) }}
                  onRename={() => {
                    setRenameError(null)
                    setRenameTarget({ kind: 'session', session, title })
                    setRenameDraft(session.displayTitle)
                  }}
                  onFork={() => { runAction(TEXT.menuFork, () => forkSession(session.id)) }}
                  onArchive={() => { runAction(TEXT.menuArchiveSession, () => archiveSession(session.id)) }}
                />
              </span>
            )}
          </div>,
        )
      }
      if (rows.length === 0 && kids.length === 0) {
        child.push(
          <div
            key={view.workspaceId + ':empty'}
            className={css.empty}
            style={{ paddingLeft: (indent + 22) + 'px' }}
          >
            {TEXT.sessionsNone}
          </div>,
        )
      }
    }
    return <div key={view.workspaceId} className={css.group}>{child}</div>
  }

  /** Flatten the forest for search, keeping each row's depth for indentation. */
  const flatten = (view, depth, trail, out) => {
    out.push({ view, depth, trail, rows: rowsOf(view) })
    for (const kid of forest.childrenOf.get(view.workspaceId) ?? []) flatten(kid, depth + 1, view.path, out)
    return out
  }

  /** Search-row status dot: same active-only rule as the tree rows. */
  const hitStatus = (session) => statusOf(session, session.id === current)

  let body
  if (needle !== '') {
    const sequence = []
    for (const root of forest.roots) flatten(root, 0, undefined, sequence)
    const lower = needle.toLowerCase()
    const snippetBySession = new Map()
    for (const item of remote.query === needle ? remote.items : []) {
      if (!snippetBySession.has(item.sessionId)) snippetBySession.set(item.sessionId, item.snippet)
    }
    const hits = []
    for (const entry of sequence) {
      const view = entry.view
      const nameHit = view.title.toLowerCase().includes(lower) || view.path.toLowerCase().includes(lower)
      const matched = nameHit ? entry.rows : entry.rows.filter((session) => (
        session.blank !== true && session.displayTitle.toLowerCase().includes(lower)
      ))
      const matchedIds = new Set(matched.map((session) => session.id))
      const contentOnly = entry.rows.filter((session) => (
        session.blank !== true && snippetBySession.has(session.id) && !matchedIds.has(session.id)
      ))
      if (nameHit || matched.length > 0 || contentOnly.length > 0) {
        hits.push({ entry, rows: matched.concat(contentOnly), nameHit })
      }
    }
    body = hits.length === 0
      ? <div className={css.empty}>{TEXT.searchNone}</div>
      : hits.map(({ entry, rows, nameHit }) => (
        <div key={entry.view.workspaceId + ':hit'} className={css.group}>
          <div className={css.workspaceRow} style={{ paddingLeft: (8 + entry.depth * INDENT_STEP) + 'px' }}>
            <span className={css.slot}><IconFolderClose16 size={16} /></span>
            <span className={css.chevron} />
            <span className={css.title}>
              {entry.trail === undefined ? entry.view.title : tailBelow(entry.trail, entry.view.path)}
            </span>
            <span className={css.meta}>{nameHit ? entry.view.path : ''}</span>
          </div>
          {rows.map((session) => (
            <div
              key={session.id}
              className={css.sessionRow + (session.id === current ? ' ' + css.sessionRowCurrent : '')}
              style={{ paddingLeft: (30 + entry.depth * INDENT_STEP) + 'px' }}
              onClick={() => { runAction(TEXT.openSessionAction, () => openSession(session.id)) }}
            >
              <span className={css.slot}>
                {hitStatus(session) === null ? null : <StateDot state={hitStatus(session).state} />}
              </span>
              <span className={css.sessionTitle}>{session.displayTitle}</span>
              <span className={css.snippet}>{snippetBySession.get(session.id) ?? ''}</span>
            </div>
          ))}
        </div>
      ))
    if (remote.status === 'loading') body = <div className={css.empty}>{TEXT.searchPending}</div>
  } else if (items.length === 0) {
    body = <div className={css.empty}>{snapshot.phase === 'ready' ? TEXT.empty : TEXT.loading}</div>
  } else {
    body = forest.roots.map((root) => renderWorkspace(root, 0, undefined))
  }

  /** Adopt a Host path as a workspace, then open one of its sessions. */
  const adopt = (path) => createWorkspace({ path }).then((created) => {
    setAddOpen(false)
    setAddPath('')
    // The workspace exists now; a failure to open its first Session must not
    // read as "adding the workspace failed", so it reports separately.
    try {
      startSession(created.workspaceId)
    } catch (reason) {
      setNotice(fmt(TEXT.noticeFailed, { action: TEXT.newSession, reason: reasonText(reason) }))
    }
  })

  const submitAdd = () => {
    if (addBusy || addPath.trim() === '') return
    setAddBusy(true)
    setAddError(null)
    adopt(addPath.trim()).catch((reason) => {
      setAddError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setAddBusy(false) })
  }

  /** Open the system directory picker through the injected region verb. */
  const chooseDirectory = () => {
    if (addBusy) return
    setAddBusy(true)
    setAddError(null)
    Promise.resolve().then(() => pickDirectory()).then((path) => {
      if (path === null || path === undefined) return undefined
      return adopt(path)
    }).catch((reason) => {
      setAddError(reasonText(reason))
    }).finally(() => { setAddBusy(false) })
  }

  const submitSub = () => {
    if (subTarget === null || subBusy) return
    const name = subName.trim()
    if (name === '' || name.includes('/') || name.includes('\\')) {
      setSubError(TEXT.subBadName)
      return
    }
    setSubBusy(true)
    setSubError(null)
    const parent = subTarget
    createChildWorkspace(parent, name)
      .then((created) => {
        setSubTarget(null)
        actions.setExpanded(parent.workspaceId, true)
        try {
          startSession(created.workspaceId)
        } catch (reason) {
          setNotice(fmt(TEXT.noticeFailed, { action: TEXT.newSession, reason: reasonText(reason) }))
        }
      })
      .catch((reason) => { setSubError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setSubBusy(false) })
  }

  const submitRename = () => {
    if (renameTarget === null || renaming) return
    const title = renameDraft.trim()
    if (title === '') return
    setRenaming(true)
    setRenameError(null)
    const done = renameTarget.kind === 'session'
      ? renameSession(renameTarget.session.id, title)
      : renameWorkspace(renameTarget.view.workspaceId, title)
    Promise.resolve(done).then(() => { setRenameTarget(null) })
      .catch((reason) => { setRenameError(reasonText(reason)) })
      .finally(() => { setRenaming(false) })
  }

  const submitDelete = () => {
    if (deleteTarget === null || deleting) return
    setDeleting(true)
    setDeleteError(null)
    Promise.resolve(deleteWorkspace(deleteTarget.workspaceId)).then(() => { setDeleteTarget(null) })
      .catch((reason) => { setDeleteError(reasonText(reason)) })
      .finally(() => { setDeleting(false) })
  }

  if (!wide) {
    return (
      <div className={css.root + ' ' + css.rail}>
        <div className={css.railColumn}>
          <Tooltip label={TEXT.searchPlaceholder} side="right">
            <button
              type="button"
              className={css.railButton}
              aria-label={TEXT.searchPlaceholder}
              onClick={() => { expandSidebar() }}
            >
              <IconSearchOutline16 size={18} />
            </button>
          </Tooltip>
          <Tooltip label={TEXT.addWorkspace} side="right">
            <button
              type="button"
              className={css.railButton}
              aria-label={TEXT.addWorkspace}
              onClick={() => { expandSidebar(); setAddOpen(true) }}
            >
              <IconProjectAddOutline16 size={18} />
            </button>
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.sectionHeader}>
        <span className={css.sectionLabel}>{TEXT.section}</span>
        <div className={css.searchSlot}>
          <IconSearchOutline16 size={14} className={css.searchGlyph} />
          <input
            className={css.searchInput}
            type="text"
            value={query}
            placeholder={TEXT.searchPlaceholder}
            aria-label={TEXT.searchPlaceholder}
            onChange={(event) => { setQuery(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
          />
          {query === '' ? null : (
            <button
              type="button"
              className={css.iconButton}
              aria-label={TEXT.close}
              onClick={() => { setQuery('') }}
            >
              <IconCloseFill14 size={12} />
            </button>
          )}
        </div>
        <Tooltip label={TEXT.addWorkspace} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={TEXT.addWorkspace}
            onClick={() => { setAddOpen(true) }}
          >
            <IconProjectAddOutline16 size={16} />
          </button>
        </Tooltip>
      </div>

      {notice === null ? null : (
        <div className={css.notice} role="alert">
          <span className={css.noticeText}>{notice}</span>
          <button
            type="button"
            className={css.iconButton}
            aria-label={TEXT.close}
            onClick={() => { setNotice(null) }}
          >
            <IconCloseFill14 size={12} />
          </button>
        </div>
      )}

      <div className={css.listArea}>
        <div className={css.list} role="tree" aria-label={TEXT.section}>{body}</div>
      </div>

      <Modal
        open={addOpen}
        onClose={() => { if (!addBusy) setAddOpen(false) }}
        closeLabel={TEXT.close}
        title={TEXT.addWorkspace}
        footer={(
          <>
            <Button variant="outline" disabled={addBusy} onClick={() => { setAddOpen(false) }}>{TEXT.cancel}</Button>
            <Button variant="outline" disabled={addBusy} onClick={chooseDirectory}>{TEXT.addPick}</Button>
            <Button variant="primary" disabled={addBusy || addPath.trim() === ''} onClick={submitAdd}>
              {addBusy ? TEXT.addBusy : TEXT.addCommit}
            </Button>
          </>
        )}
      >
        <div className={css.dialogBody}>
          <p className={css.dialogHint}>{TEXT.addHint}</p>
          <input
            className={css.dialogInput}
            value={addPath}
            aria-label={TEXT.addPathLabel}
            placeholder={TEXT.addPathPlaceholder}
            autoFocus
            disabled={addBusy}
            onChange={(event) => { setAddPath(event.target.value); setAddError(null) }}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !composing.current) {
                event.preventDefault()
                submitAdd()
              }
            }}
          />
          {addError === null ? null : <div className={css.dialogError} role="alert">{addError}</div>}
        </div>
      </Modal>

      <Modal
        open={subTarget !== null}
        onClose={() => { if (!subBusy) setSubTarget(null) }}
        closeLabel={TEXT.close}
        title={TEXT.subTitle}
        footer={(
          <>
            <Button variant="outline" disabled={subBusy} onClick={() => { setSubTarget(null) }}>{TEXT.cancel}</Button>
            <Button variant="primary" disabled={subBusy || subName.trim() === ''} onClick={submitSub}>
              {subBusy ? TEXT.subBusy : TEXT.subCommit}
            </Button>
          </>
        )}
      >
        <div className={css.dialogBody}>
          <p className={css.dialogHint}>{TEXT.subHint}</p>
          <p className={css.dialogPath}>{subTarget === null ? '' : subTarget.path + '/'}</p>
          <input
            className={css.dialogInput}
            value={subName}
            aria-label={TEXT.subNameLabel}
            placeholder={TEXT.subNameLabel}
            autoFocus
            disabled={subBusy}
            onChange={(event) => { setSubName(event.target.value); setSubError(null) }}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !composing.current) {
                event.preventDefault()
                submitSub()
              }
            }}
          />
          {subError === null ? null : <div className={css.dialogError} role="alert">{subError}</div>}
        </div>
      </Modal>

      <Modal
        open={renameTarget !== null}
        onClose={() => { if (!renaming) setRenameTarget(null) }}
        closeLabel={TEXT.close}
        title={renameTarget !== null && renameTarget.kind === 'session' ? TEXT.renameSession : TEXT.renameWorkspace}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={() => { setRenameTarget(null) }}>{TEXT.cancel}</Button>
            <Button variant="primary" disabled={renaming || renameDraft.trim() === ''} onClick={submitRename}>{TEXT.rename}</Button>
          </>
        )}
      >
        <input
          className={css.dialogInput}
          value={renameDraft}
          aria-label={renameTarget !== null && renameTarget.kind === 'session' ? TEXT.sessionNameField : TEXT.workspaceNameField}
          autoFocus
          disabled={renaming}
          onFocus={(event) => { event.target.select() }}
          onChange={(event) => { setRenameDraft(event.target.value) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composing.current) {
              event.preventDefault()
              submitRename()
            }
          }}
        />
        {renameError === null ? null : <div className={css.dialogError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
        closeLabel={TEXT.close}
        title={TEXT.deleteWorkspace}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={() => { setDeleteTarget(null) }}>{TEXT.cancel}</Button>
            <Button variant="primary" disabled={deleting} onClick={submitDelete}>{TEXT.delete}</Button>
          </>
        )}
      >
        <p className={css.dialogHint}>
          {deleteTarget === null ? '' : fmt(TEXT.deleteDesc, { name: deleteTarget.title })}
        </p>
        {deleteError === null ? null : <div className={css.dialogError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  )
}

/**
 * Client plugin body: register the nested browser into `sidebar.workspaces`.
 * @param ctx - client root context carrying the slots, workspaces, and sessions services.
 */
export function apply(ctx) {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces')
  const sessions = ctx.get('sessions')
  if (slots === undefined || workspaces === undefined || sessions === undefined) return

  // Two client generations, one bundle. 0.2 hangs the region verbs off a single
  // `uiWorkspace` service (`openSession` / `startSession` / `pickDirectory` /
  // `createDirectory`; `openSession` also replaced `sessions.open`), while 0.1
  // keeps them on the workspace and session controller faces. Two properties
  // make the probe LAZY rather than eager:
  //   - `uiWorkspace` is not in the store yet while this fiber activates
  //     (measured: undefined at apply time, an object two seconds later), so an
  //     eager read would resolve nothing, forever;
  //   - `ctx.get` returns undefined for a service a composition never provides,
  //     so probing per call is free on either generation.
  /** The 0.2 region service, read at call time. */
  const region = () => ctx.get('uiWorkspace')
  const verbs = {
    startSession: () => firstMethod('startSession', region(), workspaces),
    openSession: () => firstMethod('openSession', region()) ?? firstMethod('open', sessions),
    pickDirectory: () => firstMethod('pickDirectory', region(), workspaces),
    createDirectory: () => firstMethod('createDirectory', region(), workspaces),
    createWorkspace: () => firstMethod('create', workspaces),
    renameWorkspace: () => firstMethod('rename', workspaces),
    deleteWorkspace: () => firstMethod('delete', workspaces),
    archiveSession: () => firstMethod('archiveSession', workspaces, region()),
    insertSessionBefore: () => firstMethod('insertSessionBefore', workspaces),
    forkSession: () => firstMethod('fork', sessions),
    pinSession: () => firstMethod('pinSession', region(), workspaces),
    unpinSession: () => firstMethod('unpinSession', region(), workspaces),
    binding: () => firstMethod('binding', sessions),
    using: () => firstMethod('using', sessions),
    searchSessions: () => firstMethod('search', sessions),
  }
  /**
   * Resolve one verb now, or fail with the capability's own name.
   * @param name - key into `verbs`.
   * @returns the bound method.
   */
  const verb = (name) => requireVerb(name, verbs[name]())

  const injected = () => ({
    startSession: (workspaceId) => { verb('startSession')(workspaceId) },
    openSession: (sessionId) => { verb('openSession')(sessionId) },
    pickDirectory: () => verb('pickDirectory')(),
    renameSession: async (sessionId, title) => {
      // 0.2 renames through a RETAINED reference: `sessions.binding` only
      // answers for a generation the Client already holds, so asking it about
      // an ordinary listed row reports "unknown session". `sessions.using`
      // acquires the generation for the duration of the call instead. 0.1 has
      // no `using` and hands the binding over directly.
      const using = verbs.using()
      if (using !== undefined) {
        const result = await using(
          sessionId,
          { source: 'workspaceOperation' },
          (reference) => reference.binding.session.rename(title),
        )
        if (result.ok !== true) throw new Error(result.error.message)
        return
      }
      const binding = verb('binding')(sessionId)
      const session = binding === undefined ? undefined : binding.session
      if (session === undefined) throw new Error('unknown session "' + String(sessionId) + '"')
      const result = await session.rename(title)
      if (result.ok !== true) throw new Error(result.error.message)
    },
    pinSession: async (sessionId) => { await verb('pinSession')(sessionId) },
    unpinSession: async (sessionId) => { await verb('unpinSession')(sessionId) },
    forkSession: (sessionId) => {
      const fork = verb('forkSession')
      // Resolve the open verb up front as well: a generation that cannot open
      // the child must fail before a fork leaves an unselected child behind.
      const open = verb('openSession')
      // A child-rename failure after the fork is reported rather than swallowed:
      // the operator asked for a new conversation and needs to know it is not
      // the one now selected.
      return Promise.resolve(fork({ sessionId, increaseTitle: true }))
        .then((childId) => { open(childId) })
    },
    archiveSession: async (sessionId) => { await verb('archiveSession')(sessionId) },
    renameWorkspace: async (workspaceId, title) => {
      await verb('renameWorkspace')(workspaceId, title)
    },
    deleteWorkspace: async (workspaceId) => { await verb('deleteWorkspace')(workspaceId) },
    createWorkspace: (input) => verb('createWorkspace')(input),
    adoptWorkspace: (path) => verb('createWorkspace')({ path }),
    /**
     * Create a child workspace directory and adopt it. The host route runs the
     * real filesystem capability; the fallback keeps the region usable when the
     * host half is absent (a browser-only composition).
     */
    createChildWorkspace: async (parent, name) => {
      const response = await fetch(CREATE_CHILD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: parent.workspaceId, name }),
      })
      if (response.status === 404 || response.status === 405) {
        // No host route in this composition: fall back to the picker route.
        const createdPath = await verb('createDirectory')(parent.path, name)
        const adopted = await verb('createWorkspace')({ path: createdPath })
        return { workspaceId: adopted.workspaceId }
      }
      const body = await response.json().catch(() => null)
      if (body === null || body.ok !== true) {
        throw new Error(body === null || typeof body.error !== 'string'
          ? '创建子工作区失败（HTTP ' + String(response.status) + '）'
          : body.error)
      }
      return { workspaceId: String(body.workspaceId) }
    },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await verb('insertSessionBefore')(workspaceId, sessionId, beforeSessionId)
    },
    searchSessions: async (searchQuery, signal) => {
      const result = await verb('searchSessions')(searchQuery, signal)
      if (result.ok !== true) throw new Error(result.error.message)
      return result.value
    },
    searchResultLimit: ctx.sessions.searchResultLimit,
  })

  slots.inject('sidebar.workspaces', () => slots.register(
    {
      name: 'sidebar.workspaces',
      priority: -1,
      store: createWorkspaceTreeStore(),
      inject: injected,
    },
    WorkspaceTree,
  ))
}
