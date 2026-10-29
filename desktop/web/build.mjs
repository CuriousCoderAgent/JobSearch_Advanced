// Bundles the online server: web/server.ts plus the desktop main process it
// reuses, with 'electron' swapped for web/electron-shim.ts. Packages stay in
// node_modules and load at run time.
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8'))
const packages = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n !== 'electron')

await build({
  entryPoints: [here('./server.ts')],
  outfile: here('./dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  alias: { electron: here('./electron-shim.ts') },
  external: [...packages, ...packages.map((n) => `${n}/*`), 'puppeteer-core'],
  logLevel: 'info'
})
