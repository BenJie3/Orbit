// Selección de fondo a partir de la configuración de Wallpaper Engine.
// Sin dependencias de Electron: permite pruebas unitarias en Node 20.
type Registro = Record<string, unknown>

const objeto = (v: unknown): v is Registro => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const campo = (v: unknown, ...keys: string[]): unknown => {
  let current = v
  for (const key of keys) {
    if (!objeto(current)) return undefined
    current = current[key]
  }
  return current
}

export interface WallpaperSeleccionado {
  archivo: string
  monitor: string
}

// Las listas de reproducción contienen archivos que NO son necesariamente el activo.
// No se debe escoger por accidente el primer elemento de playlist.items.
function archivoActual(entrada: unknown, nivel = 0): string | null {
  if (nivel > 5 || !objeto(entrada)) return null
  if (typeof entrada.file === 'string' && entrada.file.trim()) return entrada.file.trim()

  const camposActuales = [
    'currentwallpaper', 'currentWallpaper', 'activewallpaper', 'activeWallpaper',
    'selectedwallpaper', 'selectedWallpaper', 'wallpaper', 'current', 'active', 'selected'
  ]
  for (const key of camposActuales) {
    const encontrado = archivoActual(entrada[key], nivel + 1)
    if (encontrado) return encontrado
  }
  // Algunos formatos de configuración anidan una instancia bajo settings.
  // Excluir historiales, previews y playlist para no elegir wallpapers inactivos.
  for (const [key, value] of Object.entries(entrada)) {
    if (/^(playlist|playlists|items|history|recent|recentwallpapers|wallpaperhistory|file)$/i.test(key)) {
      continue
    }
    if (!objeto(value)) continue
    const encontrado = archivoActual(value, nivel + 1)
    if (encontrado) return encontrado
  }
  return null
}

export function seleccionarWallpaperEngine(config: unknown): WallpaperSeleccionado | null {
  const seleccionados =
    campo(config, 'steamuser', 'general', 'wallpaperconfig', 'selectedwallpapers') ??
    campo(config, 'steamuser', 'wallpaperconfig', 'selectedwallpapers') ??
    campo(config, 'wallpaperconfig', 'selectedwallpapers') ??
    campo(config, 'selectedwallpapers')
  if (!objeto(seleccionados)) return null

  const monitorPreferido = campo(config, 'steamuser', 'general', 'browser', 'lastselectedmonitor')
  const entradas = Object.entries(seleccionados)
  if (!entradas.length) return null

  // Priorizar el monitor activo seleccionado en Wallpaper Engine.
  if (typeof monitorPreferido === 'string' && Object.prototype.hasOwnProperty.call(seleccionados, monitorPreferido)) {
    const archivo = archivoActual(seleccionados[monitorPreferido])
    if (archivo) return { archivo, monitor: monitorPreferido }
  }

  for (const [monitor, entrada] of entradas) {
    const archivo = archivoActual(entrada)
    if (archivo) return { archivo, monitor }
  }
  return null
}
