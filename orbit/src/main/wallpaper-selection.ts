// Parser conservador de la configuración activa de Wallpaper Engine.
// No recorre perfiles guardados, historial ni elementos inactivos de playlists.
type Objeto = Record<string, unknown>

const esObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

const obtener = (base: unknown, ...claves: string[]): unknown => {
  let actual = base
  for (const clave of claves) {
    if (!esObjeto(actual)) return undefined
    actual = actual[clave]
  }
  return actual
}

export interface WallpaperSeleccionado {
  archivo: string
  monitor: string
}

function archivoActivo(entrada: unknown, profundidad = 0): string | null {
  if (typeof entrada === 'string') return entrada.trim() || null
  if (!esObjeto(entrada) || profundidad > 5) return null
  if (typeof entrada.file === 'string' && entrada.file.trim()) return entrada.file.trim()

  for (const clave of [
    'currentWallpaper', 'currentwallpaper',
    'activeWallpaper', 'activewallpaper',
    'selectedWallpaper', 'selectedwallpaper',
    'wallpaper', 'current', 'active'
  ]) {
    const archivo = archivoActivo(entrada[clave], profundidad + 1)
    if (archivo) return archivo
  }

  // Nunca elegir una entrada de playlist sin saber cuál está reproduciéndose.
  return null
}

function seleccionDeUsuario(bloque: unknown, monitor?: string): WallpaperSeleccionado | null {
  const seleccionados = obtener(bloque, 'general', 'wallpaperconfig', 'selectedwallpapers')
    ?? obtener(bloque, 'wallpaperconfig', 'selectedwallpapers')
    ?? obtener(bloque, 'selectedwallpapers')
  if (!esObjeto(seleccionados)) return null

  const preferido = monitor || obtener(bloque, 'general', 'browser', 'lastselectedmonitor')
  if (typeof preferido === 'string' && Object.prototype.hasOwnProperty.call(seleccionados, preferido)) {
    const archivo = archivoActivo(seleccionados[preferido])
    if (archivo) return { archivo, monitor: preferido }
  }
  for (const [id, entrada] of Object.entries(seleccionados)) {
    const archivo = archivoActivo(entrada)
    if (archivo) return { archivo, monitor: id }
  }
  return null
}

export function seleccionarWallpaperEngine(
  config: unknown,
  usuarioWindows?: string,
  monitorPreferido?: string
): WallpaperSeleccionado | null {
  if (!esObjeto(config)) return null

  // Compatibilidad con archivos de configuración que omiten la cuenta.
  const directo = seleccionDeUsuario(config, monitorPreferido)
  if (directo) return directo

  // Clave principal real: nombre de cuenta de Windows (no 'steamuser' fijo).
  const cuentas = Object.entries(config)
    .filter(([, valor]) => esObjeto(valor) && esObjeto(valor.general))
  if (!cuentas.length) return null

  const cuentaActual = cuentas.find(([nombre]) =>
    typeof usuarioWindows === 'string' && nombre.toLowerCase() === usuarioWindows.toLowerCase()
  )
  if (cuentaActual) {
    const seleccion = seleccionDeUsuario(cuentaActual[1], monitorPreferido)
    if (seleccion) return seleccion
  }

  // Configs antiguas o migradas pueden conservar varios bloques de cuenta.
  // Solo analizar el wallpaperconfig activo; no leer perfiles ni historiales.
  for (const [, cuenta] of cuentas) {
    if (cuenta === cuentaActual?.[1]) continue
    const seleccion = seleccionDeUsuario(cuenta, monitorPreferido)
    if (seleccion) return seleccion
  }
  return null
}

export function diagnosticarWallpaperEngine(config: unknown): {
  cuentas: number
  cuentasConSeleccion: number
} {
  if (!esObjeto(config)) return { cuentas: 0, cuentasConSeleccion: 0 }
  const cuentas = Object.values(config).filter(v => esObjeto(v) && esObjeto(v.general))
  const cuentasConSeleccion = cuentas.filter(v => {
    const s = obtener(v, 'general', 'wallpaperconfig', 'selectedwallpapers')
    return esObjeto(s) && Object.keys(s).length > 0
  }).length
  return { cuentas: cuentas.length, cuentasConSeleccion }
}
