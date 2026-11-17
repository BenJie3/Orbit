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
// Formato documentado: { "?installdirectory": "...", "<usuario-Windows>": { general: ... } }.
const real = {
  '?installdirectory': 'C:/Steam/steamapps/common/wallpaper_engine',
  'CuentaAnterior': {
    general: {
      wallpaperconfig: { selectedwallpapers: { MON1: { file: 'D:/viejo/project.json' } } }
    }
  },
  'CuentaActual': {
    general: {
      browser: { lastselectedmonitor: 'MON2' },
      wallpaperconfig: {
        selectedwallpapers: {
          MON1: { file: 'D:/nuevo/azul/project.json' },
          MON2: { file: 'D:/nuevo/verde/project.json' }
        },
        profile: null
      },
      profiles: [{ selectedwallpapers: { MON2: { file: 'D:/rosa-antiguo/project.json' } } }]
    }
  }
}
assert.deepEqual(seleccionarWallpaperEngine(real, 'CuentaActual'), {
  archivo: 'D:/nuevo/verde/project.json', monitor: 'MON2'
})
assert.deepEqual(seleccionarWallpaperEngine(real, 'cuentaactual', 'MON1'), {
  archivo: 'D:/nuevo/azul/project.json', monitor: 'MON1'
})
assert.deepEqual(seleccionarWallpaperEngine(real, 'CuentaAnterior'), {
  archivo: 'D:/viejo/project.json', monitor: 'MON1'
})
assert.deepEqual(seleccionarWallpaperEngine(real), {
  archivo: 'D:/viejo/project.json', monitor: 'MON1'
})
assert.equal(
  seleccionarWallpaperEngine({
    'CuentaActual': {
      general: {
        wallpaperconfig: { selectedwallpapers: { MON1: { playlist: { items: [{ file: 'D:/inactivo.mp4' }] } } } },
        profiles: [{ selectedwallpapers: { MON1: { file: 'D:/perfil-inactivo.mp4' } } }]
      }
    }
  }, 'CuentaActual'),
  null
)
assert.equal(
  seleccionarWallpaperEngine({
    CuentaActual: { general: { wallpaperconfig: { selectedwallpapers: { MAIN: { file: 'D:/activo.mp4' } } } } }
  }, 'CuentaActual')?.archivo,
  'D:/activo.mp4'
)
console.log('[Orbit] Pruebas de selección de fondo superadas (11 casos).')
