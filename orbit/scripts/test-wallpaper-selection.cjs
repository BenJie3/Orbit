// Pruebas del parser sin iniciar Electron. Compatible con Node 20.18.0.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const archivo = path.join(__dirname, '../src/main/wallpaper-selection.ts')
const compilado = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', compilado)(mod, mod.exports)
const { seleccionarWallpaperEngine } = mod.exports

const base = {
  steamuser: {
    general: {
      browser: { lastselectedmonitor: 'monitor-2' },
      wallpaperconfig: {
        selectedwallpapers: {
          'monitor-1': { file: 'C:\\Wallpaper\\azul\\project.json' },
          'monitor-2': { file: 'D:\\Wallpaper\\verde\\project.json' }
        }
      }
    }
  }
}
assert.deepEqual(seleccionarWallpaperEngine(base), {
  archivo: 'D:\\Wallpaper\\verde\\project.json', monitor: 'monitor-2'
})
assert.deepEqual(
  seleccionarWallpaperEngine({ selectedwallpapers: { MAIN: { wallpaper: { file: 'C:/active.mp4' } } } }),
  { archivo: 'C:/active.mp4', monitor: 'MAIN' }
)
assert.equal(
  seleccionarWallpaperEngine({
    steamuser: { general: { wallpaperconfig: {
      selectedwallpapers: { MAIN: { playlist: { items: [{ file: 'C:/old-pink.mp4' }] } } }
    } } }
  }),
  null,
  'No seleccionar un elemento antiguo de playlist'
)
assert.equal(seleccionarWallpaperEngine({ history: [{ file: 'C:/old.png' }] }), null)
assert.equal(seleccionarWallpaperEngine(null), null)
console.log('[Orbit] Pruebas de selección de fondo superadas (5 casos).')
