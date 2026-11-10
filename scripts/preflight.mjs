/** Guard rail for `npm publish`: a stale bundle or a missing bundle patch must fail here. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const problems = []
const require_ = (ok, message) => { if (!ok) problems.push(message) }

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
require_(pkg.private !== true, 'package.json still has "private": true')
require_(typeof pkg.engines?.dsh === 'string', 'package.json must declare engines.dsh')
require_(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json must declare dsh.bundle.patch')
require_(typeof pkg.dsh?.client?.platform === 'string', 'package.json must declare dsh.client.platform')
require_(typeof pkg.repository?.url === 'string' && !pkg.repository.url.includes('OWNER'), 'repository.url is a placeholder')

const client = readFileSync(join(pkgDir, 'client.js'), 'utf8')
require_(client.includes('id: ' + JSON.stringify(pkg.name)), 'client.js module id does not match the package name - run npm run build')
const patch = readFileSync(join(pkgDir, 'cordis.patch.yml'), 'utf8')
require_(patch.includes('name: ' + pkg.name), 'cordis.patch.yml must mount the package by its own name')
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'icon.png']) {
  try { readFileSync(join(pkgDir, file)) } catch { problems.push('missing file: ' + file) }
}
if (problems.length > 0) {
  console.error('preflight failed:')
  for (const problem of problems) console.error('  ✗ ' + problem)
  process.exit(1)
}
console.log('preflight: OK — ' + pkg.name + '@' + pkg.version)
