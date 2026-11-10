/**
 * Host half of `dsh-workspace-nest`.
 *
 * It exists for exactly one reason: creating a sub-workspace's directory.
 *
 * The client-side route to that is `ctx.workspaces.createDirectory`, which asks
 * the composed directory-picker backend for its `createDirectory` capability. A
 * deployment composing the NATIVE picker (macOS `osascript`, for instance) only
 * serves `pick`, so that call fails with `directory-picker-unavailable` — and
 * sub-workspace creation would be dead on exactly the deployments whose picker
 * is a native dialog. The browser half therefore calls this host route first
 * and falls back to the workspace service only when the route is unreachable.
 *
 * Transport: one JSON POST route on the composing webserver, the same shape the
 * deployment's other system-level client plugins use. A profile row cannot open
 * a Package-private RPC channel (`harness` belongs to the dynamic plugin
 * sandbox), so a named route is the seam.
 *
 *   POST <prefix>/create   { workspaceId, name }
 *     → { ok: true, workspaceId, path, created }
 *     → { ok: false, error }
 *
 * The handler owns every guard: the name must be one plain path segment, and
 * the created path must stay inside the parent workspace's own directory.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** Route prefix owned by this package. */
const PREFIX = '/dsh-workspace-nest'

/** Empty-directory marker written into a folder this package creates. */
const MARKER = '.dsh-workspace-nest'

/** Largest accepted request body. */
const MAX_BODY_BYTES = 4096

/**
 * Validate an operator-supplied folder name.
 * @param name - request value.
 * @returns the trimmed name when it is one plain path segment.
 */
function requireSegment(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') throw new Error('子工作区名称不能为空')
  if (trimmed === '.' || trimmed === '..') throw new Error('子工作区名称不能是 "." 或 ".."')
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\u0000')) {
    throw new Error('子工作区名称不能包含路径分隔符')
  }
  return trimmed
}

/**
 * Read one JSON request body within a fixed bound.
 * @param req - incoming request.
 * @returns the parsed body, or an empty object for an empty body.
 */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/**
 * Write one JSON response.
 * @param res - response to write.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length })
  res.end(payload)
}

/**
 * Mount the host half: wait for the composing services, then register the
 * sub-workspace creation route.
 *
 * A home-patch row can activate before the web-app bundle provides its
 * services, so registration happens inside `ctx.inject`, whose callback runs on
 * a child context where both names are real properties.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'workspaceRegistry'], (readyCtx) => {
    const server = readyCtx.webServer
    const registry = readyCtx.workspaceRegistry

    const handler = async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'use POST' })
        return
      }
      try {
        const body = await readJson(req)
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : ''
        if (workspaceId === '') throw new Error('缺少 workspaceId')
        const name = requireSegment(body.name)

        const parent = registry.get(workspaceId)
        if (parent === undefined) throw new Error('找不到该工作区：' + workspaceId)

        const target = resolve(join(parent.path, name))
        // Containment: the created directory must live inside the parent's own
        // directory, so a forged id/name pair can never write elsewhere.
        const parentPrefix = parent.path.endsWith(sep) ? parent.path : parent.path + sep
        if (target !== parent.path && !target.startsWith(parentPrefix)) {
          throw new Error('目标路径超出父工作区目录')
        }

        const known = await stat(target).then(info => info, () => undefined)
        if (known !== undefined && !known.isDirectory()) {
          throw new Error('同名文件已存在，无法创建目录：' + target)
        }
        if (known === undefined) {
          await mkdir(target, { recursive: true })
          // An empty directory is invisible to some tooling (and to git); the
          // marker keeps the created folder legible without carrying any state.
          await writeFile(join(target, MARKER), '', { flag: 'a' })
        }

        const workspace = await registry.create(target)
        sendJson(res, 200, {
          ok: true,
          workspaceId: workspace.id,
          path: workspace.path,
          created: known === undefined,
        })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    readyCtx.effect(
      () => server.register({ kind: 'prefix', path: PREFIX, handler }),
      'workspace-tree: create-child route',
    )
  })
}
