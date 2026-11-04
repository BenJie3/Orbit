import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  nativeImage,
  shell,
  clipboard,
  systemPreferences
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process'
import sharp from 'sharp'
import { autoUpdater } from 'electron-updater'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let shiftPresionado = false
let modoVentanaActivo = false
let menuTrayVisible = false
let toastActivo = false
let timerOcultarToast: NodeJS.Timeout | null = null
let ultimoScrollMs = 0
let shellNotifierProc: ChildProcessWithoutNullStreams | null = null

type ModoTecla = 'shift' | 'doble-shift' | 'alt' | 'ctrl'
let pausado = false
let minutosTimerActivo = 0
let timerReanudar: NodeJS.Timeout | null = null
let modoTeclaActual: ModoTecla = 'shift'
let ultimoToqueTeclaMs = 0
let esperandoSegundoToque = false
let archivosRecientes: string[] = []
let adaptarFondoActivo = false

export interface TemaOrbit {
  primario: string
  secundario: string
  centro: string
  cristal: string
  borde: string
  textoInactivo: string
  inactivoInicio: string
  inactivoFin: string
  sombra: string
}

// Paleta Profesional por Defecto (Opción A: Azul Zafiro / Cian Fluent)
const TEMA_ZAFIRO_DEFAULT: TemaOrbit = {
  primario: '#2563eb',
  secundario: '#06b6d4',
  centro: '#e0f2fe',
  cristal: 'rgba(15, 23, 42, 0.62)',
  borde: 'rgba(186, 230, 253, 0.42)',
  textoInactivo: '#0f172a',
  inactivoInicio: '#e0f2fe',
  inactivoFin: '#bae6fd',
  sombra: 'rgba(37, 99, 235, 0.65)'
}

let temaActual: TemaOrbit = { ...TEMA_ZAFIRO_DEFAULT }
let ultimaFirmaWallpaper = ''
let intervaloMonitorWallpaper: NodeJS.Timeout | null = null
let watchersActivos: fs.FSWatcher[] = []
let debounceCambioWallpaper: NodeJS.Timeout | null = null
let rutaConfigWallpaperEngineCache = ''

const rutaConfig = path.join(app.getPath('userData'), 'orbit-settings.json')

function cargarConfiguracion() {
  try {
    if (fs.existsSync(rutaConfig)) {
      const data = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'))
      if (data.modoTeclaActual) modoTeclaActual = data.modoTeclaActual
      if (typeof data.adaptarFondoActivo === 'boolean') adaptarFondoActivo = data.adaptarFondoActivo
      if (Array.isArray(data.archivosRecientes)) {
        archivosRecientes = data.archivosRecientes.filter((r: string) => fs.existsSync(r)).slice(0, 5)
      }
    }
  } catch {}
}

function guardarConfiguracion() {
  try {
    fs.writeFileSync(
      rutaConfig,
      JSON.stringify({ modoTeclaActual, adaptarFondoActivo, archivosRecientes }, null, 2),
      'utf8'
    )
  } catch {}
}

function registrarArchivoReciente(rutaArchivo: string) {
  archivosRecientes = [rutaArchivo, ...archivosRecientes.filter((r) => r !== rutaArchivo)].slice(0, 5)
  guardarConfiguracion()
}

// --- CONVERSIÓN MATEMÁTICA RGB <-> HSL PARA TEMAS CAMALEÓNICOS ---
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0

  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function construirTemaDesdeHsl(h: number, s: number): TemaOrbit {
  const satViva = Math.max(68, Math.min(92, s))
  const hSecundario = (h + 24) % 360
  const primario = hslToHex(h, satViva, 52)
  const secundario = hslToHex(hSecundario, satViva, 44)
  const centro = hslToHex(h, Math.min(85, satViva), 90)
  const inactivoInicio = hslToHex(h, Math.min(80, satViva), 88)
  const inactivoFin = hslToHex(hSecundario, Math.min(78, satViva), 78)
  const textoInactivo = hslToHex(h, 45, 11)

  const [cr, cg, cb] = hslToRgb(h, 52, 12)
  const [br, bg, bb] = hslToRgb(h, 80, 82)
  const [sr, sg, sb] = hslToRgb(h, satViva, 52)

  return {
    primario,
    secundario,
    centro,
    cristal: `rgba(${cr}, ${cg}, ${cb}, 0.64)`,
    borde: `rgba(${br}, ${bg}, ${bb}, 0.44)`,
    textoInactivo,
    inactivoInicio,
    inactivoFin,
    sombra: `rgba(${sr}, ${sg}, ${sb}, 0.65)`
  }
}

// --- LOCALIZADOR DE WALLPAPER ENGINE Y EXTRACCIÓN POR HISTOGRAMA ---
function localizarConfigWallpaperEngine(): string {
  if (rutaConfigWallpaperEngineCache && fs.existsSync(rutaConfigWallpaperEngineCache)) {
    return rutaConfigWallpaperEngineCache
  }

  // 1. Buscar en Registro de Windows (HKCU\Software\WallpaperEngine -> installPath)
  try {
    const regOut = execSync(
      'reg query "HKCU\\Software\\WallpaperEngine" /v installPath',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    )
    const match = regOut.match(/installPath\s+REG_SZ\s+(.+)/i)
    if (match && match[1]) {
      const exeOrDir = match[1].trim().replace(/"/g, '')
      const dir = exeOrDir.toLowerCase().endsWith('.exe') ? path.dirname(exeOrDir) : exeOrDir
      const cfg = path.join(dir, 'config.json')
      if (fs.existsSync(cfg)) {
        rutaConfigWallpaperEngineCache = cfg
        return cfg
      }
    }
  } catch {}

  // 2. Buscar en rutas comunes de Steam en todas las unidades
  const unidades = ['C:', 'D:', 'E:', 'F:', 'G:']
  const subRutas = [
    'Program Files (x86)/Steam/steamapps/common/wallpaper_engine/config.json',
    'Program Files/Steam/steamapps/common/wallpaper_engine/config.json',
    'SteamLibrary/steamapps/common/wallpaper_engine/config.json',
    'Steam/steamapps/common/wallpaper_engine/config.json',
    'Games/Steam/steamapps/common/wallpaper_engine/config.json'
  ]

  for (const u of unidades) {
    for (const sr of subRutas) {
      const candidato = path.join(u, sr)
      if (fs.existsSync(candidato)) {
        rutaConfigWallpaperEngineCache = candidato
        return candidato
      }
    }
  }

  return ''
}

function obtenerWallpaperActivoWallpaperEngine(): {
  rutaPreview: string
  schemeColor: string
  firma: string
} | null {
  const cfgPath = localizarConfigWallpaperEngine()
  if (!cfgPath || !fs.existsSync(cfgPath)) return null

  try {
    const stat = fs.statSync(cfgPath)
    const raw = fs.readFileSync(cfgPath, 'utf8')

    // Extraer únicamente el bloque "selectedwallpapers" activo
    const selIdx = raw.indexOf('"selectedwallpapers"')
    const zonaBusqueda = selIdx !== -1 ? raw.slice(selIdx, selIdx + 12000) : raw

    const fileMatches = [...zonaBusqueda.matchAll(/"file"\s*:\s*"([^"]+)"/gi)]
    for (const m of fileMatches) {
      const fileVal = m[1].replace(/\\\\/g, '/').replace(/\\/g, '/')
      if (!fileVal) continue

      const folder = fs.existsSync(fileVal) && fs.statSync(fileVal).isDirectory()
        ? fileVal
        : path.dirname(fileVal)

      if (!fs.existsSync(folder)) continue

      let previewFile = ''
      let schemeColor = ''
      const projPath = path.join(folder, 'project.json')

      if (fs.existsSync(projPath)) {
        try {
          const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'))
          if (proj.preview) {
            const pCand = path.join(folder, proj.preview)
            if (fs.existsSync(pCand)) previewFile = pCand
          }
          if (proj.schemecolor) {
            schemeColor = String(proj.schemecolor)
          }
        } catch {}
      }

      if (!previewFile) {
        for (const nombre of ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp', 'thumb.jpg']) {
          const cand = path.join(folder, nombre)
          if (fs.existsSync(cand)) {
            previewFile = cand
            break
          }
        }
      }

      if (!previewFile && /\.(jpg|jpeg|png|webp|bmp)$/i.test(fileVal) && fs.existsSync(fileVal)) {
        previewFile = fileVal
      }

      if (previewFile || schemeColor) {
        return {
          rutaPreview: previewFile,
          schemeColor,
          firma: `WE:${fileVal}:${stat.mtimeMs}`
        }
      }
    }
  } catch {}

  return null
}

function obtenerRutasWallpaperWindows(): { ruta: string; firma: string } | null {
  const candidatos: string[] = []
  const appData = app.getPath('appData')

  const cachedDir = path.join(appData, 'Microsoft', 'Windows', 'Themes', 'CachedFiles')
  if (fs.existsSync(cachedDir)) {
    try {
      const files = fs
        .readdirSync(cachedDir)
        .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
        .map((f) => path.join(cachedDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      if (files.length > 0) candidatos.push(files[0])
    } catch {}
  }

  const transcoded = path.join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
  if (fs.existsSync(transcoded)) candidatos.push(transcoded)

  for (const c of candidatos) {
    try {
      const st = fs.statSync(c)
      if (st.size > 1024) {
        return { ruta: c, firma: `WIN:${c}:${st.mtimeMs}:${st.size}` }
      }
    } catch {}
  }
  return null
}

async function extraerHslDominanteDeImagen(rutaImagen: string): Promise<[number, number] | null> {
  try {
    const raw = await sharp(rutaImagen)
      .resize(48, 48, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer()

    // 36 cubetas de 10 grados cada una para hallar el pico real de color
    const binsPeso = new Float64Array(36)
    const binsHueSum = new Float64Array(36)
    const binsSatSum = new Float64Array(36)

    for (let i = 0; i < raw.length; i += 3) {
      const r = raw[i]
      const g = raw[i + 1]
      const b = raw[i + 2]
      const [h, s, l] = rgbToHsl(r, g, b)

      // Ignorar negros, blancos y grises apagados
      if (l < 12 || l > 90 || s < 18) continue

      const bin = Math.min(35, Math.floor(h / 10))
      const peso = (s / 100) * (1 - Math.abs(l - 50) / 50)
      binsPeso[bin] += peso
      binsHueSum[bin] += h * peso
      binsSatSum[bin] += s * peso
    }

    let mejorBin = -1
    let maxPeso = 0
    for (let b = 0; b < 36; b++) {
      // Suavizado con cubetas vecinas
      const prev = (b + 35) % 36
      const next = (b + 1) % 36
      const pesoSuavizado = binsPeso[b] + (binsPeso[prev] + binsPeso[next]) * 0.35
      if (pesoSuavizado > maxPeso) {
        maxPeso = pesoSuavizado
        mejorBin = b
      }
    }

    if (mejorBin !== -1 && binsPeso[mejorBin] > 0) {
      const hueFinal = binsHueSum[mejorBin] / binsPeso[mejorBin]
      const satFinal = binsSatSum[mejorBin] / binsPeso[mejorBin]
      return [hueFinal, satFinal]
    }
  } catch {}
  return null
}

async function sincronizarColorConWallpaper(forzar = false): Promise<boolean> {
  if (!adaptarFondoActivo) {
    temaActual = { ...TEMA_ZAFIRO_DEFAULT }
    ultimaFirmaWallpaper = 'DEFAULT'
    return true
  }

  const infoWE = obtenerWallpaperActivoWallpaperEngine()
  const infoWin = obtenerRutasWallpaperWindows()
  const accentWin = systemPreferences.getAccentColor?.() || ''

  const firmaActual = `${infoWE?.firma || ''}|${infoWin?.firma || ''}|${accentWin}`
  if (!forzar && firmaActual === ultimaFirmaWallpaper) {
    return false
  }
  ultimaFirmaWallpaper = firmaActual

  // 1. Intentar extraer de la imagen activa de Wallpaper Engine
  if (infoWE?.rutaPreview && fs.existsSync(infoWE.rutaPreview)) {
    const hsl = await extraerHslDominanteDeImagen(infoWE.rutaPreview)
    if (hsl) {
      temaActual = construirTemaDesdeHsl(hsl[0], hsl[1])
      return true
    }
  }

  // 2. Si Wallpaper Engine no tiene imagen pero tiene schemecolor en project.json
  if (infoWE?.schemeColor) {
    const partes = infoWE.schemeColor
      .trim()
      .split(/\s+/)
      .map((n) => parseFloat(n))
    if (partes.length >= 3 && partes.every((n) => !isNaN(n))) {
      const r = partes[0] <= 1 ? Math.round(partes[0] * 255) : Math.round(partes[0])
      const g = partes[1] <= 1 ? Math.round(partes[1] * 255) : Math.round(partes[1])
      const b = partes[2] <= 1 ? Math.round(partes[2] * 255) : Math.round(partes[2])
      const [h, s] = rgbToHsl(r, g, b)
      if (s > 10) {
        temaActual = construirTemaDesdeHsl(h, s)
        return true
      }
    }
  }

  // 3. Intentar extraer del Wallpaper de Windows (TranscodedWallpaper / CachedFiles)
  if (infoWin?.ruta && fs.existsSync(infoWin.ruta)) {
    const hsl = await extraerHslDominanteDeImagen(infoWin.ruta)
    if (hsl) {
      temaActual = construirTemaDesdeHsl(hsl[0], hsl[1])
      return true
    }
  }

  // 4. Respaldo final: Color de acento DWM de Windows
  if (accentWin && accentWin.length >= 6) {
    const r = parseInt(accentWin.slice(0, 2), 16)
    const g = parseInt(accentWin.slice(2, 4), 16)
    const b = parseInt(accentWin.slice(4, 6), 16)
    const [h, s] = rgbToHsl(r, g, b)
    temaActual = construirTemaDesdeHsl(h, Math.max(65, s))
    return true
  }

  return false
}

// Dispara la actualización visual en el Icono del Tray y en la Ventana Vue en tiempo real
async function aplicarYDifundirCambioDeTema(forzar = false) {
  const cambio = await sincronizarColorConWallpaper(forzar)
  if (!cambio && !forzar) return

  if (tray) {
    const nuevoIcono = await generarIconoTray(!pausado)
    tray.setImage(nuevoIcono)
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tema-actualizado', temaActual)
  }
}

function dispararVerificacionConDebounce() {
  if (!adaptarFondoActivo) return
  if (debounceCambioWallpaper) clearTimeout(debounceCambioWallpaper)
  debounceCambioWallpaper = setTimeout(() => {
    aplicarYDifundirCambioDeTema(false)
  }, 450)
}

function detenerMonitorWallpaperTiempoReal() {
  if (intervaloMonitorWallpaper) {
    clearInterval(intervaloMonitorWallpaper)
    intervaloMonitorWallpaper = null
  }
  for (const w of watchersActivos) {
    try {
      w.close()
    } catch {}
  }
  watchersActivos = []
}

function iniciarMonitorWallpaperTiempoReal() {
  detenerMonitorWallpaperTiempoReal()
  if (!adaptarFondoActivo) return

  // 1. Vigilar archivo config.json de Wallpaper Engine en vivo
  const cfgWE = localizarConfigWallpaperEngine()
  if (cfgWE && fs.existsSync(cfgWE)) {
    try {
      const w = fs.watch(cfgWE, () => dispararVerificacionConDebounce())
      watchersActivos.push(w)
    } catch {}
  }

  // 2. Vigilar carpeta Themes de Windows (TranscodedWallpaper)
  const dirThemesWin = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes')
  if (fs.existsSync(dirThemesWin)) {
    try {
      const w = fs.watch(dirThemesWin, () => dispararVerificacionConDebounce())
      watchersActivos.push(w)
    } catch {}
  }

  // 3. Verificación ligera de firma cada 2 segundos (0% CPU si no cambió el wallpaper)
  intervaloMonitorWallpaper = setInterval(() => {
    if (adaptarFondoActivo) {
      aplicarYDifundirCambioDeTema(false)
    }
  }, 2000)
}

async function generarIconoTray(activo: boolean): Promise<Electron.NativeImage> {
  const colorPrimario = activo ? temaActual.primario : '#64748b'
  const colorSecundario = activo ? temaActual.secundario : '#334155'
  const colorCentro = activo ? temaActual.centro : '#94a3b8'

  const svg = `
  <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colorPrimario}"/>
        <stop offset="100%" stop-color="${colorSecundario}"/>
      </linearGradient>
    </defs>
    <ellipse cx="32" cy="32" rx="27" ry="11" transform="rotate(-30 32 32)" fill="none" stroke="url(#g)" stroke-width="5.5" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="11" fill="url(#g)" stroke="#0f172a" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="5" fill="${colorCentro}"/>
    <circle cx="50" cy="14" r="5.5" fill="${colorCentro}" stroke="${colorSecundario}" stroke-width="2"/>
  </svg>`

  const pngBuffer = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer()
  return nativeImage.createFromBuffer(pngBuffer)
}

function hayImagenEnPortapapeles(): boolean {
  try {
    return !clipboard.readImage().isEmpty()
  } catch {
    return false
  }
}

function obtenerEstadoTray(mostrar: boolean, x = 0, y = 0) {
  const loginSettings = app.getLoginItemSettings()
  return {
    mostrar,
    x,
    y,
    pausadoGaming: pausado,
    minutosTimer: minutosTimerActivo,
    modoTeclaActual,
    archivosRecientes: archivosRecientes
      .filter((r) => fs.existsSync(r))
      .map((r) => ({ nombre: path.basename(r), ruta: r })),
    iniciarConWindows: loginSettings.openAtLogin,
    adaptarFondo: adaptarFondoActivo,
    temaActual,
    versionApp: app.getVersion() || '1.0.0',
    tieneImagenPortapapeles: hayImagenEnPortapapeles()
  }
}

function ocultarLienzoCompletamente() {
  shiftPresionado = false
  modoVentanaActivo = false
  menuTrayVisible = false

  if (toastActivo) return

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(true)
    mainWindow.setSkipTaskbar(true)
    mainWindow.hide()
  }
}

function notificarToastArchivoGuardado(rutaArchivo: string) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (timerOcultarToast) {
    clearTimeout(timerOcultarToast)
    timerOcultarToast = null
  }

  toastActivo = true
  const nombre = path.basename(rutaArchivo)
  const carpeta = path.basename(path.dirname(rutaArchivo)) || 'Origen'

  mainWindow.setSkipTaskbar(true)
  mainWindow.setIgnoreMouseEvents(true, { forward: true })
  mainWindow.showInactive()
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
  mainWindow.webContents.send('archivo-guardado-toast', {
    nombre,
    ruta: rutaArchivo,
    carpeta
  })

  timerOcultarToast = setTimeout(() => {
    toastActivo = false
    if (!shiftPresionado && !modoVentanaActivo && !menuTrayVisible) {
      ocultarLienzoCompletamente()
    }
  }, 4200)
}

async function cambiarEstadoPausa(pausarEstado: boolean, minutosAutoReanudar = 0) {
  pausado = pausarEstado
  minutosTimerActivo = pausarEstado ? minutosAutoReanudar : 0

  if (timerReanudar) {
    clearTimeout(timerReanudar)
    timerReanudar = null
  }

  if (pausado) {
    shiftPresionado = false
    if (minutosAutoReanudar > 0) {
      timerReanudar = setTimeout(() => {
        cambiarEstadoPausa(false)
      }, minutosAutoReanudar * 60 * 1000)
    }
  }

  if (tray) {
    const icono = await generarIconoTray(!pausado)
    tray.setImage(icono)
    tray.setToolTip(pausado ? 'Orbit — En pausa' : 'Orbit — Activo en segundo plano')
  }
}

function abrirPanelTrayPersonalizado() {
  if (!mainWindow || mainWindow.isDestroyed() || !tray) return

  if (menuTrayVisible) {
    mainWindow.webContents.send('abrir-menu-tray', obtenerEstadoTray(false))
    ocultarLienzoCompletamente()
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const workArea = display.workArea

  const panelAncho = 345
  const panelAlto = 560
  const x = Math.max(
    workArea.x + panelAncho / 2 + 12,
    Math.min(workArea.x + workArea.width - panelAncho / 2 - 12, cursor.x)
  )
  const y = Math.max(
    workArea.y + panelAlto / 2 + 12,
    Math.min(workArea.y + workArea.height - panelAlto / 2 - 12, cursor.y - panelAlto / 2 - 15)
  )

  modoVentanaActivo = true
  menuTrayVisible = true

  mainWindow.setSkipTaskbar(true)
  mainWindow.setIgnoreMouseEvents(false)
  mainWindow.showInactive()
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
  mainWindow.webContents.send('abrir-menu-tray', obtenerEstadoTray(true, x, y))
}

async function inicializarTray() {
  const iconoInicial = await generarIconoTray(!pausado)
  tray = new Tray(iconoInicial)
  tray.setToolTip('Orbit — Activo en segundo plano')

  tray.on('right-click', () => abrirPanelTrayPersonalizado())
  tray.on('click', () => abrirPanelTrayPersonalizado())
  tray.on('double-click', () => cambiarEstadoPausa(!pausado))
}

interface SegmentoTexto {
  texto: string
  bold?: boolean
  fontSize?: number
}

interface BloqueDocumento {
  tipo: 'texto' | 'imagen' | 'tabla' | 'salto_pagina'
  texto?: string
  segmentos?: SegmentoTexto[]
  filasTabla?: SegmentoTexto[][][]
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right' | 'both'
  indentLeft?: number
  espacioAntes?: number
  espacioDespues?: number
  pngBytes?: Uint8Array
  width?: number
  height?: number
}

function iniciarNotificadorSistemaArchivos() {
  if (process.platform !== 'win32') return

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class OrbitShell {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, string dwItem1, IntPtr dwItem2);
}
"@
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -ne "") {
        try {
            $dir = [System.IO.Path]::GetDirectoryName($line)
            [OrbitShell]::SHChangeNotify(0x00000002, 0x1005, $line, [IntPtr]::Zero)
            [OrbitShell]::SHChangeNotify(0x00001000, 0x1005, $dir, [IntPtr]::Zero)
        } catch {}
    }
}
`
  try {
    shellNotifierProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      { windowsHide: true }
    )
    shellNotifierProc.on('error', () => {
      shellNotifierProc = null
    })
  } catch {
    shellNotifierProc = null
  }
}

async function guardarEnOrigenYRefrescar(rutaArchivo: string, datos: Buffer | string) {
  if (typeof datos === 'string') {
    await fs.promises.writeFile(rutaArchivo, datos, 'utf8')
  } else {
    await fs.promises.writeFile(rutaArchivo, datos)
  }

  if (shellNotifierProc && shellNotifierProc.stdin.writable) {
    shellNotifierProc.stdin.write(`${rutaArchivo}\n`)
  }

  registrarArchivoReciente(rutaArchivo)
  notificarToastArchivoGuardado(rutaArchivo)
}

function obtenerRutaSalida(rutaOriginal: string, extDestino: string, sufijo = ''): string {
  const parsed = path.parse(rutaOriginal)
  const base = `${parsed.name}${sufijo}`
  let candidato = path.join(parsed.dir, `${base}.${extDestino}`)
  let contador = 1

  while (fs.existsSync(candidato)) {
    candidato = path.join(parsed.dir, `${base} (${contador}).${extDestino}`)
    contador++
  }
  return candidato
}

function extraerBufferDeZip(zipBuf: Buffer, nombreBuscado: string): Buffer | null {
  let eocdOffset = -1
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) return null

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10)
  let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16)
  const buscadoNorm = nombreBuscado.replace(/\\/g, '/').replace(/^\//, '')

  for (let i = 0; i < totalEntries; i++) {
    if (cdOffset + 46 > zipBuf.length || zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) break

    const method = zipBuf.readUInt16LE(cdOffset + 10)
    const compSize = zipBuf.readUInt32LE(cdOffset + 20)
    const nameLen = zipBuf.readUInt16LE(cdOffset + 28)
    const extraLen = zipBuf.readUInt16LE(cdOffset + 30)
    const commentLen = zipBuf.readUInt16LE(cdOffset + 32)
    const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42)

    const fileName = zipBuf
      .toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)
      .replace(/\\/g, '/')

    if (fileName === buscadoNorm) {
      const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26)
      const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
      const compData = zipBuf.subarray(dataStart, dataStart + compSize)

      if (method === 0) return Buffer.from(compData)
      if (method === 8) return zlib.inflateRawSync(compData)
      return null
    }

    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function decodificarEntidadesXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function extraerSegmentosDeRuns(xmlContenedor: string): {
  segmentos: SegmentoTexto[]
  textoCompleto: string
  maxFontSize: number
  tieneBold: boolean
} {
  const segmentos: SegmentoTexto[] = []
  let textoCompleto = ''
  let maxFontSize = 10.5
  let tieneBold = false

  const runsMatch = xmlContenedor.match(/<w:r[\s>][\s\S]*?<\/w:r>/g) || []
  for (const rXml of runsMatch) {
    const isBold = /<w:b(\s|\/|>)/i.test(rXml) && !/<w:b[^>]*w:val="(false|0)"/i.test(rXml)
    let fontSize = 10.5
    const szMatch = rXml.match(/<w:sz[^>]*w:val="(\d+)"/i)
    if (szMatch) {
      fontSize = Math.max(7.5, Math.min(36, parseInt(szMatch[1], 10) / 2))
    }

    const textosMatch = rXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []
    let runTexto = ''
    for (const tNode of textosMatch) {
      const inner = tNode.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, '')
      runTexto += decodificarEntidadesXml(inner)
    }
    if (/<w:tab(\s|\/|>)/i.test(rXml)) runTexto += '    '

    if (runTexto) {
      segmentos.push({ texto: runTexto, bold: isBold, fontSize })
      textoCompleto += runTexto
      if (fontSize > maxFontSize) maxFontSize = fontSize
      if (isBold) tieneBold = true
    }
  }

  return { segmentos, textoCompleto, maxFontSize, tieneBold }
}

async function parsearDocxABloques(rutaDocx: string): Promise<BloqueDocumento[]> {
  const zipBuf = await fs.promises.readFile(rutaDocx)
  const docBuf = extraerBufferDeZip(zipBuf, 'word/document.xml')
  if (!docBuf) return [{ tipo: 'texto', texto: '[No se pudo abrir el archivo DOCX]' }]

  const xml = docBuf.toString('utf8')

  const relsMap: Record<string, string> = {}
  const relsBuf = extraerBufferDeZip(zipBuf, 'word/_rels/document.xml.rels')
  if (relsBuf) {
    const relsXml = relsBuf.toString('utf8')
    const relsMatch = relsXml.match(/<Relationship\s+[^>]*\/?>/gi) || []
    for (const relNode of relsMatch) {
      const idMatch = relNode.match(/\bId="([^"]+)"/i)
      const targetMatch = relNode.match(/\bTarget="([^"]+)"/i)
      if (idMatch && targetMatch) {
        let target = targetMatch[1].replace(/\\/g, '/')
        if (target.startsWith('/')) target = target.slice(1)
        else if (!target.startsWith('word/')) target = `word/${target}`
        relsMap[idMatch[1]] = target
      }
    }
  }

  const bloques: BloqueDocumento[] = []
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/i)
  const contenidoBody = bodyMatch ? bodyMatch[1] : xml

  const elementosRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g
  const elementos = contenidoBody.match(elementosRegex) || []

  for (const elXml of elementos) {
    if (elXml.startsWith('<w:tbl')) {
      const filasTabla: SegmentoTexto[][][] = []
      const trs = elXml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []

      for (const trXml of trs) {
        const fila: SegmentoTexto[][] = []
        const tcs = trXml.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || []
        for (const tcXml of tcs) {
          const { segmentos } = extraerSegmentosDeRuns(tcXml)
          fila.push(segmentos.length > 0 ? segmentos : [{ texto: '', fontSize: 10 }])
        }
        if (fila.length > 0) filasTabla.push(fila)
      }

      if (filasTabla.length > 0) {
        bloques.push({ tipo: 'tabla', filasTabla })
      }
      continue
    }

    const pXml = elXml
    if (/<w:br[^>]*w:type="page"/i.test(pXml)) {
      bloques.push({ tipo: 'salto_pagina' })
    }

    let align: 'left' | 'center' | 'right' | 'both' = 'left'
    const jcMatch = pXml.match(/<w:jc[^>]*w:val="([^"]+)"/i)
    if (jcMatch) {
      const val = jcMatch[1].toLowerCase()
      if (val === 'center') align = 'center'
      else if (val === 'right' || val === 'end') align = 'right'
      else if (val === 'both' || val === 'distribute') align = 'both'
    }

    let indentLeft = 0
    const indMatch = pXml.match(/<w:ind[^>]*w:left="(\d+)"/i)
    if (indMatch) {
      indentLeft = parseInt(indMatch[1], 10)
    }

    const embedMatches = [...pXml.matchAll(/r:(?:embed|id)="([^"]+)"/gi)]
    for (const match of embedMatches) {
      const rId = match[1]
      const zipTarget = relsMap[rId]
      if (!zipTarget) continue

      const rawImgBuf = extraerBufferDeZip(zipBuf, zipTarget)
      if (!rawImgBuf) continue

      try {
        const pngBuf = await sharp(rawImgBuf).png().toBuffer()
        const meta = await sharp(pngBuf).metadata()

        let width = meta.width || 600
        let height = meta.height || 400

        const extentMatch = pXml.match(/<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/i)
        if (extentMatch) {
          const cxEmu = parseInt(extentMatch[1], 10)
          const cyEmu = parseInt(extentMatch[2], 10)
          if (cxEmu > 0 && cyEmu > 0) {
            width = Math.round(cxEmu / 9525)
            height = Math.round(cyEmu / 9525)
          }
        }

        bloques.push({
          tipo: 'imagen',
          pngBytes: new Uint8Array(pngBuf),
          width,
          height,
          align
        })
      } catch {}
    }

    const { segmentos, textoCompleto, maxFontSize, tieneBold } = extraerSegmentosDeRuns(pXml)
    if (textoCompleto.trim()) {
      bloques.push({
        tipo: 'texto',
        texto: textoCompleto,
        segmentos,
        fontSize: maxFontSize,
        bold: tieneBold,
        align,
        indentLeft,
        espacioDespues: 60
      })
    }
  }

  return bloques
}

function crc32(buf: Buffer): number {
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ -1) >>> 0
}

function crearZipBuffer(archivos: { nombre: string; contenido: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const archivo of archivos) {
    const nameBuf = Buffer.from(archivo.nombre, 'utf8')
    const dataBuf = archivo.contenido
    const crc = crc32(dataBuf)

    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(dataBuf.length, 18)
    localHeader.writeUInt32LE(dataBuf.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    nameBuf.copy(localHeader, 30)

    localHeaders.push(localHeader, dataBuf)

    const centralHeader = Buffer.alloc(46 + nameBuf.length)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(dataBuf.length, 20)
    centralHeader.writeUInt32LE(dataBuf.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    nameBuf.copy(centralHeader, 46)

    centralHeaders.push(centralHeader)
    offset += localHeader.length + dataBuf.length
  }

  const centralSize = centralHeaders.reduce((acc, b) => acc + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(archivos.length, 8)
  eocd.writeUInt16LE(archivos.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd])
}

function generarDocxEstructurado(bloques: BloqueDocumento[]): Buffer {
  const escaparXml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const renderRun = (seg: SegmentoTexto, defaultFontSize = 10, defaultBold = false) => {
    const szHalfPts = Math.round((seg.fontSize || defaultFontSize) * 2)
    const isBold = seg.bold !== undefined ? seg.bold : defaultBold
    const boldTag = isBold ? '<w:b/><w:bCs/>' : ''
    return (
      `<w:r>` +
      `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${boldTag}<w:sz w:val="${szHalfPts}"/><w:szCs w:val="${szHalfPts}"/></w:rPr>` +
      `<w:t xml:space="preserve">${escaparXml(seg.texto)}</w:t>` +
      `</w:r>`
    )
  }

  const archivosZip: { nombre: string; contenido: Buffer }[] = []
  const relacionesDoc: string[] = []
  const bodyParts: string[] = []
  let imgCounter = 0

  for (const b of bloques) {
    if (b.tipo === 'salto_pagina') {
      bodyParts.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
      continue
    }

    if (b.tipo === 'imagen' && b.pngBytes && b.pngBytes.byteLength > 0) {
      imgCounter++
      const rId = `rIdImg${imgCounter}`
      const mediaPath = `media/image${imgCounter}.png`

      archivosZip.push({
        nombre: `word/${mediaPath}`,
        contenido: Buffer.from(b.pngBytes)
      })

      relacionesDoc.push(
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaPath}"/>`
      )

      const imgW = b.width || 800
      const imgH = b.height || 200
      const maxWidthEmu = 6050000
      const maxHeightEmu = 7600000

      let cx = Math.round(imgW * 9525)
      let cy = Math.round(imgH * 9525)

      if (cx > maxWidthEmu) {
        const ratio = maxWidthEmu / cx
        cx = maxWidthEmu
        cy = Math.round(cy * ratio)
      }
      if (cy > maxHeightEmu) {
        const ratio = maxHeightEmu / cy
        cy = maxHeightEmu
        cx = Math.round(cx * ratio)
      }

      const align = b.align || 'center'

      bodyParts.push(`
        <w:p>
          <w:pPr><w:jc w:val="${align}"/><w:spacing w:before="40" w:after="40"/></w:pPr>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="${cx}" cy="${cy}"/>
                <wp:docPr id="${imgCounter}" name="Grafico ${imgCounter}"/>
                <wp:cNvGraphicFramePr>
                  <a:graphicFrameLocks noChangeAspect="1"/>
                </wp:cNvGraphicFramePr>
                <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic>
                      <pic:nvPicPr>
                        <pic:cNvPr id="${imgCounter}" name="image${imgCounter}.png"/>
                        <pic:cNvPicPr/>
                      </pic:nvPicPr>
                      <pic:blipFill>
                        <a:blip r:embed="${rId}"/>
                        <a:stretch><a:fillRect/></a:stretch>
                      </pic:blipFill>
                      <pic:spPr>
                        <a:xfrm>
                          <a:off x="0" y="0"/>
                          <a:ext cx="${cx}" cy="${cy}"/>
                        </a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>`)
      continue
    }

    if (b.tipo === 'tabla' && b.filasTabla && b.filasTabla.length > 0) {
      const numCols = Math.max(...b.filasTabla.map((f) => f.length))
      const anchoTotalTwips = 9360
      const anchoCol = Math.floor(anchoTotalTwips / numCols)

      const filasXml = b.filasTabla
        .map((fila) => {
          const celdasXml = fila
            .map((celdaSegmentos) => {
              const runsXml = celdaSegmentos.map((seg) => renderRun(seg, 10, false)).join('')
              return (
                `<w:tc>` +
                `<w:tcPr><w:tcW w:w="${anchoCol}" w:type="dxa"/></w:tcPr>` +
                `<w:p><w:pPr><w:spacing w:before="40" w:after="80"/></w:pPr>${runsXml}</w:p>` +
                `</w:tc>`
              )
            })
            .join('')
          return `<w:tr>${celdasXml}</w:tr>`
        })
        .join('')

      bodyParts.push(`
        <w:tbl>
          <w:tblPr>
            <w:tblW w:w="${anchoTotalTwips}" w:type="dxa"/>
            <w:tblBorders>
              <w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>
              <w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>
              <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
              <w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>
              <w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/>
              <w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            </w:tblBorders>
            <w:tblCellMar>
              <w:top w:w="60" w:type="dxa"/>
              <w:left w:w="110" w:type="dxa"/>
              <w:bottom w:w="60" w:type="dxa"/>
              <w:right w:w="110" w:type="dxa"/>
            </w:tblCellMar>
          </w:tblPr>
          ${filasXml}
        </w:tbl>
        <w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr></w:p>`)
      continue
    }

    if (b.tipo === 'texto') {
      const align = b.align || 'left'
      const before = b.espacioAntes ?? 0
      const after = b.espacioDespues ?? 40
      const indent = b.indentLeft && b.indentLeft > 0 ? `<w:ind w:left="${b.indentLeft}"/>` : ''

      const runsXml =
        b.segmentos && b.segmentos.length > 0
          ? b.segmentos.map((s) => renderRun(s, b.fontSize || 10, b.bold || false)).join('')
          : renderRun({ texto: b.texto || '', fontSize: b.fontSize, bold: b.bold })

      bodyParts.push(
        `<w:p>` +
          `<w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>${indent}</w:pPr>` +
          `${runsXml}` +
          `</w:p>`
      )
    }
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relacionesDoc.join('\n  ')}
</Relationships>`

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyParts.join('')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="560" w:right="900" w:bottom="560" w:left="900"/>
    </w:sectPr>
  </w:body>
</w:document>`

  archivosZip.unshift(
    { nombre: '[Content_Types].xml', contenido: Buffer.from(contentTypes, 'utf8') },
    { nombre: '_rels/.rels', contenido: Buffer.from(rootRels, 'utf8') },
    { nombre: 'word/_rels/document.xml.rels', contenido: Buffer.from(wordRels, 'utf8') },
    { nombre: 'word/document.xml', contenido: Buffer.from(documentXml, 'utf8') }
  )

  return crearZipBuffer(archivosZip)
}

function coincideTeclaActivacion(keycode: number): boolean {
  if (modoTeclaActual === 'shift' || modoTeclaActual === 'doble-shift') {
    return keycode === UiohookKey.Shift || keycode === UiohookKey.ShiftRight
  }
  if (modoTeclaActual === 'alt') {
    return keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight
  }
  if (modoTeclaActual === 'ctrl') {
    return keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight
  }
  return false
}

function mostrarRuedaEnCursor() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getPrimaryDisplay()
  const { x: dispX, y: dispY, width, height } = display.bounds

  const margen = 175
  const posX = Math.max(margen, Math.min(width - margen, cursor.x - dispX))
  const posY = Math.max(margen, Math.min(height - margen, cursor.y - dispY))

  mainWindow.setSkipTaskbar(true)
  mainWindow.setIgnoreMouseEvents(false)
  mainWindow.showInactive()
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
  mainWindow.webContents.send('toggle-menu', {
    mostrar: true,
    x: posX,
    y: posY,
    tieneImagenPortapapeles: hayImagenEnPortapapeles(),
    temaActual
  })
}

function createWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.bounds

  const win = new BrowserWindow({
    width: width - 2,
    height: height - 4,
    x: 1,
    y: 1,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true
    }
  })

  win.setSkipTaskbar(true)
  win.setIgnoreMouseEvents(true)

  win.on('blur', () => {
    if (menuTrayVisible && !win.isDestroyed()) {
      win.webContents.send('abrir-menu-tray', obtenerEstadoTray(false))
      ocultarLienzoCompletamente()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const instanciaUnica = app.requestSingleInstanceLock()
if (!instanciaUnica) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.orbit.converter')
    cargarConfiguracion()
    await sincronizarColorConWallpaper(true)
    iniciarNotificadorSistemaArchivos()
    await inicializarTray()

    if (adaptarFondoActivo) {
      iniciarMonitorWallpaperTiempoReal()
    }

    // Escuchar eventos nativos DWM de cambio de color en Windows 10/11
    if (process.platform === 'win32') {
      systemPreferences.on('accent-color-changed', () => {
        dispararVerificacionConDebounce()
      })
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    mainWindow = createWindow()

    uIOhook.on('keydown', (e) => {
      if (pausado || modoVentanaActivo) return
      if (!coincideTeclaActivacion(e.keycode)) return

      if (!shiftPresionado) {
        if (modoTeclaActual === 'doble-shift') {
          const ahora = Date.now()
          if (esperandoSegundoToque && ahora - ultimoToqueTeclaMs <= 360) {
            shiftPresionado = true
            esperandoSegundoToque = false
            mostrarRuedaEnCursor()
          } else {
            esperandoSegundoToque = true
            ultimoToqueTeclaMs = ahora
          }
        } else {
          shiftPresionado = true
          mostrarRuedaEnCursor()
        }
      }
    })

    uIOhook.on('keyup', (e) => {
      if (!coincideTeclaActivacion(e.keycode)) return

      if (shiftPresionado) {
        shiftPresionado = false
        if (!modoVentanaActivo && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('toggle-menu', {
            mostrar: false,
            x: 0,
            y: 0
          })
          ocultarLienzoCompletamente()
        }
      }
    })

    uIOhook.on('wheel', (e) => {
      if (
        !pausado &&
        shiftPresionado &&
        !modoVentanaActivo &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        const ahora = Date.now()
        if (ahora - ultimoScrollMs < 60) return
        ultimoScrollMs = ahora

        const direccion = e.rotation > 0 ? 'down' : 'up'
        mainWindow.webContents.send('scroll-menu', direccion)
      }
    })

    uIOhook.start()

    ipcMain.handle('obtener-tema-inicial', async () => {
      return temaActual
    })

    ipcMain.on('activar-modo-ventana', () => {
      modoVentanaActivo = true
      menuTrayVisible = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSkipTaskbar(true)
        mainWindow.setIgnoreMouseEvents(false)
        mainWindow.showInactive()
        mainWindow.focus()
      }
    })

    ipcMain.on('set-mouse-ignore', (_, ignorar: boolean) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (modoVentanaActivo || menuTrayVisible || shiftPresionado) return
      if (ignorar) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        mainWindow.setIgnoreMouseEvents(false)
      }
    })

    ipcMain.on('forzar-cierre-menu', () => {
      ocultarLienzoCompletamente()
    })

    ipcMain.handle('mostrar-archivo-en-carpeta', async (_, rutaArchivo: string) => {
      if (rutaArchivo && fs.existsSync(rutaArchivo)) {
        shell.showItemInFolder(rutaArchivo)
        return true
      }
      return false
    })

    // Actualización NSIS mediante electron-updater: solo instala versiones superiores y
    // verifica la integridad del archivo usando latest.yml (SHA-512).
    let actualizacionEnCurso = false
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.on('error', (error) => {
      console.error('[Orbit] Error de actualización:', error)
    })

    ipcMain.handle('buscar-y-actualizar-directo', async () => {
      const versionActual = app.getVersion()
      const emitirProgreso = (info: {
        estado: 'buscando' | 'disponible' | 'descargando' | 'instalando' | 'actualizado' | 'error'
        porcentaje: number
        versionNueva?: string
        mensaje: string
      }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progreso-actualizacion', info)
        }
      }

      if (actualizacionEnCurso) {
        return { estado: 'descargando', porcentaje: 0, mensaje: 'Ya hay una actualización en curso.' }
      }
      if (!app.isPackaged || process.platform !== 'win32') {
        const info = {
          estado: 'error' as const,
          porcentaje: 0,
          mensaje: 'Las actualizaciones se prueban en Orbit instalado para Windows, no en modo desarrollo.'
        }
        emitirProgreso(info)
        return info
      }

      actualizacionEnCurso = true
      let hayActualizacion = false
      const marcarDisponible = () => { hayActualizacion = true }
      const informarDescarga = (progreso: { percent: number }) => {
        const porcentaje = Math.min(99, Math.max(0, Math.round(progreso.percent || 0)))
        emitirProgreso({
          estado: 'descargando',
          porcentaje,
          mensaje: `Descargando actualización (${porcentaje}%)...`
        })
      }

      try {
        emitirProgreso({ estado: 'buscando', porcentaje: 0, mensaje: 'Buscando nueva versión...' })
        autoUpdater.once('update-available', marcarDisponible)
        const comprobacion = await autoUpdater.checkForUpdates()
        autoUpdater.removeListener('update-available', marcarDisponible)

        // electron-updater compara SemVer y bloquea downgrades. No interpretar
        // como nueva versión un release antiguo que tenga un .exe mal nombrado.
        if (!hayActualizacion || !comprobacion?.updateInfo) {
          const info = {
            estado: 'actualizado' as const,
            porcentaje: 100,
            mensaje: `Estás en la última versión (v${versionActual})`
          }
          emitirProgreso(info)
          return info
        }

        const versionNueva = comprobacion.updateInfo.version
        emitirProgreso({
          estado: 'disponible',
          porcentaje: 0,
          versionNueva,
          mensaje: `Actualización v${versionNueva} disponible.`
        })

        autoUpdater.on('download-progress', informarDescarga)
        try {
          // latest.yml incluye la suma SHA-512 validada por electron-updater.
          await autoUpdater.downloadUpdate()
        } finally {
          autoUpdater.removeListener('download-progress', informarDescarga)
        }

        const info = {
          estado: 'instalando' as const,
          porcentaje: 100,
          versionNueva,
          mensaje: 'Descarga verificada. Instalando y reiniciando Orbit...'
        }
        emitirProgreso(info)

        setTimeout(() => {
          try {
            uIOhook.stop()
            detenerMonitorWallpaperTiempoReal()
            if (shellNotifierProc) shellNotifierProc.kill()
            // La API de electron-updater v6 fuerza el reinicio tras NSIS silencioso.
            autoUpdater.quitAndInstall(true, true)
          } catch (error) {
            console.error('[Orbit] No se pudo iniciar la instalación:', error)
            actualizacionEnCurso = false
            emitirProgreso({
              estado: 'error',
              porcentaje: 0,
              mensaje: 'No se pudo iniciar la instalación de la actualización.'
            })
          }
        }, 900)
        return info
      } catch (error) {
        console.error('[Orbit] Error verificando o descargando actualización:', error)
        const info = {
          estado: 'error' as const,
          porcentaje: 0,
          mensaje: 'No se pudo actualizar. Verifica la conexión y que el Release incluya latest.yml.'
        }
        emitirProgreso(info)
        return info
      } finally {
        autoUpdater.removeListener('update-available', marcarDisponible)
        // Conservar el candado mientras el instalador está arrancando.
        if (!hayActualizacion || !actualizacionEnCurso) {
          actualizacionEnCurso = false
        }
      }
    })

    ipcMain.handle('actualizar-config-tray', async (_, accion) => {
      if (accion.tipo === 'toggle-gaming') {
        await cambiarEstadoPausa(!pausado, 0)
      } else if (accion.tipo === 'timer') {
        const mins = Number(accion.valor) || 0
        if (pausado && minutosTimerActivo === mins) {
          await cambiarEstadoPausa(false, 0)
        } else {
          await cambiarEstadoPausa(true, mins)
        }
      } else if (accion.tipo === 'tecla') {
        modoTeclaActual = accion.valor
        guardarConfiguracion()
      } else if (accion.tipo === 'adaptar-fondo') {
        adaptarFondoActivo = Boolean(accion.valor)
        guardarConfiguracion()
        if (adaptarFondoActivo) {
          await aplicarYDifundirCambioDeTema(true)
          iniciarMonitorWallpaperTiempoReal()
        } else {
          detenerMonitorWallpaperTiempoReal()
          await aplicarYDifundirCambioDeTema(true)
        }
      } else if (accion.tipo === 'autostart') {
        const nuevoValor = Boolean(accion.valor)
        app.setLoginItemSettings({
          openAtLogin: nuevoValor,
          path: app.getPath('exe')
        })
      } else if (accion.tipo === 'abrir-reciente') {
        if (accion.valor && fs.existsSync(accion.valor)) {
          shell.showItemInFolder(accion.valor)
        }
      } else if (accion.tipo === 'limpiar-recientes') {
        archivosRecientes = []
        guardarConfiguracion()
      } else if (accion.tipo === 'salir') {
        uIOhook.stop()
        if (shellNotifierProc) shellNotifierProc.kill()
        detenerMonitorWallpaperTiempoReal()
        app.quit()
      }

      return obtenerEstadoTray(true)
    })

    ipcMain.handle(
      'guardar-paginas-imagen',
      async (
        _,
        paginasBytes: Uint8Array[],
        formatoDestino: string,
        rutaOriginal: string,
        sufijoPersonalizado?: string
      ) => {
        try {
          if (paginasBytes.length === 1) {
            const outPath = obtenerRutaSalida(
              rutaOriginal,
              formatoDestino,
              sufijoPersonalizado || ''
            )
            await guardarEnOrigenYRefrescar(outPath, Buffer.from(paginasBytes[0]))
          } else {
            for (let i = 0; i < paginasBytes.length; i++) {
              const sufijo = sufijoPersonalizado
                ? `${sufijoPersonalizado}_pag${i + 1}`
                : `_pag${i + 1}`
              const outPath = obtenerRutaSalida(rutaOriginal, formatoDestino, sufijo)
              await guardarEnOrigenYRefrescar(outPath, Buffer.from(paginasBytes[i]))
            }
          }
          return true
        } catch {
          return false
        }
      }
    )

    ipcMain.handle(
      'guardar-paginas-como-pdf',
      async (
        _,
        paginasBytes: Uint8Array[],
        rutaOriginal: string,
        dimensiones?: { width: number; height: number }[],
        sufijoPersonalizado?: string
      ) => {
        try {
          const pdfDoc = await PDFDocument.create()
          for (let i = 0; i < paginasBytes.length; i++) {
            const bytes = paginasBytes[i]
            const esJpeg = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8
            const img = esJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes)
            const w = dimensiones?.[i]?.width || img.width || 612
            const h = dimensiones?.[i]?.height || img.height || 792
            const page = pdfDoc.addPage([w, h])
            page.drawImage(img, { x: 0, y: 0, width: w, height: h })
          }
          const pdfBytes = await pdfDoc.save()
          const outPath = obtenerRutaSalida(rutaOriginal, 'pdf', sufijoPersonalizado || '')
          await guardarEnOrigenYRefrescar(outPath, Buffer.from(pdfBytes))
          return true
        } catch {
          return false
        }
      }
    )

    ipcMain.handle(
      'guardar-texto-documento',
      async (
        _,
        bloques: BloqueDocumento[],
        formatoDestino: 'txt' | 'docx',
        rutaOriginal: string
      ) => {
        try {
          const outPath = obtenerRutaSalida(rutaOriginal, formatoDestino)

          if (formatoDestino === 'txt') {
            const lineasTxt: string[] = []
            for (const b of bloques) {
              if (b.tipo === 'salto_pagina') {
                lineasTxt.push('\r\n----------------------------------------\r\n')
              } else if (b.tipo === 'texto' && b.texto !== undefined) {
                if ((b.espacioAntes || 0) > 160) lineasTxt.push('')
                lineasTxt.push(b.texto)
              } else if (b.tipo === 'tabla' && b.filasTabla) {
                lineasTxt.push('')
                for (const fila of b.filasTabla) {
                  const textoFila = fila
                    .map((celda) => celda.map((s) => s.texto).join(''))
                    .join('   |   ')
                  lineasTxt.push(textoFila)
                }
                lineasTxt.push('')
              }
            }
            const contenidoFinal =
              lineasTxt.length > 0
                ? lineasTxt.join('\r\n')
                : '[Este documento contiene únicamente imágenes sin texto seleccionable]'
            await guardarEnOrigenYRefrescar(outPath, contenidoFinal)
          } else {
            const docxBuffer = generarDocxEstructurado(bloques)
            await guardarEnOrigenYRefrescar(outPath, docxBuffer)
          }
          return true
        } catch {
          return false
        }
      }
    )

    ipcMain.handle('leer-documento-texto', async (_, rutaOriginal: string) => {
      try {
        const ext = path.extname(rutaOriginal).toLowerCase()
        if (ext === '.docx') {
          return await parsearDocxABloques(rutaOriginal)
        } else {
          const contenido = await fs.promises.readFile(rutaOriginal, 'utf8')
          const lineas = contenido.split(/\r?\n/)
          return lineas.map((linea) => ({
            tipo: 'texto',
            texto: linea,
            segmentos: [{ texto: linea, fontSize: 11, bold: false }],
            fontSize: 11,
            bold: false,
            align: 'left',
            espacioDespues: 60
          }))
        }
      } catch {
        return []
      }
    })

    ipcMain.handle(
      'convertir-imagen-backend',
      async (_, rutaOriginal: string, formatoDestino: string) => {
        try {
          const outPath = obtenerRutaSalida(rutaOriginal, formatoDestino)

          if (formatoDestino === 'pdf') {
            const pngBuffer = await sharp(rutaOriginal).rotate().png().toBuffer()
            const pdfDoc = await PDFDocument.create()
            const img = await pdfDoc.embedPng(pngBuffer)

            const page = pdfDoc.addPage([img.width, img.height])
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })

            const pdfBytes = await pdfDoc.save()
            await guardarEnOrigenYRefrescar(outPath, Buffer.from(pdfBytes))
          } else if (formatoDestino === 'jpg') {
            const outBuf = await sharp(rutaOriginal)
              .rotate()
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: 92 })
              .toBuffer()
            await guardarEnOrigenYRefrescar(outPath, outBuf)
          } else if (formatoDestino === 'png') {
            const outBuf = await sharp(rutaOriginal).rotate().png().toBuffer()
            await guardarEnOrigenYRefrescar(outPath, outBuf)
          } else if (formatoDestino === 'webp') {
            const outBuf = await sharp(rutaOriginal).rotate().webp({ quality: 92 }).toBuffer()
            await guardarEnOrigenYRefrescar(outPath, outBuf)
          }

          return true
        } catch {
          return false
        }
      }
    )

    ipcMain.handle('unir-pdfs-backend', async (_, rutasPdfs: string[]) => {
      try {
        if (!rutasPdfs || rutasPdfs.length === 0) return false
        const pdfFinal = await PDFDocument.create()

        for (const ruta of rutasPdfs) {
          if (!fs.existsSync(ruta)) continue
          const bytes = await fs.promises.readFile(ruta)
          const pdfOrigen = await PDFDocument.load(bytes)
          const paginasCopiadas = await pdfFinal.copyPages(pdfOrigen, pdfOrigen.getPageIndices())
          for (const pag of paginasCopiadas) {
            pdfFinal.addPage(pag)
          }
        }

        const pdfBytes = await pdfFinal.save()
        const outPath = obtenerRutaSalida(rutasPdfs[0], 'pdf', '_unido')
        await guardarEnOrigenYRefrescar(outPath, Buffer.from(pdfBytes))
        return true
      } catch {
        return false
      }
    })

    ipcMain.handle('convertir-imagenes-a-pdf-unico', async (_, rutasImagenes: string[]) => {
      try {
        if (!rutasImagenes || rutasImagenes.length === 0) return false
        const pdfDoc = await PDFDocument.create()

        for (const ruta of rutasImagenes) {
          if (!fs.existsSync(ruta)) continue
          const pngBuffer = await sharp(ruta).rotate().png().toBuffer()
          const img = await pdfDoc.embedPng(pngBuffer)
          const page = pdfDoc.addPage([img.width, img.height])
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
        }

        const pdfBytes = await pdfDoc.save()
        const outPath = obtenerRutaSalida(rutasImagenes[0], 'pdf', '_album')
        await guardarEnOrigenYRefrescar(outPath, Buffer.from(pdfBytes))
        return true
      } catch {
        return false
      }
    })

    ipcMain.handle('leer-imagen-portapapeles', async () => {
      try {
        const img = clipboard.readImage()
        if (img.isEmpty()) return null
        const pngBuf = img.toPNG()
        const escritorio = app.getPath('desktop')
        const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        const rutaSugerida = path.join(escritorio, `Captura_${fecha}.png`)
        return {
          pngBytes: new Uint8Array(pngBuf),
          rutaSugerida,
          nombre: `Captura_${fecha}.png`
        }
      } catch {
        return null
      }
    })

    ipcMain.handle('leer-archivo-binario', async (_, rutaOriginal: string) => {
      try {
        const buf = await fs.promises.readFile(rutaOriginal)
        return new Uint8Array(buf)
      } catch {
        return new Uint8Array(0)
      }
    })

    ipcMain.handle(
      'guardar-multimedia-bytes',
      async (
        _,
        bytes: Uint8Array,
        extDestino: string,
        rutaOriginal: string,
        sufijoPersonalizado?: string
      ) => {
        try {
          const outPath = obtenerRutaSalida(
            rutaOriginal,
            extDestino,
            sufijoPersonalizado || ''
          )
          await guardarEnOrigenYRefrescar(outPath, Buffer.from(bytes))
          return true
        } catch {
          return false
        }
      }
    )
  })
}

app.on('window-all-closed', () => {
  uIOhook.stop()
  detenerMonitorWallpaperTiempoReal()
  if (shellNotifierProc) {
    shellNotifierProc.kill()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})