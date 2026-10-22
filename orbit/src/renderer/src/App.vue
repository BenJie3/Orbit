<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, nextTick, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

if (typeof (Promise as any).try !== 'function') {
  ;(Promise as any).try = function (callback: Function, ...args: any[]) {
    return new Promise((resolve) => resolve(callback(...args)))
  }
}

if (typeof (Promise as any).withResolvers !== 'function') {
  ;(Promise as any).withResolvers = function () {
    let resolve!: Function
    let reject!: Function
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

if (typeof (URL as any).parse !== 'function') {
  ;(URL as any).parse = function (url: string, base?: string) {
    try {
      return new URL(url, base)
    } catch {
      return null
    }
  }
}

if (typeof (Map.prototype as any).getOrInsert !== 'function') {
  ;(Map.prototype as any).getOrInsert = function (key: any, defaultValue: any) {
    if (!this.has(key)) this.set(key, defaultValue)
    return this.get(key)
  }
}

if (typeof (Map.prototype as any).getOrInsertComputed !== 'function') {
  ;(Map.prototype as any).getOrInsertComputed = function (key: any, callbackFn: Function) {
    if (!this.has(key)) this.set(key, callbackFn(key))
    return this.get(key)
  }
}

if (typeof (Uint8Array.prototype as any).toHex !== 'function') {
  ;(Uint8Array.prototype as any).toHex = function () {
    return Array.from(this as Uint8Array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

if (typeof (RegExp as any).escape !== 'function') {
  ;(RegExp as any).escape = function (str: string) {
    return String(str).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')
  }
}

;(window as any).Worker = undefined
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  return window.setTimeout(() => cb(performance.now()), 0)
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

interface BloqueConPosicion {
  pdfY: number
  pdfBottomY: number
  bloque: BloqueDocumento
}

interface EstadoTrayOrbit {
  mostrar: boolean
  x: number
  y: number
  pausadoGaming: boolean
  minutosTimer: number
  modoTeclaActual: 'shift' | 'doble-shift' | 'alt' | 'ctrl'
  archivosRecientes: { nombre: string; ruta: string }[]
  iniciarConWindows: boolean
  versionApp: string
}

interface ResultadoActualizacion {
  estado: 'actualizado' | 'disponible' | 'descargando' | 'error'
  versionNueva?: string
  mensaje: string
  urlDescarga?: string
}

declare global {
  interface Window {
    api: {
      onToggleMenu: (callback: (data: { mostrar: boolean; x: number; y: number }) => void) => void
      onScrollMenu: (callback: (direccion: 'up' | 'down') => void) => void
      onTrayMenu: (callback: (estado: EstadoTrayOrbit) => void) => void
      onArchivoGuardadoToast: (
        callback: (data: { nombre: string; ruta: string; carpeta: string }) => void
      ) => void
      actualizarConfigTray: (accion: {
        tipo:
          | 'toggle-gaming'
          | 'timer'
          | 'tecla'
          | 'autostart'
          | 'abrir-reciente'
          | 'limpiar-recientes'
          | 'salir'
        valor?: any
      }) => Promise<EstadoTrayOrbit>
      buscarActualizaciones: () => Promise<ResultadoActualizacion>
      obtenerRuta: (file: File) => string
      guardarPaginasImagen: (
        paginasBytes: Uint8Array[],
        formatoDestino: string,
        rutaOriginal: string,
        sufijoPersonalizado?: string
      ) => Promise<boolean>
      guardarPaginasComoPdf: (
        paginasPngBytes: Uint8Array[],
        rutaOriginal: string,
        dimensiones?: { width: number; height: number }[],
        sufijoPersonalizado?: string
      ) => Promise<boolean>
      guardarTextoDocumento: (
        bloques: BloqueDocumento[],
        formatoDestino: 'txt' | 'docx',
        rutaOriginal: string
      ) => Promise<boolean>
      leerDocumentoTexto: (rutaOriginal: string) => Promise<BloqueDocumento[]>
      convertirImagenBackend: (rutaOriginal: string, formatoDestino: string) => Promise<boolean>
      unirPdfsBackend: (rutasPdfs: string[]) => Promise<boolean>
      convertirImagenesAPdfUnico: (rutasImagenes: string[]) => Promise<boolean>
      leerImagenPortapapeles: () => Promise<{
        pngBytes: Uint8Array
        rutaSugerida: string
        nombre: string
      } | null>
      leerArchivoBinario: (rutaOriginal: string) => Promise<Uint8Array>
      guardarMultimediaBytes: (
        bytes: Uint8Array,
        extDestino: string,
        rutaOriginal: string,
        sufijoPersonalizado?: string
      ) => Promise<boolean>
      mostrarArchivoEnCarpeta: (rutaArchivo: string) => Promise<boolean>
      setMouseIgnore: (ignorar: boolean) => void
      activarModoVentana: () => void
      cerrarMenu: () => void
    }
  }
}

// --- ESTADOS DEL MENÚ RADIAL Y SCROLL ---
const showMenu = ref(false)
const procesando = ref(false)
const posX = ref(500)
const posY = ref(400)
const opcionActiva = ref<string | null>(null)
const tipoDetectado = ref<'pdf' | 'docx' | 'txt' | 'imagen' | 'video' | 'audio'>('pdf')
const modoRueda = ref<'conversion' | 'herramientas'>('conversion')
const cantidadArchivosEnVuelo = ref(1)

// --- ESTADO DE LA NOTIFICACIÓN TOAST FLOTANTE (OPCIÓN 2) ---
const toastVisible = ref(false)
const toastData = ref({ nombre: '', ruta: '', carpeta: '' })
let timerToastUI: number | null = null

// --- ESTADOS DEL PANEL DE BANDEJA ORBIT Y ACTUALIZADOR (OPCIÓN 5) ---
const trayMenuAbierto = ref(false)
const trayPosX = ref(0)
const trayPosY = ref(0)
const trayPausado = ref(false)
const trayMinutosTimer = ref(0)
const trayModoTecla = ref<'shift' | 'doble-shift' | 'alt' | 'ctrl'>('shift')
const trayArchivosRecientes = ref<{ nombre: string; ruta: string }[]>([])
const trayIniciarConWindows = ref(false)
const trayVersionApp = ref('0.1.0')
const buscandoUpdate = ref(false)
const infoUpdate = ref<ResultadoActualizacion | null>(null)

// --- ESTADOS DE LA VENTANA DE HERRAMIENTAS ORBIT ---
type TipoHerramienta =
  | 'recortar'
  | 'dibujar'
  | 'dividir'
  | 'rotar'
  | 'ajustar'
  | 'editar'
  | 'multimedia'
  | 'capturar'
  | 'gif'

const ventanaAbierta = ref(false)
const herramientaActual = ref<TipoHerramienta | null>(null)
const rutaArchivoActivo = ref('')
const nombreArchivoActivo = ref('')
const extArchivoActivo = ref('')

const paginasCanvases = shallowRef<HTMLCanvasElement[]>([])
const paginasMiniaturas = shallowRef<string[]>([])
const historialTrazos = shallowRef<ImageData[]>([])

const paginaIndice = ref(0)
const paginasSeleccionadas = ref<number[]>([])
const modoDivisionPdf = ref<'unico' | 'separados'>('unico')

const contenedorScrollRef = ref<HTMLDivElement | null>(null)
const canvasInteractivoRef = ref<HTMLCanvasElement | null>(null)
const colorPincel = ref('#111827')
const grosorPincel = ref(3)
const dibujando = ref(false)
const ultimoPuntoTrazo = ref<{ x: number; y: number } | null>(null)

const zoomNivel = ref(100)
const modoPan = ref(false)
const espacioPresionado = ref(false)
const arrastrandoPan = ref(false)
const panInicio = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
const anchoBaseVisual = ref(560)
const altoBaseVisual = ref(400)

const arrastrandoRecorte = ref(false)
const recorteInicio = ref({ x: 0, y: 0 })
const cajaRecorte = ref({ x: 40, y: 40, w: 260, h: 200, activo: false })

const rotacionGrados = ref(0)
const voltearH = ref(false)
const voltearV = ref(false)

const escalaPorcentaje = ref(75)
const calidadPorcentaje = ref(80)
const textoEditable = ref('')

// --- ESTADOS PARA HERRAMIENTAS MULTIMEDIA (VIDEO Y AUDIO) ---
const mediaUrlActiva = ref('')
const esVideoActivo = ref(false)
const videoPlayerRef = ref<HTMLVideoElement | null>(null)
const audioPlayerRef = ref<HTMLAudioElement | null>(null)
const duracionMedia = ref(0)
const inicioCorteSeg = ref(0)
const finCorteSeg = ref(10)
const volumenMediaPct = ref(100)
const velocidadMedia = ref(1)
const fpsGif = ref(10)
const anchoGif = ref(360)
const bytesMultimediaOriginal = shallowRef<Uint8Array | null>(null)

const nombreCarpetaOrigen = computed(() => {
  if (!rutaArchivoActivo.value) return 'carpeta de origen'
  const normalizada = rutaArchivoActivo.value.replace(/\\/g, '/')
  const partes = normalizada.split('/')
  partes.pop()
  const carpeta = partes.pop() || ''
  if (!carpeta) return 'carpeta de origen'
  if (carpeta.toLowerCase() === 'desktop') return 'Escritorio'
  if (carpeta.toLowerCase() === 'downloads') return 'Descargas'
  if (carpeta.toLowerCase() === 'documents') return 'Documentos'
  return carpeta
})

const herramientasDisponiblesArchivo = computed<{ id: TipoHerramienta; label: string }[]>(() => {
  const ext = extArchivoActivo.value
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
    return [
      { id: 'multimedia', label: 'Recortar / Audio' },
      { id: 'capturar', label: 'Capturar Frame' },
      { id: 'gif', label: 'Crear GIF' }
    ]
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) {
    return [{ id: 'multimedia', label: 'Recortar / Ajustar Audio' }]
  }
  if (ext === 'pdf') {
    return [
      { id: 'recortar', label: 'Recortar' },
      { id: 'dibujar', label: 'Dibujar / Firmar' },
      { id: 'dividir', label: 'Dividir' },
      { id: 'rotar', label: 'Rotar' },
      { id: 'ajustar', label: 'Comprimir' }
    ]
  }
  if (ext === 'docx' || ext === 'txt') {
    return [
      { id: 'editar', label: 'Editar Texto' },
      { id: 'dibujar', label: 'Firmar' },
      { id: 'recortar', label: 'Recortar' },
      { id: 'rotar', label: 'Rotar' }
    ]
  }
  return [
    { id: 'recortar', label: 'Recortar' },
    { id: 'dibujar', label: 'Dibujar' },
    { id: 'ajustar', label: 'Ajustar' },
    { id: 'rotar', label: 'Rotar' }
  ]
})

const cambiarHerramientaEnVentana = async (nuevaTool: TipoHerramienta) => {
  herramientaActual.value = nuevaTool
  zoomNivel.value = 100
  modoPan.value = false
  if (
    nuevaTool !== 'editar' &&
    nuevaTool !== 'dividir' &&
    nuevaTool !== 'multimedia' &&
    nuevaTool !== 'capturar' &&
    nuevaTool !== 'gif'
  ) {
    await sincronizarCanvasVistaPrevia()
  }
}

const estiloCanvasZoom = computed(() => {
  const factor = zoomNivel.value / 100
  return {
    width: `${Math.round(anchoBaseVisual.value * factor)}px`,
    height: `${Math.round(altoBaseVisual.value * factor)}px`
  }
})

function crearPathSegmento(anguloCentralGrados: number): string {
  const cx = 160
  const cy = 160
  const R2 = 142
  const R1 = 68
  const gap = 5.5
  const rOut = 15
  const rIn = 11
  const halfAngle = Math.PI / 4

  const aRad = (anguloCentralGrados * Math.PI) / 180
  const dOut = Math.asin((gap + rOut) / (R2 - rOut))
  const dIn = Math.asin((gap + rIn) / (R1 + rIn))

  const distOut = Math.sqrt((R2 - rOut) ** 2 - (gap + rOut) ** 2)
  const distIn = Math.sqrt((R1 + rIn) ** 2 - (gap + rIn) ** 2)

  const aStart = aRad - halfAngle
  const aEnd = aRad + halfAngle

  const p1x = cx + distOut * Math.cos(aStart) - gap * Math.sin(aStart)
  const p1y = cy + distOut * Math.sin(aStart) + gap * Math.cos(aStart)
  const p2x = cx + R2 * Math.cos(aStart + dOut)
  const p2y = cy + R2 * Math.sin(aStart + dOut)

  const p3x = cx + R2 * Math.cos(aEnd - dOut)
  const p3y = cy + R2 * Math.sin(aEnd - dOut)
  const p4x = cx + distOut * Math.cos(aEnd) + gap * Math.sin(aEnd)
  const p4y = cy + distOut * Math.sin(aEnd) - gap * Math.cos(aEnd)

  const p5x = cx + distIn * Math.cos(aEnd) + gap * Math.sin(aEnd)
  const p5y = cy + distIn * Math.sin(aEnd) - gap * Math.cos(aEnd)
  const p6x = cx + R1 * Math.cos(aEnd - dIn)
  const p6y = cy + R1 * Math.sin(aEnd - dIn)

  const p7x = cx + R1 * Math.cos(aStart + dIn)
  const p7y = cy + R1 * Math.sin(aStart + dIn)
  const p8x = cx + distIn * Math.cos(aStart) - gap * Math.sin(aStart)
  const p8y = cy + distIn * Math.sin(aStart) + gap * Math.cos(aStart)

  return [
    `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 0 1 ${p2x.toFixed(2)} ${p2y.toFixed(2)}`,
    `A ${R2} ${R2} 0 0 1 ${p3x.toFixed(2)} ${p3y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 0 1 ${p4x.toFixed(2)} ${p4y.toFixed(2)}`,
    `L ${p5x.toFixed(2)} ${p5y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 0 1 ${p6x.toFixed(2)} ${p6y.toFixed(2)}`,
    `A ${R1} ${R1} 0 0 0 ${p7x.toFixed(2)} ${p7y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 0 1 ${p8x.toFixed(2)} ${p8y.toFixed(2)}`,
    'Z'
  ].join(' ')
}

// 1. Catálogo de CONVERSIÓN (Incluye Video y Audio)
const catalogoConversion = {
  pdf: [
    { id: 'docx', label: 'DOCX', angulo: -90, tx: 160, ty: 55 },
    { id: 'jpg', label: 'JPG', angulo: 0, tx: 265, ty: 160 },
    { id: 'png', label: 'PNG', angulo: 90, tx: 160, ty: 265 },
    { id: 'txt', label: 'TXT', angulo: 180, tx: 55, ty: 160 }
  ],
  docx: [
    { id: 'pdf', label: 'PDF', angulo: -90, tx: 160, ty: 55 },
    { id: 'jpg', label: 'JPG', angulo: 0, tx: 265, ty: 160 },
    { id: 'png', label: 'PNG', angulo: 90, tx: 160, ty: 265 },
    { id: 'txt', label: 'TXT', angulo: 180, tx: 55, ty: 160 }
  ],
  txt: [
    { id: 'docx', label: 'DOCX', angulo: -90, tx: 160, ty: 55 },
    { id: 'jpg', label: 'JPG', angulo: 0, tx: 265, ty: 160 },
    { id: 'png', label: 'PNG', angulo: 90, tx: 160, ty: 265 },
    { id: 'pdf', label: 'PDF', angulo: 180, tx: 55, ty: 160 }
  ],
  imagen: [
    { id: 'pdf', label: 'PDF', angulo: -90, tx: 160, ty: 55 },
    { id: 'jpg', label: 'JPG', angulo: 0, tx: 265, ty: 160 },
    { id: 'png', label: 'PNG', angulo: 90, tx: 160, ty: 265 },
    { id: 'webp', label: 'WEBP', angulo: 180, tx: 55, ty: 160 }
  ],
  video: [
    { id: 'wav', label: 'WAV', angulo: -90, tx: 160, ty: 55 },
    { id: 'gif', label: 'GIF', angulo: 0, tx: 265, ty: 160 },
    { id: 'mp3', label: 'MP3', angulo: 90, tx: 160, ty: 265 },
    { id: 'jpg', label: 'FRAME', angulo: 180, tx: 55, ty: 160 }
  ],
  audio: [
    { id: 'wav', label: 'WAV', angulo: -90, tx: 160, ty: 55 },
    { id: 'mp3', label: 'MP3', angulo: 0, tx: 265, ty: 160 },
    { id: 'webm', label: 'WEBM', angulo: 90, tx: 160, ty: 265 },
    { id: 'txt', label: 'INFO', angulo: 180, tx: 55, ty: 160 }
  ]
}

// 2. Catálogo de HERRAMIENTAS (Scroll Abajo - Incluye herramientas de Video y Audio)
const catalogoHerramientas = {
  pdf: [
    { id: 'tool:recortar', label: 'RECORTAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:dibujar', label: 'DIBUJAR', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:dividir', label: 'DIVIDIR', angulo: 90, tx: 160, ty: 265 },
    { id: 'tool:rotar', label: 'ROTAR', angulo: 180, tx: 55, ty: 160 }
  ],
  imagen: [
    { id: 'tool:recortar', label: 'RECORTAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:dibujar', label: 'DIBUJAR', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:ajustar', label: 'AJUSTAR', angulo: 90, tx: 160, ty: 265 },
    { id: 'tool:rotar', label: 'ROTAR', angulo: 180, tx: 55, ty: 160 }
  ],
  docx: [
    { id: 'tool:editar', label: 'EDITAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:dibujar', label: 'FIRMAR', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:recortar', label: 'RECORTAR', angulo: 90, tx: 160, ty: 265 },
    { id: 'tool:rotar', label: 'ROTAR', angulo: 180, tx: 55, ty: 160 }
  ],
  txt: [
    { id: 'tool:editar', label: 'EDITAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:dibujar', label: 'FIRMAR', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:recortar', label: 'RECORTAR', angulo: 90, tx: 160, ty: 265 },
    { id: 'tool:rotar', label: 'ROTAR', angulo: 180, tx: 55, ty: 160 }
  ],
  video: [
    { id: 'tool:multimedia', label: 'RECORTAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:capturar', label: 'CAPTURAR', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:gif', label: 'CREAR GIF', angulo: 90, tx: 160, ty: 265 },
    { id: 'tool:multimedia', label: 'VOLUMEN', angulo: 180, tx: 55, ty: 160 }
  ],
  audio: [
    { id: 'tool:multimedia', label: 'RECORTAR', angulo: -90, tx: 160, ty: 55 },
    { id: 'tool:multimedia', label: 'VOLUMEN', angulo: 0, tx: 265, ty: 160 },
    { id: 'tool:multimedia', label: 'VELOCIDAD', angulo: 90, tx: 160, ty: 265 },
    { id: 'wav', label: 'A WAV', angulo: 180, tx: 55, ty: 160 }
  ]
}

const etiquetaCentro = computed(() => {
  if (opcionActiva.value) {
    return opcionActiva.value.replace('tool:', '').replace('unir-pdf', 'UNIR').toUpperCase()
  }
  if (modoRueda.value === 'herramientas') return 'TOOLS'
  if (cantidadArchivosEnVuelo.value > 1) {
    const sufijo =
      tipoDetectado.value === 'imagen' ? 'IMGS' : `${tipoDetectado.value.toUpperCase()}S`
    return `${cantidadArchivosEnVuelo.value} ${sufijo}`
  }
  if (tipoDetectado.value === 'imagen') return 'IMG'
  return tipoDetectado.value.toUpperCase()
})

const segmentos = computed(() => {
  const fuente =
    modoRueda.value === 'herramientas' ? catalogoHerramientas : catalogoConversion
  const opcionesBase = [...(fuente[tipoDetectado.value] || fuente.pdf)]

  if (
    modoRueda.value === 'conversion' &&
    tipoDetectado.value === 'pdf' &&
    cantidadArchivosEnVuelo.value > 1
  ) {
    opcionesBase[0] = { id: 'unir-pdf', label: 'UNIR PDF', angulo: -90, tx: 160, ty: 55 }
  }

  if (
    modoRueda.value === 'conversion' &&
    tipoDetectado.value === 'imagen' &&
    cantidadArchivosEnVuelo.value > 1
  ) {
    opcionesBase[0] = { id: 'pdf', label: 'UNIR PDF', angulo: -90, tx: 160, ty: 55 }
  }

  return opcionesBase.map((op) => ({
    ...op,
    path: crearPathSegmento(op.angulo)
  }))
})

const cambiarModoPorScroll = (direccion: 'up' | 'down') => {
  if (direccion === 'down' && modoRueda.value !== 'herramientas') {
    modoRueda.value = 'herramientas'
    opcionActiva.value = null
  } else if (direccion === 'up' && modoRueda.value !== 'conversion') {
    modoRueda.value = 'conversion'
    opcionActiva.value = null
  }
}

const onWheelLocal = (e: WheelEvent) => {
  if (ventanaAbierta.value || trayMenuAbierto.value) return
  if (e.deltaY > 0) cambiarModoPorScroll('down')
  else if (e.deltaY < 0) cambiarModoPorScroll('up')
}

// --- FUNCIONES DEL PANEL DE BANDEJA Y BUSCADOR DE ACTUALIZACIONES ---
const aplicarEstadoTray = (estado: EstadoTrayOrbit) => {
  if (estado.x) trayPosX.value = estado.x
  if (estado.y) trayPosY.value = estado.y
  trayPausado.value = estado.pausadoGaming
  trayMinutosTimer.value = estado.minutosTimer
  trayModoTecla.value = estado.modoTeclaActual
  trayArchivosRecientes.value = estado.archivosRecientes
  trayIniciarConWindows.value = estado.iniciarConWindows
  if (estado.versionApp) trayVersionApp.value = estado.versionApp
}

const ejecutarAccionTray = async (
  tipo:
    | 'toggle-gaming'
    | 'timer'
    | 'tecla'
    | 'autostart'
    | 'abrir-reciente'
    | 'limpiar-recientes'
    | 'salir',
  valor?: any
) => {
  const nuevoEstado = await window.api.actualizarConfigTray({ tipo, valor })
  aplicarEstadoTray(nuevoEstado)
  if (tipo === 'abrir-reciente') {
    cerrarMenuTray()
  }
}

const verificarActualizacionesApp = async () => {
  buscandoUpdate.value = true
  infoUpdate.value = null
  try {
    infoUpdate.value = await window.api.buscarActualizaciones()
  } catch {
    infoUpdate.value = {
      estado: 'error',
      mensaje: 'No se pudo conectar con el servidor de versiones'
    }
  } finally {
    buscandoUpdate.value = false
  }
}

const cerrarMenuTray = () => {
  trayMenuAbierto.value = false
  infoUpdate.value = null
  window.api.cerrarMenu()
}

// --- FUNCIONES DE LA NOTIFICACIÓN TOAST FLOTANTE ---
const configurarMouseToast = (ignorar: boolean) => {
  window.api.setMouseIgnore(ignorar)
}

const abrirArchivoDesdeToast = async () => {
  if (toastData.value.ruta) {
    await window.api.mostrarArchivoEnCarpeta(toastData.value.ruta)
  }
  cerrarToast()
}

const cerrarToast = () => {
  toastVisible.value = false
  window.api.setMouseIgnore(true)
}

// --- CODIFICADOR NATIVO WAV (PCM 16-BIT) Y GIF89A ANIMADO ---
function codificarAudioBufferAWav(
  audioBuffer: AudioBuffer,
  inicioSeg = 0,
  finSeg?: number,
  gananciaVolumen = 1.0
): Uint8Array {
  const sampleRate = audioBuffer.sampleRate
  const numChannels = Math.min(2, audioBuffer.numberOfChannels)
  const startSample = Math.max(0, Math.floor(inicioSeg * sampleRate))
  const endSample = Math.min(
    audioBuffer.length,
    finSeg ? Math.floor(finSeg * sampleRate) : audioBuffer.length
  )
  const frameCount = Math.max(1, endSample - startSample)

  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = frameCount * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c))
  }

  let offset = 44
  for (let i = 0; i < frameCount; i++) {
    const idx = startSample + i
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][idx] * gananciaVolumen))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

// Codificador GIF89a nativo con paleta cuantizada 3-3-2 (256 colores)
function codificarFramesAGif(
  frames: ImageData[],
  width: number,
  height: number,
  delayMs: number
): Uint8Array {
  const bytes: number[] = []
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i))
  }
  const writeU16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff)
  }

  writeStr('GIF89a')
  writeU16(width)
  writeU16(height)
  bytes.push(0xf7, 0, 0)

  // Paleta global 3-3-2 (256 colores exactos)
  for (let i = 0; i < 256; i++) {
    const r = Math.round(((i >> 5) & 0x07) * (255 / 7))
    const g = Math.round(((i >> 2) & 0x07) * (255 / 7))
    const b = Math.round((i & 0x03) * (255 / 3))
    bytes.push(r, g, b)
  }

  // Extensión Netscape para bucle infinito
  bytes.push(0x21, 0xff, 0x0b)
  writeStr('NETSCAPE2.0')
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00)

  const delayCs = Math.max(2, Math.round(delayMs / 10))

  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x00)
    writeU16(delayCs)
    bytes.push(0x00, 0x00)

    bytes.push(0x2c)
    writeU16(0)
    writeU16(0)
    writeU16(width)
    writeU16(height)
    bytes.push(0x00)

    // LZW con código mínimo de 8 bits y reinicio de diccionario cada 250 píxeles
    bytes.push(8)
    const data = frame.data
    const totalPixels = width * height

    let bitBuffer = 0
    let bitCount = 0
    let subBlock: number[] = []

    const emitCode = (code: number) => {
      bitBuffer |= code << bitCount
      bitCount += 9
      while (bitCount >= 8) {
        subBlock.push(bitBuffer & 0xff)
        bitBuffer >>= 8
        bitCount -= 8
        if (subBlock.length === 255) {
          bytes.push(255, ...subBlock)
          subBlock = []
        }
      }
    }

    emitCode(256) // Clear code inicial
    let countInTable = 0
    for (let p = 0; p < totalPixels; p++) {
      const idx = p * 4
      const r = data[idx] >> 5
      const g = data[idx + 1] >> 5
      const b = data[idx + 2] >> 6
      const colorIdx = (r << 5) | (g << 2) | b
      emitCode(colorIdx)
      countInTable++
      if (countInTable === 250) {
        emitCode(256)
        countInTable = 0
      }
    }
    emitCode(257) // End of Information code

    if (bitCount > 0) {
      subBlock.push(bitBuffer & 0xff)
    }
    if (subBlock.length > 0) {
      bytes.push(subBlock.length, ...subBlock)
    }
    bytes.push(0x00)
  }

  bytes.push(0x3b)
  return new Uint8Array(bytes)
}

// --- PEGAR IMAGEN DESDE PORTAPAPELES (CTRL + V) ---
const abrirImagenDesdePortapapeles = async (toolInicial: TipoHerramienta = 'recortar') => {
  const clip = await window.api.leerImagenPortapapeles()
  if (!clip) return

  trayMenuAbierto.value = false
  showMenu.value = false
  procesando.value = true
  window.api.activarModoVentana()

  try {
    rutaArchivoActivo.value = clip.rutaSugerida
    nombreArchivoActivo.value = clip.nombre
    extArchivoActivo.value = 'png'
    herramientaActual.value = toolInicial
    paginaIndice.value = 0
    rotacionGrados.value = 0
    voltearH.value = false
    voltearV.value = false
    zoomNivel.value = 100
    modoPan.value = false

    const img = await cargarImagenDesdeBytes(clip.pngBytes, 'image/png')
    const c = document.createElement('canvas')
    c.width = img.naturalWidth || 800
    c.height = img.naturalHeight || 600
    const ctx = c.getContext('2d', { alpha: false })!
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0)

    paginasCanvases.value = [c]
    paginasMiniaturas.value = [c.toDataURL('image/jpeg', 0.8)]
    ventanaAbierta.value = true
    await sincronizarCanvasVistaPrevia()
  } catch (error) {
    console.error('Error abriendo captura del portapapeles:', error)
    cerrarVentanaHerramienta()
  } finally {
    procesando.value = false
  }
}

onMounted(() => {
  window.api.onToggleMenu((data) => {
    if (ventanaAbierta.value || trayMenuAbierto.value) return
    if (data.mostrar) {
      posX.value = data.x
      posY.value = data.y
      modoRueda.value = 'conversion'
      cantidadArchivosEnVuelo.value = 1
      showMenu.value = true
    } else if (!procesando.value) {
      showMenu.value = false
      opcionActiva.value = null
      modoRueda.value = 'conversion'
      cantidadArchivosEnVuelo.value = 1
    }
  })

  window.api.onScrollMenu((direccion) => {
    if (showMenu.value && !ventanaAbierta.value && !trayMenuAbierto.value) {
      cambiarModoPorScroll(direccion)
    }
  })

  window.api.onTrayMenu((estado) => {
    showMenu.value = false
    aplicarEstadoTray(estado)
    trayMenuAbierto.value = estado.mostrar
  })

  window.api.onArchivoGuardadoToast((data) => {
    toastData.value = data
    toastVisible.value = true
    if (timerToastUI) window.clearTimeout(timerToastUI)
    timerToastUI = window.setTimeout(() => {
      toastVisible.value = false
    }, 4000)
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (trayMenuAbierto.value) cerrarMenuTray()
      else if (ventanaAbierta.value) cerrarVentanaHerramienta()
    } else if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'v' &&
      (showMenu.value || trayMenuAbierto.value) &&
      !ventanaAbierta.value
    ) {
      e.preventDefault()
      abrirImagenDesdePortapapeles('recortar')
    } else if (ventanaAbierta.value && e.code === 'Space' && herramientaActual.value !== 'editar') {
      espacioPresionado.value = true
    } else if (
      ventanaAbierta.value &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'z'
    ) {
      if (herramientaActual.value === 'dibujar') {
        e.preventDefault()
        deshacerTrazo()
      }
    }
  })

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      espacioPresionado.value = false
      arrastrandoPan.value = false
    }
  })
})

const detectarTipoEnVuelo = (event: DragEvent) => {
  event.preventDefault()
  const items = event.dataTransfer?.items
  if (!items || items.length === 0) return

  cantidadArchivosEnVuelo.value = items.length

  const mime = (items[0].type || '').toLowerCase()
  if (mime.startsWith('video/')) {
    tipoDetectado.value = 'video'
  } else if (mime.startsWith('audio/')) {
    tipoDetectado.value = 'audio'
  } else if (mime.startsWith('image/')) {
    tipoDetectado.value = 'imagen'
  } else if (mime.includes('word') || mime.includes('officedocument')) {
    tipoDetectado.value = 'docx'
  } else if (mime === 'text/plain') {
    tipoDetectado.value = 'txt'
  } else if (mime.includes('pdf')) {
    tipoDetectado.value = 'pdf'
  }
}

const canvasToUint8ArrayDirecto = (
  canvas: HTMLCanvasElement,
  formato: string,
  calidad = 0.92
): Promise<Uint8Array> => {
  const mime =
    formato === 'jpg' ? 'image/jpeg' : formato === 'webp' ? 'image/webp' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error('Error creando blob'))
        const ab = await blob.arrayBuffer()
        resolve(new Uint8Array(ab))
      },
      mime,
      calidad
    )
  })
}

const uint8ToBase64 = (u8Arr: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < u8Arr.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(u8Arr.subarray(i, i + chunkSize)))
  }
  return window.btoa(binary)
}

const cargarImagenDesdeBytes = (bytes: Uint8Array, mime = 'image/png'): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as any)
    const base64 = uint8ToBase64(u8)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (err) => reject(err)
    img.src = `data:${mime};base64,${base64}`
  })
}

const renderizarPaginaACanvas = async (
  page: any,
  maxLado = 1500
): Promise<{ canvas: HTMLCanvasElement; scale: number; pageWidth: number; pageHeight: number }> => {
  const baseVp = page.getViewport({ scale: 1.0 })
  const ladoMayor = Math.max(baseVp.width, baseVp.height)
  const scale = Math.min(2.2, Math.max(1.2, maxLado / ladoMayor))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Error en canvas 2D')

  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const renderTask = page.render({ canvasContext: context, viewport } as any)
  await renderTask.promise

  return { canvas, scale, pageWidth: baseVp.width, pageHeight: baseVp.height }
}

const renderizarBloquesACanvases = async (
  bloques: BloqueDocumento[]
): Promise<HTMLCanvasElement[]> => {
  const W = 1224
  const H = 1584
  const marginX = 110
  const marginY = 85
  const maxLineWidth = W - marginX * 2

  const canvases: HTMLCanvasElement[] = []
  let currentCanvas = document.createElement('canvas')
  currentCanvas.width = W
  currentCanvas.height = H
  let ctx = currentCanvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  canvases.push(currentCanvas)

  let cursorY = marginY

  const nuevaPagina = () => {
    currentCanvas = document.createElement('canvas')
    currentCanvas.width = W
    currentCanvas.height = H
    ctx = currentCanvas.getContext('2d', { alpha: false })!
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)
    canvases.push(currentCanvas)
    cursorY = marginY
  }

  for (const b of bloques) {
    if (b.tipo === 'salto_pagina') {
      nuevaPagina()
      continue
    }

    if (b.tipo === 'imagen' && b.pngBytes && b.pngBytes.byteLength > 0) {
      try {
        const img = await cargarImagenDesdeBytes(b.pngBytes)
        let drawW = (b.width || img.naturalWidth || 600) * 1.55
        let drawH = (b.height || img.naturalHeight || 400) * 1.55

        if (drawW > maxLineWidth) {
          const ratio = maxLineWidth / drawW
          drawW = maxLineWidth
          drawH = drawH * ratio
        }
        const maxPageH = H - marginY * 2
        if (drawH > maxPageH) {
          const ratio = maxPageH / drawH
          drawH = maxPageH
          drawW = drawW * ratio
        }

        if (cursorY + drawH > H - marginY && cursorY > marginY + 20) {
          nuevaPagina()
        }

        let drawX = marginX
        if (b.align === 'center' || !b.align) drawX = (W - drawW) / 2
        else if (b.align === 'right') drawX = W - marginX - drawW

        ctx.drawImage(img, drawX, cursorY, drawW, drawH)
        cursorY += drawH + 18
      } catch (e) {
        console.error('Error dibujando imagen de DOCX en canvas:', e)
      }
      continue
    }

    if (b.tipo === 'tabla' && b.filasTabla && b.filasTabla.length > 0) {
      const numCols = Math.max(...b.filasTabla.map((f) => f.length))
      const colW = maxLineWidth / numCols
      const fontSizePx = 20
      const rowH = 54

      cursorY += 10
      for (const fila of b.filasTabla) {
        if (cursorY + rowH > H - marginY) nuevaPagina()

        for (let c = 0; c < numCols; c++) {
          const cellX = marginX + c * colW
          ctx.strokeStyle = '#000000'
          ctx.lineWidth = 2
          ctx.strokeRect(cellX, cursorY, colW, rowH)

          const celdaSegs = fila[c] || []
          let textX = cellX + 16
          for (const seg of celdaSegs) {
            ctx.font = `${seg.bold ? 'bold ' : ''}${fontSizePx}px Calibri, Arial, sans-serif`
            ctx.fillStyle = '#000000'
            ctx.fillText(seg.texto, textX, cursorY + 34)
            textX += ctx.measureText(seg.texto).width
          }
        }
        cursorY += rowH
      }
      cursorY += 20
      continue
    }

    const fontSizePx = Math.round((b.fontSize || 10.5) * 2.0)
    const lineHeight = Math.round(fontSizePx * 1.35)
    const indentPx = b.indentLeft ? Math.min(400, Math.round(b.indentLeft * 0.12)) : 0
    const startX = marginX + indentPx
    const availW = maxLineWidth - indentPx

    const segs: SegmentoTexto[] =
      b.segmentos && b.segmentos.length > 0
        ? b.segmentos
        : [{ texto: b.texto || '', bold: b.bold, fontSize: b.fontSize }]

    interface TokenPalabra {
      texto: string
      bold: boolean
      width: number
    }
    const tokens: TokenPalabra[] = []

    for (const seg of segs) {
      const isBold = !!(seg.bold ?? b.bold)
      ctx.font = `${isBold ? 'bold ' : ''}${fontSizePx}px Calibri, Arial, sans-serif`
      const partes = (seg.texto || '').split(/(\s+)/)
      for (const p of partes) {
        if (!p) continue
        tokens.push({
          texto: p,
          bold: isBold,
          width: ctx.measureText(p).width
        })
      }
    }

    if (tokens.length === 0) {
      cursorY += Math.round(lineHeight * 0.6)
      continue
    }

    const lineasTokens: TokenPalabra[][] = [[]]
    let anchoActual = 0

    for (const tk of tokens) {
      const lineaActual = lineasTokens[lineasTokens.length - 1]
      if (lineaActual.length === 0 && /^\s+$/.test(tk.texto)) continue

      if (anchoActual + tk.width > availW && lineaActual.length > 0) {
        lineasTokens.push([tk])
        anchoActual = tk.width
      } else {
        lineaActual.push(tk)
        anchoActual += tk.width
      }
    }

    for (const linea of lineasTokens) {
      if (cursorY + lineHeight > H - marginY) nuevaPagina()

      const totalLineW = linea.reduce((acc, t) => acc + t.width, 0)
      let drawX = startX
      if (b.align === 'center') drawX = (W - totalLineW) / 2
      else if (b.align === 'right') drawX = W - marginX - totalLineW

      for (const tk of linea) {
        ctx.font = `${tk.bold ? 'bold ' : ''}${fontSizePx}px Calibri, Arial, sans-serif`
        ctx.fillStyle = '#111827'
        ctx.fillText(tk.texto, drawX, cursorY + fontSizePx)
        drawX += tk.width
      }
      cursorY += lineHeight
    }

    cursorY += Math.round(fontSizePx * 0.25)
  }

  return canvases
}

const renderizarBloquesAPaginas = async (
  bloques: BloqueDocumento[],
  formatoImagen: 'png' | 'jpg'
): Promise<Uint8Array[]> => {
  const canvases = await renderizarBloquesACanvases(bloques)
  const paginasBytes: Uint8Array[] = []
  for (const c of canvases) {
    const bytes = await canvasToUint8ArrayDirecto(c, formatoImagen)
    paginasBytes.push(bytes)
  }
  return paginasBytes
}

const esFuenteNegrita = (page: any, styles: any, fontKey: string, fontSize: number): boolean => {
  let nombreReal = String(fontKey || '').toLowerCase()
  const styleFamily = String(styles[fontKey]?.fontFamily || '').toLowerCase()

  try {
    if (page.commonObjs && page.commonObjs.has(fontKey)) {
      const fontObj = page.commonObjs.get(fontKey)
      if (fontObj) {
        if (fontObj.bold || fontObj.black) return true
        if (fontObj.name) nombreReal += ' ' + String(fontObj.name).toLowerCase()
      }
    }
  } catch {}

  return (
    nombreReal.includes('bold') ||
    nombreReal.includes('black') ||
    nombreReal.includes('heavy') ||
    nombreReal.includes('demi') ||
    nombreReal.includes('semibold') ||
    nombreReal.includes('-b') ||
    nombreReal.includes(',b') ||
    styleFamily.includes('bold') ||
    fontSize >= 13.5
  )
}

const analizarPaginaCompleta = async (
  page: any,
  textContent: any,
  formatoDestino: 'txt' | 'docx'
): Promise<BloqueDocumento[]> => {
  const { canvas, scale, pageWidth } = await renderizarPaginaACanvas(page, 1400)
  const styles = textContent.styles || {}

  interface ItemTexto {
    str: string
    x: number
    y: number
    w: number
    fontSize: number
    bold: boolean
  }

  const items: ItemTexto[] = []
  for (const raw of textContent.items) {
    const str = raw.str || ''
    if (!str.trim()) continue

    const tx = raw.transform || [10, 0, 0, 10, 0, 0]
    const rawSize = Math.hypot(tx[0], tx[1]) || raw.height || 10
    const fontSize = Math.max(7.5, Math.min(28, Math.round(rawSize * 2) / 2))
    const bold = esFuenteNegrita(page, styles, raw.fontName, fontSize)

    items.push({
      str,
      x: tx[4],
      y: tx[5],
      w: raw.width || str.length * (fontSize * 0.52),
      fontSize,
      bold
    })
  }

  if (items.length === 0) {
    if (formatoDestino === 'docx') {
      const bytes = await canvasToUint8ArrayDirecto(canvas, 'png')
      return [{ tipo: 'imagen', pngBytes: bytes, width: canvas.width, height: canvas.height }]
    }
    return []
  }

  items.sort((a, b) => {
    const tol = Math.max(a.fontSize, b.fontSize) * 0.42
    if (Math.abs(a.y - b.y) <= tol) return a.x - b.x
    return b.y - a.y
  })

  interface Renglon {
    y: number
    minX: number
    maxX: number
    fontSize: number
    bold: boolean
    items: ItemTexto[]
    celdas: SegmentoTexto[][]
    textoPlano: string
  }

  const renglones: Renglon[] = []
  for (const item of items) {
    const ultimo = renglones[renglones.length - 1]
    const tolY = ultimo ? Math.max(ultimo.fontSize, item.fontSize) * 0.45 : 0

    if (ultimo && Math.abs(item.y - ultimo.y) <= tolY) {
      ultimo.items.push(item)
      ultimo.minX = Math.min(ultimo.minX, item.x)
      ultimo.maxX = Math.max(ultimo.maxX, item.x + item.w)
      if (item.fontSize > ultimo.fontSize) ultimo.fontSize = item.fontSize
      if (item.bold) ultimo.bold = true
    } else {
      renglones.push({
        y: item.y,
        minX: item.x,
        maxX: item.x + item.w,
        fontSize: item.fontSize,
        bold: item.bold,
        items: [item],
        celdas: [],
        textoPlano: ''
      })
    }
  }

  for (const r of renglones) {
    r.items.sort((a, b) => a.x - b.x)
    const celdas: SegmentoTexto[][] = [[]]
    let textoPlano = ''

    for (let i = 0; i < r.items.length; i++) {
      const actual = r.items[i]
      let prefijo = ''

      if (i > 0) {
        const prev = r.items[i - 1]
        const gap = actual.x - (prev.x + prev.w)

        if (gap > r.fontSize * 2.1 && actual.x > pageWidth * 0.35) {
          celdas.push([])
          textoPlano += '    '
        } else if (
          gap > r.fontSize * 0.12 &&
          !textoPlano.endsWith(' ') &&
          !actual.str.startsWith(' ')
        ) {
          prefijo = ' '
          textoPlano += ' '
        }
      }

      const celdaActual = celdas[celdas.length - 1]
      const textoConEspacio = prefijo + actual.str
      textoPlano += actual.str

      const ultimoSeg = celdaActual[celdaActual.length - 1]
      if (
        ultimoSeg &&
        ultimoSeg.bold === actual.bold &&
        Math.abs((ultimoSeg.fontSize || r.fontSize) - actual.fontSize) <= 0.5
      ) {
        ultimoSeg.texto += textoConEspacio
      } else {
        celdaActual.push({
          texto: textoConEspacio,
          bold: actual.bold,
          fontSize: actual.fontSize
        })
      }
    }

    r.celdas = celdas
    r.textoPlano = textoPlano.trim()
  }

  const minXPagina = Math.min(...renglones.map((r) => r.minX))
  const maxXPagina = Math.max(...renglones.map((r) => r.maxX))
  const anchoUtil = Math.max(200, maxXPagina - minXPagina)

  const bloquesPosicion: BloqueConPosicion[] = []
  const cajasTablaPdf: { topY: number; bottomY: number }[] = []

  let i = 0
  while (i < renglones.length) {
    const r = renglones[i]

    if (r.celdas.length >= 2) {
      const filasTabla: SegmentoTexto[][][] = [r.celdas]
      const topY = r.y + r.fontSize * 1.2
      let bottomY = r.y - r.fontSize * 1.6

      let j = i + 1
      while (j < renglones.length && renglones[j].celdas.length >= 2) {
        filasTabla.push(renglones[j].celdas)
        bottomY = renglones[j].y - renglones[j].fontSize * 1.6
        j++
      }

      cajasTablaPdf.push({ topY, bottomY })
      bloquesPosicion.push({
        pdfY: r.y,
        pdfBottomY: bottomY,
        bloque: {
          tipo: 'tabla',
          filasTabla
        }
      })

      i = j
      continue
    }

    const prev = i > 0 ? renglones[i - 1] : null
    const deltaY = prev ? prev.y - r.y : 0

    const centroRenglon = (r.minX + r.maxX) / 2
    const centroPagina = pageWidth / 2
    const anchoRenglon = r.maxX - r.minX

    const esDerecha =
      r.minX > pageWidth * 0.44 &&
      r.maxX >= maxXPagina - 55 &&
      anchoRenglon < anchoUtil * 0.65

    const esCentrado =
      !esDerecha &&
      anchoRenglon < anchoUtil * 0.82 &&
      Math.abs(centroRenglon - centroPagina) < pageWidth * 0.08 &&
      r.minX - minXPagina > 22

    const align: 'left' | 'center' | 'right' | 'both' = esDerecha
      ? 'right'
      : esCentrado
        ? 'center'
        : 'left'

    const esLista = /^([a-zA-Z0-9][\.\)]|\u2022|-|\*)\s/.test(r.textoPlano)

    const ultimoItem = bloquesPosicion[bloquesPosicion.length - 1]
    const prevEraTextoLargo =
      prev &&
      prev.celdas.length === 1 &&
      prev.minX < minXPagina + 25 &&
      prev.maxX > minXPagina + anchoUtil * 0.82

    const puedeUnirse =
      ultimoItem &&
      ultimoItem.bloque.tipo === 'texto' &&
      ultimoItem.bloque.align !== 'center' &&
      ultimoItem.bloque.align !== 'right' &&
      align === 'left' &&
      prevEraTextoLargo &&
      !esLista &&
      prev &&
      Math.abs(prev.fontSize - r.fontSize) <= 0.5 &&
      prev.bold === r.bold &&
      deltaY > 0 &&
      deltaY <= r.fontSize * 1.45

    if (puedeUnirse && ultimoItem.bloque.segmentos) {
      ultimoItem.bloque.segmentos.push({
        texto: ' ' + r.textoPlano,
        bold: r.bold,
        fontSize: r.fontSize
      })
      ultimoItem.bloque.texto = (ultimoItem.bloque.texto || '') + ' ' + r.textoPlano
      ultimoItem.bloque.align = 'both'
      ultimoItem.pdfBottomY = r.y - r.fontSize
    } else {
      const espacioAntes =
        prev && deltaY > r.fontSize * 1.75
          ? Math.min(220, Math.round((deltaY - r.fontSize) * 8.5))
          : 0

      const sangriaPuntos = align === 'left' ? Math.max(0, r.minX - minXPagina) : 0
      const indentLeft = sangriaPuntos > 18 ? Math.min(2400, Math.round(sangriaPuntos * 16)) : 0

      bloquesPosicion.push({
        pdfY: r.y,
        pdfBottomY: r.y - r.fontSize,
        bloque: {
          tipo: 'texto',
          texto: r.textoPlano,
          segmentos: r.celdas[0],
          fontSize: r.fontSize,
          bold: r.bold,
          align,
          indentLeft,
          espacioAntes,
          espacioDespues: r.fontSize >= 12 ? 60 : 25
        }
      })
    }

    i++
  }

  if (formatoDestino === 'docx') {
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#FFFFFF'

      for (const item of items) {
        const cx = item.x * scale - 4
        const cy = canvas.height - item.y * scale - item.fontSize * scale * 1.05
        const cw = item.w * scale + 8
        const ch = item.fontSize * scale * 1.4
        ctx.fillRect(cx, cy, cw, ch)
      }

      for (const caja of cajasTablaPdf) {
        const topPx = canvas.height - caja.topY * scale - 4
        const bottomPx = canvas.height - caja.bottomY * scale + 12
        ctx.fillRect(0, topPx, canvas.width, Math.max(10, bottomPx - topPx))
      }

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const filasConGrafico: boolean[] = new Array(canvas.height).fill(false)

      const margenBorde = Math.floor(canvas.width * 0.03)
      for (let py = 8; py < canvas.height - 8; py++) {
        let pixelesNoBlancos = 0
        for (let px = margenBorde; px < canvas.width - margenBorde; px++) {
          const idx = (py * canvas.width + px) * 4
          if (imgData[idx] < 242 || imgData[idx + 1] < 242 || imgData[idx + 2] < 242) {
            pixelesNoBlancos++
            if (pixelesNoBlancos >= 4) {
              filasConGrafico[py] = true
              break
            }
          }
        }
      }

      const bandas: { startY: number; endY: number }[] = []
      let enBanda = false
      let inicioActual = 0
      let huecos = 0

      for (let py = 0; py < canvas.height; py++) {
        if (filasConGrafico[py]) {
          if (!enBanda) {
            enBanda = true
            inicioActual = py
          }
          huecos = 0
        } else if (enBanda) {
          huecos++
          if (huecos > Math.round(14 * scale)) {
            bandas.push({ startY: inicioActual, endY: py - huecos })
            enBanda = false
          }
        }
      }
      if (enBanda) {
        bandas.push({ startY: inicioActual, endY: canvas.height - 1 })
      }

      const cropLeft = Math.floor(Math.max(0, (minXPagina - 10) * scale))
      const cropRight = Math.min(canvas.width, Math.ceil((maxXPagina + 15) * scale))
      const cropWidth = Math.max(200, cropRight - cropLeft)

      for (const banda of bandas) {
        const altoBanda = banda.endY - banda.startY
        if (altoBanda < Math.round(12 * scale)) continue

        const padY = 4
        const sy = Math.max(0, banda.startY - padY)
        const sh = Math.min(canvas.height - sy, altoBanda + padY * 2)

        const subCanvas = document.createElement('canvas')
        subCanvas.width = cropWidth
        subCanvas.height = sh
        const subCtx = subCanvas.getContext('2d', { alpha: false })
        if (!subCtx) continue

        subCtx.fillStyle = '#FFFFFF'
        subCtx.fillRect(0, 0, cropWidth, sh)
        subCtx.drawImage(canvas, cropLeft, sy, cropWidth, sh, 0, 0, cropWidth, sh)

        const pngBytes = await canvasToUint8ArrayDirecto(subCanvas, 'png')
        const pdfYImagen = (canvas.height - (banda.startY + altoBanda * 0.35)) / scale

        bloquesPosicion.push({
          pdfY: pdfYImagen,
          pdfBottomY: (canvas.height - banda.endY) / scale,
          bloque: {
            tipo: 'imagen',
            pngBytes,
            width: Math.round(cropWidth / scale),
            height: Math.round(sh / scale),
            align: 'center'
          }
        })
      }
    }
  }

  bloquesPosicion.sort((a, b) => b.pdfY - a.pdfY)
  return bloquesPosicion.map((item) => item.bloque)
}

// --- MOTOR DE CONVERSIÓN DIRECTA DE VIDEO Y AUDIO ---
const extraerAudioAWavDirecto = async (
  bytesOrigen: Uint8Array,
  inicioSeg = 0,
  finSeg?: number,
  ganancia = 1.0,
  velocidad = 1.0
): Promise<Uint8Array> => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  try {
    const copiaBuffer = bytesOrigen.buffer.slice(
      bytesOrigen.byteOffset,
      bytesOrigen.byteOffset + bytesOrigen.byteLength
    ) as ArrayBuffer
    const decoded = await audioCtx.decodeAudioData(copiaBuffer)

    if (velocidad !== 1.0) {
      const duracionTramo = (finSeg || decoded.duration) - inicioSeg
      const nuevaLongitud = Math.max(
        1,
        Math.floor((duracionTramo / velocidad) * decoded.sampleRate)
      )
      const offlineCtx = new OfflineAudioContext(
        Math.min(2, decoded.numberOfChannels),
        nuevaLongitud,
        decoded.sampleRate
      )
      const source = offlineCtx.createBufferSource()
      source.buffer = decoded
      source.playbackRate.value = velocidad
      const gainNode = offlineCtx.createGain()
      gainNode.gain.value = ganancia
      source.connect(gainNode)
      gainNode.connect(offlineCtx.destination)
      source.start(0, inicioSeg, duracionTramo)
      const rendered = await offlineCtx.startRendering()
      return codificarAudioBufferAWav(rendered, 0, rendered.duration, 1.0)
    }

    return codificarAudioBufferAWav(decoded, inicioSeg, finSeg, ganancia)
  } finally {
    await audioCtx.close().catch(() => {})
  }
}

const convertirVideoAGif = async (
  videoUrl: string,
  inicioSeg: number,
  finSeg: number,
  fps = 10,
  anchoMax = 360
): Promise<Uint8Array> => {
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  video.playsInline = true

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('No se pudo cargar el video'))
  })

  const duracionTotal = video.duration || 5
  const tStart = Math.max(0, Math.min(inicioSeg, duracionTotal - 0.2))
  const tEnd = Math.min(duracionTotal, Math.max(tStart + 0.5, finSeg))
  const pasoSeg = 1 / fps

  const ratio = (video.videoHeight || 360) / (video.videoWidth || 640)
  const w = anchoMax
  const h = Math.max(60, Math.round(w * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const frames: ImageData[] = []
  const maxFrames = 65

  for (let t = tStart; t <= tEnd && frames.length < maxFrames; t += pasoSeg) {
    video.currentTime = t
    await new Promise<void>((res) => {
      const onSeek = () => {
        video.removeEventListener('seeked', onSeek)
        res()
      }
      video.addEventListener('seeked', onSeek)
    })
    ctx.drawImage(video, 0, 0, w, h)
    frames.push(ctx.getImageData(0, 0, w, h))
  }

  return codificarFramesAGif(frames, w, h, Math.round(1000 / fps))
}

const capturarFrameDeVideo = async (
  videoUrl: string,
  segundo = 0.5,
  formato: 'jpg' | 'png' = 'jpg'
): Promise<Uint8Array> => {
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('No se pudo abrir el video'))
  })

  video.currentTime = Math.min(video.duration || 0, Math.max(0, segundo))
  await new Promise<void>((res) => {
    video.onseeked = () => res()
  })

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 1280
  canvas.height = video.videoHeight || 720
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return await canvasToUint8ArrayDirecto(canvas, formato, 0.94)
}

const cambiarZoom = (delta: number) => {
  zoomNivel.value = Math.max(100, Math.min(400, zoomNivel.value + delta))
}

const restablecerZoom = () => {
  zoomNivel.value = 100
  modoPan.value = false
}

const onWheelCanvasZoom = (e: WheelEvent) => {
  if (e.ctrlKey || e.altKey) {
    e.preventDefault()
    const paso = e.deltaY < 0 ? 25 : -25
    cambiarZoom(paso)
  }
}

const sincronizarCanvasVistaPrevia = async () => {
  await nextTick()
  const dest = canvasInteractivoRef.value
  const src = paginasCanvases.value[paginaIndice.value]
  if (!dest || !src) return

  dest.width = src.width
  dest.height = src.height

  const maxW = 660
  const maxH = 390
  const ratio = Math.min(maxW / src.width, maxH / src.height)
  anchoBaseVisual.value = Math.max(180, Math.round(src.width * ratio))
  altoBaseVisual.value = Math.max(180, Math.round(src.height * ratio))

  const ctx = dest.getContext('2d', { willReadFrequently: true })
  if (!ctx) return

  ctx.clearRect(0, 0, dest.width, dest.height)
  ctx.drawImage(src, 0, 0)

  historialTrazos.value = [ctx.getImageData(0, 0, dest.width, dest.height)]

  cajaRecorte.value = {
    x: Math.round(dest.width * 0.15),
    y: Math.round(dest.height * 0.15),
    w: Math.round(dest.width * 0.7),
    h: Math.round(dest.height * 0.7),
    activo: true
  }
}

watch(paginaIndice, () => {
  if (ventanaAbierta.value) {
    sincronizarCanvasVistaPrevia()
  }
})

const onMediaMetadataLoaded = (e: Event) => {
  const el = e.target as HTMLMediaElement
  const d = el.duration && isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 10
  duracionMedia.value = d
  inicioCorteSeg.value = 0
  finCorteSeg.value = d
}

const aplicarVelocidadYVolumen = () => {
  const el = esVideoActivo.value ? videoPlayerRef.value : audioPlayerRef.value
  if (!el) return
  el.playbackRate = velocidadMedia.value
  el.volume = Math.min(1, volumenMediaPct.value / 100)
}

const abrirHerramientaConArchivo = async (file: File, rutaReal: string, tool: TipoHerramienta) => {
  procesando.value = true
  window.api.activarModoVentana()

  rutaArchivoActivo.value = rutaReal
  nombreArchivoActivo.value = file.name
  const ext = rutaReal.split('.').pop()?.toLowerCase() || ''
  extArchivoActivo.value = ext
  herramientaActual.value = tool

  paginasCanvases.value = []
  paginasMiniaturas.value = []
  paginaIndice.value = 0
  rotacionGrados.value = 0
  voltearH.value = false
  voltearV.value = false
  zoomNivel.value = 100
  modoPan.value = false
  volumenMediaPct.value = 100
  velocidadMedia.value = 1

  if (mediaUrlActiva.value) {
    URL.revokeObjectURL(mediaUrlActiva.value)
    mediaUrlActiva.value = ''
  }

  try {
    const esVideo = ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext) || file.type.startsWith('video/')
    const esAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || file.type.startsWith('audio/')
    const esPdf = ext === 'pdf' || file.type === 'application/pdf'
    const esDocTexto = ext === 'docx' || ext === 'txt'

    if (esVideo || esAudio) {
      esVideoActivo.value = esVideo
      const bytes = await window.api.leerArchivoBinario(rutaReal)
      bytesMultimediaOriginal.value = bytes
      const blob = new Blob([bytes], {
        type: file.type || (esVideo ? 'video/mp4' : 'audio/mpeg')
      })
      mediaUrlActiva.value = URL.createObjectURL(blob)
      showMenu.value = false
      ventanaAbierta.value = true
      return
    }

    if (esPdf) {
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true,
        isOffscreenCanvasSupported: false
      } as any)

      const pdf = await loadingTask.promise
      const canvases: HTMLCanvasElement[] = []
      const thumbs: string[] = []
      const sel: number[] = []

      const resObjetivo = tool === 'dibujar' || tool === 'recortar' ? 1750 : 1350

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const { canvas } = await renderizarPaginaACanvas(page, resObjetivo)
        canvases.push(canvas)
        thumbs.push(canvas.toDataURL('image/jpeg', 0.75))
        sel.push(i - 1)
      }

      paginasCanvases.value = canvases
      paginasMiniaturas.value = thumbs
      paginasSeleccionadas.value = sel
    } else if (esDocTexto) {
      const bloques = await window.api.leerDocumentoTexto(rutaReal)
      textoEditable.value = bloques
        .filter((b) => b.tipo === 'texto' && b.texto !== undefined)
        .map((b) => b.texto)
        .join('\n\n')

      const canvases = await renderizarBloquesACanvases(bloques)
      paginasCanvases.value = canvases
      paginasMiniaturas.value = canvases.map((c) => c.toDataURL('image/jpeg', 0.75))
    } else {
      const ab = await file.arrayBuffer()
      const mime = file.type || 'image/png'
      const img = await cargarImagenDesdeBytes(new Uint8Array(ab), mime)
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || 800
      c.height = img.naturalHeight || 600
      const ctx = c.getContext('2d', { alpha: false })!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0)
      paginasCanvases.value = [c]
      paginasMiniaturas.value = [c.toDataURL('image/jpeg', 0.8)]
    }

    showMenu.value = false
    ventanaAbierta.value = true
    await sincronizarCanvasVistaPrevia()
  } catch (error) {
    console.error('Error abriendo herramienta:', error)
    cerrarVentanaHerramienta()
  } finally {
    procesando.value = false
  }
}

const cerrarVentanaHerramienta = () => {
  if (mediaUrlActiva.value) {
    URL.revokeObjectURL(mediaUrlActiva.value)
    mediaUrlActiva.value = ''
  }
  bytesMultimediaOriginal.value = null
  ventanaAbierta.value = false
  herramientaActual.value = null
  showMenu.value = false
  opcionActiva.value = null
  paginasCanvases.value = []
  paginasMiniaturas.value = []
  historialTrazos.value = []
  zoomNivel.value = 100
  modoPan.value = false
  window.api.cerrarMenu()
}

const obtenerCoordenadasCanvas = (e: MouseEvent) => {
  const c = canvasInteractivoRef.value
  if (!c) return { x: 0, y: 0 }
  const rect = c.getBoundingClientRect()
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  return {
    x: Math.max(0, Math.min(c.width, (e.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(c.height, (e.clientY - rect.top) * scaleY))
  }
}

const onCanvasMouseDown = (e: MouseEvent) => {
  const scrollBox = contenedorScrollRef.value
  if (modoPan.value || espacioPresionado.value || e.button === 1 || e.button === 2) {
    if (scrollBox) {
      arrastrandoPan.value = true
      panInicio.value = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: scrollBox.scrollLeft,
        scrollTop: scrollBox.scrollTop
      }
    }
    return
  }

  const pos = obtenerCoordenadasCanvas(e)
  const c = canvasInteractivoRef.value
  if (!c) return

  if (herramientaActual.value === 'dibujar') {
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    dibujando.value = true
    ultimoPuntoTrazo.value = pos

    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    ctx.lineTo(pos.x + 0.01, pos.y + 0.01)
    ctx.strokeStyle = colorPincel.value
    const factorPrecisionZoom = Math.max(0.45, 100 / zoomNivel.value)
    ctx.lineWidth = grosorPincel.value * (c.width / 800) * factorPrecisionZoom
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  } else if (herramientaActual.value === 'recortar') {
    arrastrandoRecorte.value = true
    recorteInicio.value = pos
    cajaRecorte.value = { x: pos.x, y: pos.y, w: 1, h: 1, activo: true }
  }
}

const onCanvasMouseMove = (e: MouseEvent) => {
  if (arrastrandoPan.value) {
    const scrollBox = contenedorScrollRef.value
    if (scrollBox) {
      scrollBox.scrollLeft = panInicio.value.scrollLeft - (e.clientX - panInicio.value.x)
      scrollBox.scrollTop = panInicio.value.scrollTop - (e.clientY - panInicio.value.y)
    }
    return
  }

  const c = canvasInteractivoRef.value
  if (!c) return
  const pos = obtenerCoordenadasCanvas(e)

  if (herramientaActual.value === 'dibujar' && dibujando.value) {
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx || !ultimoPuntoTrazo.value) return

    const midX = (ultimoPuntoTrazo.value.x + pos.x) / 2
    const midY = (ultimoPuntoTrazo.value.y + pos.y) / 2
    ctx.quadraticCurveTo(ultimoPuntoTrazo.value.x, ultimoPuntoTrazo.value.y, midX, midY)
    ctx.stroke()
    ultimoPuntoTrazo.value = pos
  } else if (herramientaActual.value === 'recortar' && arrastrandoRecorte.value) {
    const x = Math.min(recorteInicio.value.x, pos.x)
    const y = Math.min(recorteInicio.value.y, pos.y)
    const w = Math.max(20, Math.abs(pos.x - recorteInicio.value.x))
    const h = Math.max(20, Math.abs(pos.y - recorteInicio.value.y))
    cajaRecorte.value = { x, y, w, h, activo: true }
  }
}

const onCanvasMouseUp = () => {
  if (arrastrandoPan.value) {
    arrastrandoPan.value = false
    return
  }

  const c = canvasInteractivoRef.value
  if (!c) return

  if (herramientaActual.value === 'dibujar' && dibujando.value) {
    dibujando.value = false
    ultimoPuntoTrazo.value = null
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      historialTrazos.value = [
        ...historialTrazos.value,
        ctx.getImageData(0, 0, c.width, c.height)
      ]
      const pageCanvas = paginasCanvases.value[paginaIndice.value]
      const pageCtx = pageCanvas?.getContext('2d')
      if (pageCtx) {
        pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height)
        pageCtx.drawImage(c, 0, 0)
      }
    }
  } else if (herramientaActual.value === 'recortar') {
    arrastrandoRecorte.value = false
  }
}

const deshacerTrazo = () => {
  const c = canvasInteractivoRef.value
  if (!c || historialTrazos.value.length <= 1) return
  const nuevoHistorial = historialTrazos.value.slice(0, -1)
  historialTrazos.value = nuevoHistorial
  const anterior = nuevoHistorial[nuevoHistorial.length - 1]
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (ctx && anterior) {
    ctx.putImageData(anterior, 0, 0)
    const pageCanvas = paginasCanvases.value[paginaIndice.value]
    pageCanvas?.getContext('2d')?.putImageData(anterior, 0, 0)
  }
}

const limpiarLienzo = () => {
  const c = canvasInteractivoRef.value
  if (!c || historialTrazos.value.length === 0) return
  const inicial = historialTrazos.value[0]
  historialTrazos.value = [inicial]
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (ctx && inicial) {
    ctx.putImageData(inicial, 0, 0)
    const pageCanvas = paginasCanvases.value[paginaIndice.value]
    pageCanvas?.getContext('2d')?.putImageData(inicial, 0, 0)
  }
}

const alternarSeleccionPagina = (idx: number) => {
  const pos = paginasSeleccionadas.value.indexOf(idx)
  if (pos >= 0) {
    if (paginasSeleccionadas.value.length > 1) {
      paginasSeleccionadas.value.splice(pos, 1)
    }
  } else {
    paginasSeleccionadas.value.push(idx)
    paginasSeleccionadas.value.sort((a, b) => a - b)
  }
}

const estiloOverlayRecorte = computed(() => {
  const c = canvasInteractivoRef.value
  if (!c || !c.width || !c.height) return {}
  return {
    left: `${(cajaRecorte.value.x / c.width) * 100}%`,
    top: `${(cajaRecorte.value.y / c.height) * 100}%`,
    width: `${(cajaRecorte.value.w / c.width) * 100}%`,
    height: `${(cajaRecorte.value.h / c.height) * 100}%`
  }
})

const guardarResultadoHerramienta = async (formatoSalidaOpcional?: string) => {
  procesando.value = true
  try {
    const esPdfOrigen = extArchivoActivo.value === 'pdf'
    const formatoImgDestino = ['jpg', 'png', 'webp'].includes(extArchivoActivo.value)
      ? extArchivoActivo.value
      : 'png'

    // 1. HERRAMIENTAS MULTIMEDIA (VIDEO / AUDIO / CAPTURA / GIF)
    if (herramientaActual.value === 'capturar' && videoPlayerRef.value) {
      const v = videoPlayerRef.value
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth || 1280
      canvas.height = v.videoHeight || 720
      const ctx = canvas.getContext('2d', { alpha: false })!
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const fmt = (formatoSalidaOpcional || 'jpg') as 'jpg' | 'png'
      const bytes = await canvasToUint8ArrayDirecto(canvas, fmt, 0.95)
      await window.api.guardarPaginasImagen(
        [bytes],
        fmt,
        rutaArchivoActivo.value,
        `_frame_${Math.round(v.currentTime)}s`
      )
    } else if (herramientaActual.value === 'gif' && mediaUrlActiva.value) {
      const gifBytes = await convertirVideoAGif(
        mediaUrlActiva.value,
        inicioCorteSeg.value,
        finCorteSeg.value,
        fpsGif.value,
        anchoGif.value
      )
      await window.api.guardarMultimediaBytes(
        gifBytes,
        'gif',
        rutaArchivoActivo.value,
        '_clip'
      )
    } else if (herramientaActual.value === 'multimedia' && bytesMultimediaOriginal.value) {
      const destino = formatoSalidaOpcional || 'wav'
      const wavBytes = await extraerAudioAWavDirecto(
        bytesMultimediaOriginal.value,
        inicioCorteSeg.value,
        finCorteSeg.value,
        volumenMediaPct.value / 100,
        velocidadMedia.value
      )
      await window.api.guardarMultimediaBytes(
        wavBytes,
        destino,
        rutaArchivoActivo.value,
        '_recorte'
      )
    } else if (herramientaActual.value === 'dibujar') {
      if (esPdfOrigen || extArchivoActivo.value === 'docx' || extArchivoActivo.value === 'txt') {
        const bytesList: Uint8Array[] = []
        const dims: { width: number; height: number }[] = []
        for (const c of paginasCanvases.value) {
          bytesList.push(await canvasToUint8ArrayDirecto(c, 'png'))
          dims.push({ width: Math.round(c.width * 0.5), height: Math.round(c.height * 0.5) })
        }
        await window.api.guardarPaginasComoPdf(
          bytesList,
          rutaArchivoActivo.value,
          dims,
          '_firmado'
        )
      } else {
        const c = paginasCanvases.value[0]
        const bytes = await canvasToUint8ArrayDirecto(c, formatoImgDestino)
        await window.api.guardarPaginasImagen(
          [bytes],
          formatoImgDestino,
          rutaArchivoActivo.value,
          '_editado'
        )
      }
    } else if (herramientaActual.value === 'recortar') {
      const src = paginasCanvases.value[paginaIndice.value]
      const cropCanvas = document.createElement('canvas')
      const cw = Math.max(20, Math.round(cajaRecorte.value.w))
      const ch = Math.max(20, Math.round(cajaRecorte.value.h))
      cropCanvas.width = cw
      cropCanvas.height = ch
      const ctx = cropCanvas.getContext('2d', { alpha: false })!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, cw, ch)
      ctx.drawImage(
        src,
        Math.round(cajaRecorte.value.x),
        Math.round(cajaRecorte.value.y),
        cw,
        ch,
        0,
        0,
        cw,
        ch
      )

      if (esPdfOrigen) {
        const pngBytes = await canvasToUint8ArrayDirecto(cropCanvas, 'png')
        await window.api.guardarPaginasComoPdf(
          [pngBytes],
          rutaArchivoActivo.value,
          [{ width: Math.round(cw * 0.5), height: Math.round(ch * 0.5) }],
          '_recorte'
        )
      } else {
        const bytes = await canvasToUint8ArrayDirecto(cropCanvas, formatoImgDestino)
        await window.api.guardarPaginasImagen(
          [bytes],
          formatoImgDestino,
          rutaArchivoActivo.value,
          '_recorte'
        )
      }
    } else if (herramientaActual.value === 'rotar') {
      const rotadosBytes: Uint8Array[] = []
      const dims: { width: number; height: number }[] = []

      for (const src of paginasCanvases.value) {
        const rad = ((rotacionGrados.value % 360) * Math.PI) / 180
        const intercambiaLados = Math.abs(rotacionGrados.value % 180) === 90
        const outCanvas = document.createElement('canvas')
        outCanvas.width = intercambiaLados ? src.height : src.width
        outCanvas.height = intercambiaLados ? src.width : src.height

        const ctx = outCanvas.getContext('2d', { alpha: false })!
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)

        ctx.save()
        ctx.translate(outCanvas.width / 2, outCanvas.height / 2)
        ctx.rotate(rad)
        ctx.scale(voltearH.value ? -1 : 1, voltearV.value ? -1 : 1)
        ctx.drawImage(src, -src.width / 2, -src.height / 2)
        ctx.restore()

        const fmt = esPdfOrigen ? 'png' : formatoImgDestino
        rotadosBytes.push(await canvasToUint8ArrayDirecto(outCanvas, fmt))
        dims.push({
          width: Math.round(outCanvas.width * 0.5),
          height: Math.round(outCanvas.height * 0.5)
        })
      }

      if (esPdfOrigen) {
        await window.api.guardarPaginasComoPdf(
          rotadosBytes,
          rutaArchivoActivo.value,
          dims,
          '_rotado'
        )
      } else {
        await window.api.guardarPaginasImagen(
          rotadosBytes,
          formatoImgDestino,
          rutaArchivoActivo.value,
          '_rotado'
        )
      }
    } else if (herramientaActual.value === 'dividir') {
      if (modoDivisionPdf.value === 'unico') {
        const bytesList: Uint8Array[] = []
        const dims: { width: number; height: number }[] = []
        for (const idx of paginasSeleccionadas.value) {
          const c = paginasCanvases.value[idx]
          if (!c) continue
          bytesList.push(await canvasToUint8ArrayDirecto(c, 'png'))
          dims.push({ width: Math.round(c.width * 0.5), height: Math.round(c.height * 0.5) })
        }
        await window.api.guardarPaginasComoPdf(
          bytesList,
          rutaArchivoActivo.value,
          dims,
          '_extraido'
        )
      } else {
        for (const idx of paginasSeleccionadas.value) {
          const c = paginasCanvases.value[idx]
          if (!c) continue
          const bytes = await canvasToUint8ArrayDirecto(c, 'png')
          await window.api.guardarPaginasComoPdf(
            [bytes],
            rutaArchivoActivo.value,
            [{ width: Math.round(c.width * 0.5), height: Math.round(c.height * 0.5) }],
            `_pag${idx + 1}`
          )
        }
      }
    } else if (herramientaActual.value === 'ajustar') {
      const factor = escalaPorcentaje.value / 100
      const calidad = calidadPorcentaje.value / 100

      if (esPdfOrigen) {
        const bytesList: Uint8Array[] = []
        const dims: { width: number; height: number }[] = []

        for (const src of paginasCanvases.value) {
          const outCanvas = document.createElement('canvas')
          outCanvas.width = Math.max(16, Math.round(src.width * factor))
          outCanvas.height = Math.max(16, Math.round(src.height * factor))
          const ctx = outCanvas.getContext('2d', { alpha: false })!
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
          ctx.drawImage(src, 0, 0, outCanvas.width, outCanvas.height)

          bytesList.push(await canvasToUint8ArrayDirecto(outCanvas, 'jpg', calidad))
          dims.push({ width: Math.round(src.width * 0.5), height: Math.round(src.height * 0.5) })
        }

        await window.api.guardarPaginasComoPdf(
          bytesList,
          rutaArchivoActivo.value,
          dims,
          '_comprimido'
        )
      } else {
        const src = paginasCanvases.value[0]
        const outCanvas = document.createElement('canvas')
        outCanvas.width = Math.max(16, Math.round(src.width * factor))
        outCanvas.height = Math.max(16, Math.round(src.height * factor))
        const ctx = outCanvas.getContext('2d', { alpha: false })!
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
        ctx.drawImage(src, 0, 0, outCanvas.width, outCanvas.height)

        const fmt = formatoSalidaOpcional || formatoImgDestino
        const bytes = await canvasToUint8ArrayDirecto(outCanvas, fmt, calidad)
        await window.api.guardarPaginasImagen(
          [bytes],
          fmt,
          rutaArchivoActivo.value,
          `_${escalaPorcentaje.value}pct`
        )
      }
    } else if (herramientaActual.value === 'editar') {
      const lineas = textoEditable.value.split(/\r?\n/)
      const bloques: BloqueDocumento[] = lineas.map((l) => ({
        tipo: 'texto',
        texto: l,
        segmentos: [{ texto: l, fontSize: 11, bold: false }],
        fontSize: 11,
        bold: false,
        align: 'left',
        espacioDespues: 60
      }))

      const destino = (formatoSalidaOpcional || extArchivoActivo.value || 'docx') as
        | 'docx'
        | 'txt'
        | 'pdf'
      if (destino === 'pdf') {
        const paginasPng = await renderizarBloquesAPaginas(bloques, 'png')
        await window.api.guardarPaginasComoPdf(
          paginasPng,
          rutaArchivoActivo.value,
          undefined,
          '_editado'
        )
      } else {
        await window.api.guardarTextoDocumento(bloques, destino, rutaArchivoActivo.value)
      }
    }
  } catch (error) {
    console.error('Error guardando desde herramienta:', error)
  } finally {
    procesando.value = false
    cerrarVentanaHerramienta()
  }
}

const convertirArchivoIndividual = async (file: File, rutaReal: string, formatoDestino: string) => {
  const ext = rutaReal.split('.').pop()?.toLowerCase() || ''
  if (ext === formatoDestino || (ext === 'jpeg' && formatoDestino === 'jpg')) return

  const esVideo = ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext) || file.type.startsWith('video/')
  const esAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || file.type.startsWith('audio/')
  const esPdf = ext === 'pdf' || file.type === 'application/pdf'
  const esDocTexto = ext === 'docx' || ext === 'txt'

  // CONVERSIÓN DE VIDEO / AUDIO DESDE LA RUEDA
  if (esVideo || esAudio) {
    const bytes = await window.api.leerArchivoBinario(rutaReal)
    if (formatoDestino === 'wav' || formatoDestino === 'mp3' || formatoDestino === 'webm') {
      const wavBytes = await extraerAudioAWavDirecto(bytes, 0, undefined, 1.0, 1.0)
      await window.api.guardarMultimediaBytes(wavBytes, formatoDestino, rutaReal)
    } else if (formatoDestino === 'gif' && esVideo) {
      const blob = new Blob([bytes], { type: file.type || 'video/mp4' })
      const url = URL.createObjectURL(blob)
      try {
        const gifBytes = await convertirVideoAGif(url, 0, 5, 10, 360)
        await window.api.guardarMultimediaBytes(gifBytes, 'gif', rutaReal)
      } finally {
        URL.revokeObjectURL(url)
      }
    } else if ((formatoDestino === 'jpg' || formatoDestino === 'png') && esVideo) {
      const blob = new Blob([bytes], { type: file.type || 'video/mp4' })
      const url = URL.createObjectURL(blob)
      try {
        const imgBytes = await capturarFrameDeVideo(url, 0.5, formatoDestino)
        await window.api.guardarPaginasImagen([imgBytes], formatoDestino, rutaReal, '_frame')
      } finally {
        URL.revokeObjectURL(url)
      }
    } else if (formatoDestino === 'txt') {
      const infoBloques: BloqueDocumento[] = [
        { tipo: 'texto', texto: `Archivo Multimedia: ${file.name}`, bold: true, fontSize: 14 },
        { tipo: 'texto', texto: `Tamaño: ${(file.size / 1024 / 1024).toFixed(2)} MB`, fontSize: 11 },
        { tipo: 'texto', texto: `Formato original: ${ext.toUpperCase()}`, fontSize: 11 }
      ]
      await window.api.guardarTextoDocumento(infoBloques, 'txt', rutaReal)
    }
    return
  }

  if (esPdf && ['jpg', 'png', 'webp'].includes(formatoDestino)) {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      isOffscreenCanvasSupported: false
    } as any)

    const pdf = await loadingTask.promise
    const paginasBytes: Uint8Array[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const { canvas } = await renderizarPaginaACanvas(page, 1600)
      const bytes = await canvasToUint8ArrayDirecto(canvas, formatoDestino)
      paginasBytes.push(bytes)
    }

    await window.api.guardarPaginasImagen(paginasBytes, formatoDestino, rutaReal)
  } else if (esPdf && (formatoDestino === 'txt' || formatoDestino === 'docx')) {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      isOffscreenCanvasSupported: false
    } as any)

    const pdf = await loadingTask.promise
    const bloquesTotales: BloqueDocumento[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      if (i > 1) {
        bloquesTotales.push({ tipo: 'salto_pagina' })
      }

      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const bloquesPagina = await analizarPaginaCompleta(
        page,
        textContent,
        formatoDestino as 'txt' | 'docx'
      )
      bloquesTotales.push(...bloquesPagina)
    }

    await window.api.guardarTextoDocumento(
      bloquesTotales,
      formatoDestino as 'txt' | 'docx',
      rutaReal
    )
  } else if (esDocTexto) {
    const bloques = await window.api.leerDocumentoTexto(rutaReal)

    if (formatoDestino === 'txt' || formatoDestino === 'docx') {
      await window.api.guardarTextoDocumento(bloques, formatoDestino, rutaReal)
    } else if (formatoDestino === 'pdf') {
      const paginasPng = await renderizarBloquesAPaginas(bloques, 'png')
      await window.api.guardarPaginasComoPdf(paginasPng, rutaReal)
    } else if (formatoDestino === 'jpg' || formatoDestino === 'png') {
      const paginasImg = await renderizarBloquesAPaginas(
        bloques,
        formatoDestino as 'jpg' | 'png'
      )
      await window.api.guardarPaginasImagen(paginasImg, formatoDestino, rutaReal)
    }
  } else {
    await window.api.convertirImagenBackend(rutaReal, formatoDestino)
  }
}

const procesarArchivo = async (event: DragEvent, opcionId: string) => {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const listaArchivos = Array.from(files)
  const primerArchivo = listaArchivos[0]
  const primeraRuta = window.api.obtenerRuta(primerArchivo)
  if (!primeraRuta) return

  if (opcionId.startsWith('tool:')) {
    const toolName = opcionId.replace('tool:', '') as TipoHerramienta
    await abrirHerramientaConArchivo(primerArchivo, primeraRuta, toolName)
    return
  }

  procesando.value = true

  try {
    const rutasTodas = listaArchivos.map((f) => window.api.obtenerRuta(f)).filter(Boolean)

    if (opcionId === 'unir-pdf' && rutasTodas.length > 1) {
      await window.api.unirPdfsBackend(rutasTodas)
    } else if (
      opcionId === 'pdf' &&
      tipoDetectado.value === 'imagen' &&
      rutasTodas.length > 1
    ) {
      await window.api.convertirImagenesAPdfUnico(rutasTodas)
    } else {
      for (const f of listaArchivos) {
        const ruta = window.api.obtenerRuta(f)
        if (ruta) {
          await convertirArchivoIndividual(f, ruta, opcionId)
        }
      }
    }
  } catch (error: any) {
    const detalle =
      error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
    console.error(`[ERROR EN CONVERSIÓN]: ${detalle}`)
  } finally {
    procesando.value = false
    showMenu.value = false
    opcionActiva.value = null
    cantidadArchivosEnVuelo.value = 1
    window.api.cerrarMenu?.()
  }
}
</script>

<template>
  <div
    class="w-screen h-screen overflow-hidden bg-transparent select-none"
    @dragover="detectarTipoEnVuelo"
    @wheel="onWheelLocal"
  >
    <!-- =================================================================== -->
    <!-- 1. RUEDA RADIAL ORBIT                                               -->
    <!-- =================================================================== -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-50"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-75"
    >
      <div
        v-if="showMenu && !ventanaAbierta && !trayMenuAbierto"
        :style="{ left: `${posX}px`, top: `${posY}px` }"
        class="fixed -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] flex items-center justify-center pointer-events-auto"
      >
        <div
          class="absolute inset-[8px] rounded-full bg-orange-950/25 backdrop-blur-2xl border-[2px] border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.45)] pointer-events-none"
        ></div>

        <svg
          viewBox="0 0 320 320"
          class="relative z-10 w-full h-full overflow-visible transition-transform duration-200"
        >
          <defs>
            <linearGradient id="activeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f97316" stop-opacity="0.95" />
              <stop offset="100%" stop-color="#dc2626" stop-opacity="0.95" />
            </linearGradient>

            <linearGradient id="inactiveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#fde68a" stop-opacity="0.62" />
              <stop offset="100%" stop-color="#fed7aa" stop-opacity="0.48" />
            </linearGradient>
          </defs>

          <circle
            cx="160"
            cy="160"
            r="59"
            fill="rgba(0, 0, 0, 0.12)"
            stroke="rgba(255, 255, 255, 0.35)"
            stroke-width="1.5"
            class="pointer-events-none"
          />

          <g v-for="seg in segmentos" :key="seg.id + seg.angulo">
            <path
              :d="seg.path"
              :fill="opcionActiva === seg.id ? 'url(#activeGrad)' : 'url(#inactiveGrad)'"
              :stroke="
                opcionActiva === seg.id
                  ? 'rgba(255, 255, 255, 0.85)'
                  : 'rgba(255, 255, 255, 0.45)'
              "
              stroke-width="1.5"
              class="cursor-pointer transition-all duration-150 ease-out"
              :style="{
                transformOrigin: '160px 160px',
                transform: opcionActiva === seg.id ? 'scale(1.03)' : 'scale(1)',
                filter:
                  opcionActiva === seg.id
                    ? 'drop-shadow(0 0 16px rgba(234, 88, 12, 0.65))'
                    : 'none'
              }"
              @dragenter.prevent="opcionActiva = seg.id"
              @dragover.prevent="opcionActiva = seg.id"
              @dragleave="opcionActiva = null"
              @drop="procesarArchivo($event, seg.id)"
            />

            <text
              :x="seg.tx"
              :y="seg.ty"
              text-anchor="middle"
              dominant-baseline="central"
              class="pointer-events-none font-extrabold tracking-wider transition-colors duration-150"
              :class="seg.label.length > 5 ? 'text-[11px]' : 'text-[15px]'"
              :fill="opcionActiva === seg.id ? '#FFFFFF' : '#1c1917'"
            >
              {{ seg.label }}
            </text>
          </g>
        </svg>

        <div
          class="absolute z-20 pointer-events-none flex flex-col items-center justify-center"
        >
          <div
            v-if="procesando"
            class="w-9 h-9 border-[3px] border-white border-t-transparent rounded-full animate-spin"
          ></div>

          <template v-else>
            <div
              class="px-4 py-1.5 rounded-full bg-amber-200/55 border border-white/50 shadow-inner backdrop-blur-md flex items-center justify-center min-w-[76px]"
            >
              <span class="text-[#1c1917] font-extrabold text-[11px] tracking-wider uppercase">
                {{ etiquetaCentro }}
              </span>
            </div>

            <div class="flex items-center gap-1.5 mt-1.5">
              <span
                class="w-1.5 h-1.5 rounded-full transition-all duration-200"
                :class="
                  modoRueda === 'conversion'
                    ? 'bg-orange-500 scale-125 shadow-[0_0_6px_#f97316]'
                    : 'bg-white/40'
                "
              ></span>
              <span
                class="w-1.5 h-1.5 rounded-full transition-all duration-200"
                :class="
                  modoRueda === 'herramientas'
                    ? 'bg-orange-500 scale-125 shadow-[0_0_6px_#f97316]'
                    : 'bg-white/40'
                "
              ></span>
            </div>
          </template>
        </div>
      </div>
    </Transition>

    <!-- =================================================================== -->
    <!-- 2. NOTIFICACIÓN TOAST FLOTANTE DE ARCHIVO GUARDADO (OPCIÓN 2)       -->
    <!-- =================================================================== -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-6 scale-90"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-4 scale-90"
    >
      <div
        v-if="toastVisible && !ventanaAbierta"
        @mouseenter="configurarMouseToast(false)"
        @mouseleave="configurarMouseToast(true)"
        class="fixed bottom-6 right-6 z-50 w-[330px] rounded-2xl bg-orange-950/55 backdrop-blur-2xl border-[2px] border-white/45 shadow-[0_18px_45px_rgba(0,0,0,0.65)] p-3.5 flex items-center justify-between gap-3 pointer-events-auto"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="w-8 h-8 rounded-full bg-gradient-to-br from-[#f97316] to-[#dc2626] border border-white/75 flex items-center justify-center text-white font-extrabold text-xs shrink-0 shadow-md"
          >
            ✓
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-amber-200 text-[10px] font-extrabold uppercase tracking-wider">
              Guardado en {{ toastData.carpeta }}
            </span>
            <span class="text-white text-xs font-bold truncate">
              {{ toastData.nombre }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button
            @click="abrirArchivoDesdeToast"
            class="px-3 py-1.5 rounded-full bg-[#fde68a]/80 hover:bg-gradient-to-r hover:from-[#f97316] hover:to-[#dc2626] text-[#1c1917] hover:text-white font-extrabold text-[11px] border border-white/60 transition-all cursor-pointer"
          >
            Abrir ↗
          </button>
          <button
            @click="cerrarToast"
            class="w-6 h-6 rounded-full bg-black/25 hover:bg-red-600 text-white/80 hover:text-white text-[10px] font-extrabold flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>
    </Transition>

    <!-- =================================================================== -->
    <!-- 3. PANEL DE BANDEJA DEL SISTEMA CON AUTO-UPDATER (OPCIÓN 5)         -->
    <!-- =================================================================== -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-4 scale-90"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-4 scale-90"
    >
      <div
        v-if="trayMenuAbierto"
        class="fixed inset-0 z-50 pointer-events-auto"
        @mousedown.self="cerrarMenuTray"
        @contextmenu.prevent
      >
        <div
          :style="{ left: `${trayPosX}px`, top: `${trayPosY}px` }"
          class="fixed -translate-x-1/2 -translate-y-1/2 w-[340px] rounded-[30px] bg-orange-950/45 backdrop-blur-2xl border-[2px] border-white/45 shadow-[0_22px_60px_rgba(0,0,0,0.7)] p-4 flex flex-col gap-2.5"
        >
          <!-- Encabezado con Estado y Versión de Orbit -->
          <div class="flex items-center justify-between pb-2 border-b border-white/25">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 flex items-center justify-center">
                <svg viewBox="0 0 64 64" class="w-full h-full drop-shadow-md">
                  <defs>
                    <linearGradient id="trayHeaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" :stop-color="trayPausado ? '#78716c' : '#f97316'" />
                      <stop offset="100%" :stop-color="trayPausado ? '#44403c' : '#dc2626'" />
                    </linearGradient>
                  </defs>
                  <ellipse
                    cx="32"
                    cy="32"
                    rx="27"
                    ry="11"
                    transform="rotate(-30 32 32)"
                    fill="none"
                    stroke="url(#trayHeaderGrad)"
                    stroke-width="5.5"
                    stroke-linecap="round"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="11"
                    fill="url(#trayHeaderGrad)"
                    stroke="#1c1917"
                    stroke-width="2.5"
                  />
                  <circle cx="32" cy="32" r="5" :fill="trayPausado ? '#a8a29e' : '#fde68a'" />
                  <circle
                    cx="50"
                    cy="14"
                    r="5.5"
                    :fill="trayPausado ? '#a8a29e' : '#fde68a'"
                    :stroke="trayPausado ? '#44403c' : '#dc2626'"
                    stroke-width="2"
                  />
                </svg>
              </div>

              <div class="flex flex-col">
                <div class="flex items-center gap-1.5">
                  <span class="text-white font-extrabold text-sm tracking-wider uppercase leading-none">
                    ORBIT
                  </span>
                  <span class="px-1.5 py-0.5 rounded-full bg-white/15 text-amber-200 font-extrabold text-[9px]">
                    v{{ trayVersionApp }}
                  </span>
                </div>
                <span
                  class="text-[11px] font-bold mt-0.5"
                  :class="trayPausado ? 'text-amber-300' : 'text-emerald-300'"
                >
                  {{
                    trayPausado
                      ? trayMinutosTimer > 0
                        ? `En pausa (${trayMinutosTimer}m)`
                        : 'En pausa'
                      : 'Activo en segundo plano'
                  }}
                </span>
              </div>
            </div>

            <button
              @click="cerrarMenuTray"
              class="w-7 h-7 rounded-full bg-[#fde68a]/60 hover:bg-red-600 text-[#1c1917] hover:text-white border border-white/50 font-extrabold text-xs flex items-center justify-center transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          <!-- Botón Principal Pausar + Temporizadores -->
          <div class="flex flex-col gap-2 bg-black/20 rounded-2xl p-2.5 border border-white/20">
            <button
              @click="ejecutarAccionTray('toggle-gaming')"
              class="w-full py-2 px-4 rounded-xl font-extrabold text-xs tracking-wider uppercase border transition-all flex items-center justify-between cursor-pointer"
              :class="
                trayPausado
                  ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white shadow-[0_0_16px_rgba(234,88,12,0.6)]'
                  : 'bg-[#fde68a]/70 hover:bg-[#fde68a] text-[#1c1917] border-white/55'
              "
            >
              <span>{{ trayPausado ? '▶ Reanudar Orbit' : '⏸ Pausar' }}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-black/20 text-white">
                {{ trayPausado ? 'PAUSADO' : 'ACTIVO' }}
              </span>
            </button>

            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="t in [
                  { min: 30, label: '30 min' },
                  { min: 60, label: '1 hora' },
                  { min: 120, label: '2 horas' }
                ]"
                :key="t.min"
                @click="ejecutarAccionTray('timer', t.min)"
                class="py-1 rounded-full text-[11px] font-extrabold border transition-all cursor-pointer"
                :class="
                  trayPausado && trayMinutosTimer === t.min
                    ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white shadow-md'
                    : 'bg-[#fde68a]/55 hover:bg-[#fde68a]/85 text-[#1c1917] border-white/40'
                "
              >
                ⏱ {{ t.label }}
              </button>
            </div>
          </div>

          <!-- Acción Rápida: Pegar Captura del Portapapeles -->
          <button
            @click="abrirImagenDesdePortapapeles('recortar')"
            class="w-full py-1.5 px-3.5 rounded-xl bg-[#fde68a]/70 hover:bg-gradient-to-r hover:from-[#f97316] hover:to-[#dc2626] text-[#1c1917] hover:text-white font-extrabold text-xs border border-white/55 flex items-center justify-between transition-all cursor-pointer"
          >
            <span>📋 Editar captura del portapapeles</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-black/15">Ctrl+V</span>
          </button>

          <!-- Selector de Tecla de Activación -->
          <div class="flex flex-col gap-1">
            <span class="text-amber-100/90 text-[10px] font-extrabold uppercase tracking-wider px-1">
              Tecla para abrir la rueda
            </span>
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="tk in [
                  { id: 'shift', label: 'Mantener Shift' },
                  { id: 'doble-shift', label: 'Doble Shift ⚡' },
                  { id: 'alt', label: 'Mantener Alt' },
                  { id: 'ctrl', label: 'Mantener Ctrl' }
                ]"
                :key="tk.id"
                @click="ejecutarAccionTray('tecla', tk.id)"
                class="py-1.5 px-2.5 rounded-xl text-[11px] font-extrabold border transition-all cursor-pointer truncate"
                :class="
                  trayModoTecla === tk.id
                    ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white shadow-[0_0_12px_rgba(234,88,12,0.5)]'
                    : 'bg-[#fde68a]/60 hover:bg-[#fde68a]/90 text-[#1c1917] border-white/45'
                "
              >
                {{ tk.label }}
              </button>
            </div>
          </div>

          <!-- Historial de Archivos Recientes -->
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between px-1">
              <span class="text-amber-100/90 text-[10px] font-extrabold uppercase tracking-wider">
                Conversiones recientes
              </span>
              <button
                v-if="trayArchivosRecientes.length > 0"
                @click="ejecutarAccionTray('limpiar-recientes')"
                class="text-[10px] font-bold text-amber-200 hover:text-white underline cursor-pointer"
              >
                Limpiar
              </button>
            </div>

            <div
              v-if="trayArchivosRecientes.length === 0"
              class="py-2 px-3 rounded-xl bg-black/20 border border-white/15 text-center text-white/60 text-xs font-medium"
            >
              Aún no hay archivos recientes
            </div>

            <div v-else class="flex flex-col gap-1 max-h-[85px] overflow-y-auto pr-0.5">
              <button
                v-for="item in trayArchivosRecientes"
                :key="item.ruta"
                @click="ejecutarAccionTray('abrir-reciente', item.ruta)"
                class="w-full py-1.5 px-3 rounded-xl bg-[#fde68a]/60 hover:bg-gradient-to-r hover:from-[#f97316] hover:to-[#dc2626] text-[#1c1917] hover:text-white border border-white/45 flex items-center justify-between text-left transition-colors cursor-pointer group"
              >
                <span class="text-xs font-extrabold truncate max-w-[230px]">
                  {{ item.nombre }}
                </span>
                <span class="text-[10px] font-extrabold opacity-70 group-hover:opacity-100">
                  Abrir ↗
                </span>
              </button>
            </div>
          </div>

          <!-- Buscador de Actualizaciones (Opción 5) -->
          <div class="flex flex-col gap-1 bg-black/20 rounded-xl p-2 border border-white/15">
            <div class="flex items-center justify-between">
              <span class="text-white/85 text-[11px] font-bold">
                {{ infoUpdate ? infoUpdate.mensaje : 'Actualizaciones de Orbit' }}
              </span>
              <button
                @click="verificarActualizacionesApp"
                :disabled="buscandoUpdate"
                class="px-2.5 py-1 rounded-full bg-[#fde68a]/70 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-[10px] border border-white/50 cursor-pointer shrink-0"
              >
                {{ buscandoUpdate ? 'Buscando...' : '🔄 Buscar' }}
              </button>
            </div>
          </div>

          <!-- Pie del Panel: Auto-inicio con Windows y Salir -->
          <div class="flex items-center justify-between pt-1.5 border-t border-white/25">
            <button
              @click="ejecutarAccionTray('autostart', !trayIniciarConWindows)"
              class="px-3 py-1.5 rounded-full text-[11px] font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer"
              :class="
                trayIniciarConWindows
                  ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                  : 'bg-[#fde68a]/60 text-[#1c1917] border-white/45'
              "
            >
              <span>{{ trayIniciarConWindows ? '✓' : '○' }}</span>
              <span>Iniciar con Windows</span>
            </button>

            <button
              @click="ejecutarAccionTray('salir')"
              class="px-4 py-1.5 rounded-full bg-red-600/85 hover:bg-red-600 text-white font-extrabold text-[11px] tracking-wider uppercase border border-white/65 shadow-md cursor-pointer"
            >
              Salir
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- =================================================================== -->
    <!-- 4. VENTANA DE HERRAMIENTAS (DOCUMENTOS, IMÁGENES, VIDEO Y AUDIO)    -->
    <!-- =================================================================== -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-90"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-90"
    >
      <div
        v-if="ventanaAbierta"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-auto"
      >
        <div
          class="relative w-[850px] max-h-[90vh] rounded-[34px] bg-orange-950/35 backdrop-blur-2xl border-[2px] border-white/45 shadow-[0_25px_70px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden p-5"
        >
          <!-- Barra Superior con Selector Rápido de Herramientas -->
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-white/25">
            <div class="flex items-center gap-2.5">
              <div class="flex items-center gap-1 bg-black/25 p-1 rounded-full border border-white/25">
                <button
                  v-for="tab in herramientasDisponiblesArchivo"
                  :key="tab.id"
                  @click="cambiarHerramientaEnVentana(tab.id)"
                  class="px-3 py-1 rounded-full font-extrabold text-[11px] tracking-wider uppercase transition-all cursor-pointer"
                  :class="
                    herramientaActual === tab.id
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border border-white/80 shadow-[0_0_12px_rgba(234,88,12,0.5)]'
                      : 'text-amber-100/85 hover:text-white hover:bg-white/10'
                  "
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>

            <!-- Controles de Zoom de Precisión -->
            <div
              v-if="herramientaActual === 'dibujar' || herramientaActual === 'recortar'"
              class="flex items-center gap-1.5 bg-[#fde68a]/60 border border-white/55 rounded-full px-3 py-1 shadow-inner"
            >
              <button
                @click="cambiarZoom(-25)"
                class="w-6 h-6 rounded-full bg-black/15 hover:bg-black/30 text-[#1c1917] font-extrabold text-sm flex items-center justify-center cursor-pointer"
              >
                −
              </button>
              <button
                @click="restablecerZoom"
                class="px-2 text-[#1c1917] font-extrabold text-xs min-w-[48px] text-center cursor-pointer hover:underline"
              >
                {{ zoomNivel }}%
              </button>
              <button
                @click="cambiarZoom(25)"
                class="w-6 h-6 rounded-full bg-black/15 hover:bg-black/30 text-[#1c1917] font-extrabold text-sm flex items-center justify-center cursor-pointer"
              >
                +
              </button>

              <button
                v-if="zoomNivel > 100"
                @click="modoPan = !modoPan"
                class="ml-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border transition-all cursor-pointer"
                :class="
                  modoPan || espacioPresionado
                    ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                    : 'bg-white/50 text-[#1c1917] border-white/60'
                "
              >
                ✋ {{ modoPan ? 'Moviendo' : 'Mover' }}
              </button>
            </div>

            <!-- Selector de Páginas -->
            <div
              v-if="paginasCanvases.length > 1 && herramientaActual !== 'dividir' && herramientaActual !== 'editar'"
              class="flex items-center gap-2 bg-[#fde68a]/55 border border-white/50 rounded-full px-3 py-1"
            >
              <button
                @click="paginaIndice = Math.max(0, paginaIndice - 1)"
                class="text-[#1c1917] font-extrabold text-xs px-1.5 hover:text-orange-700 cursor-pointer"
              >
                ◀
              </button>
              <span class="text-[#1c1917] font-extrabold text-xs">
                Pág {{ paginaIndice + 1 }} / {{ paginasCanvases.length }}
              </span>
              <button
                @click="paginaIndice = Math.min(paginasCanvases.length - 1, paginaIndice + 1)"
                class="text-[#1c1917] font-extrabold text-xs px-1.5 hover:text-orange-700 cursor-pointer"
              >
                ▶
              </button>
            </div>

            <button
              @click="cerrarVentanaHerramienta"
              class="w-9 h-9 rounded-full bg-[#fde68a]/60 hover:bg-red-600 text-[#1c1917] hover:text-white border border-white/50 font-extrabold text-sm flex items-center justify-center transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          <!-- CONTENIDO SEGÚN LA HERRAMIENTA SELECCIONADA -->
          <div class="flex-1 overflow-hidden flex flex-col items-center justify-center min-h-[400px]">
            <!-- A. ESTUDIO MULTIMEDIA (VIDEO / AUDIO / CAPTURA / GIF) -->
            <div
              v-if="
                herramientaActual === 'multimedia' ||
                herramientaActual === 'capturar' ||
                herramientaActual === 'gif'
              "
              class="w-full flex flex-col items-center gap-4"
            >
              <!-- Reproductor de Video o Audio -->
              <div
                class="w-full flex flex-col items-center justify-center bg-black/30 rounded-2xl p-4 border border-white/25"
              >
                <video
                  v-if="esVideoActivo"
                  ref="videoPlayerRef"
                  :src="mediaUrlActiva"
                  controls
                  @loadedmetadata="onMediaMetadataLoaded"
                  class="max-h-[250px] rounded-xl shadow-lg bg-black"
                ></video>

                <div v-else class="w-full flex flex-col items-center gap-3 py-6">
                  <div
                    class="w-16 h-16 rounded-full bg-gradient-to-br from-[#f97316] to-[#dc2626] border-2 border-white/80 flex items-center justify-center text-2xl shadow-lg"
                  >
                    🎵
                  </div>
                  <audio
                    ref="audioPlayerRef"
                    :src="mediaUrlActiva"
                    controls
                    @loadedmetadata="onMediaMetadataLoaded"
                    class="w-[80%]"
                  ></audio>
                </div>
              </div>

              <!-- Controles de Recorte de Tiempo, Volumen, Velocidad o GIF -->
              <div
                class="w-full grid grid-cols-2 gap-3 bg-black/20 rounded-2xl p-3.5 border border-white/20"
              >
                <div class="flex flex-col gap-1.5">
                  <label class="text-amber-100 text-xs font-extrabold">
                    ⏱ Inicio del recorte: {{ inicioCorteSeg }}s
                  </label>
                  <input
                    type="range"
                    v-model.number="inicioCorteSeg"
                    :min="0"
                    :max="Math.max(0.5, finCorteSeg - 0.5)"
                    step="0.5"
                    class="accent-orange-500 cursor-pointer"
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-amber-100 text-xs font-extrabold">
                    🏁 Fin del recorte: {{ finCorteSeg }}s (Total: {{ duracionMedia }}s)
                  </label>
                  <input
                    type="range"
                    v-model.number="finCorteSeg"
                    :min="inicioCorteSeg + 0.5"
                    :max="Math.max(1, duracionMedia)"
                    step="0.5"
                    class="accent-orange-500 cursor-pointer"
                  />
                </div>

                <!-- Controles extra para Audio/Video -->
                <template v-if="herramientaActual === 'multimedia'">
                  <div class="flex items-center gap-2">
                    <span class="text-white text-xs font-extrabold">🔊 Volumen:</span>
                    <button
                      v-for="vol in [50, 100, 150, 200]"
                      :key="vol"
                      @click="volumenMediaPct = vol; aplicarVelocidadYVolumen()"
                      class="px-2.5 py-1 rounded-full text-[11px] font-extrabold border cursor-pointer"
                      :class="
                        volumenMediaPct === vol
                          ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                          : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                      "
                    >
                      {{ vol }}%
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <span class="text-white text-xs font-extrabold">⚡ Velocidad:</span>
                    <button
                      v-for="vel in [0.5, 1, 1.5, 2]"
                      :key="vel"
                      @click="velocidadMedia = vel; aplicarVelocidadYVolumen()"
                      class="px-2.5 py-1 rounded-full text-[11px] font-extrabold border cursor-pointer"
                      :class="
                        velocidadMedia === vel
                          ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                          : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                      "
                    >
                      {{ vel }}x
                    </button>
                  </div>
                </template>

                <!-- Controles extra para Creador de GIF -->
                <template v-if="herramientaActual === 'gif'">
                  <div class="flex items-center gap-2">
                    <span class="text-white text-xs font-extrabold">🎞️ Fluidez GIF:</span>
                    <button
                      v-for="f in [8, 12, 15]"
                      :key="f"
                      @click="fpsGif = f"
                      class="px-3 py-1 rounded-full text-[11px] font-extrabold border cursor-pointer"
                      :class="
                        fpsGif === f
                          ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                          : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                      "
                    >
                      {{ f }} FPS
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <span class="text-white text-xs font-extrabold">📐 Tamaño:</span>
                    <button
                      v-for="w in [280, 360, 480]"
                      :key="w"
                      @click="anchoGif = w"
                      class="px-3 py-1 rounded-full text-[11px] font-extrabold border cursor-pointer"
                      :class="
                        anchoGif === w
                          ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                          : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                      "
                    >
                      {{ w }}px
                    </button>
                  </div>
                </template>
              </div>
            </div>

            <!-- B. VISTA PARA RECORTAR / DIBUJAR / ROTAR / AJUSTAR -->
            <div
              v-else-if="
                herramientaActual === 'dibujar' ||
                herramientaActual === 'recortar' ||
                herramientaActual === 'rotar' ||
                herramientaActual === 'ajustar'
              "
              class="w-full flex flex-col items-center gap-3"
            >
              <!-- Controles de Dibujo -->
              <div
                v-if="herramientaActual === 'dibujar'"
                class="flex flex-wrap items-center justify-center gap-2.5 bg-black/20 border border-white/25 rounded-full px-5 py-1.5"
              >
                <button
                  v-for="col in [
                    { hex: '#111827', nombre: 'Negro' },
                    { hex: '#1d4ed8', nombre: 'Azul Firma' },
                    { hex: '#dc2626', nombre: 'Rojo' },
                    { hex: '#ea580c', nombre: 'Naranja' }
                  ]"
                  :key="col.hex"
                  @click="colorPincel = col.hex; modoPan = false"
                  class="w-6 h-6 rounded-full border-2 transition-transform cursor-pointer"
                  :style="{ backgroundColor: col.hex }"
                  :class="
                    colorPincel === col.hex ? 'scale-125 border-white shadow-md' : 'border-white/40'
                  "
                ></button>

                <div class="h-4 w-[1px] bg-white/30 mx-1"></div>

                <button
                  v-for="g in [
                    { val: 1.5, label: 'Pluma Fina' },
                    { val: 3.5, label: 'Medio' },
                    { val: 7, label: 'Marcador' }
                  ]"
                  :key="g.val"
                  @click="grosorPincel = g.val; modoPan = false"
                  class="px-3 py-1 rounded-full text-xs font-extrabold border transition-all cursor-pointer"
                  :class="
                    grosorPincel === g.val
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                      : 'bg-[#fde68a]/60 text-[#1c1917] border-white/40'
                  "
                >
                  {{ g.label }}
                </button>

                <div class="h-4 w-[1px] bg-white/30 mx-1"></div>

                <button
                  @click="deshacerTrazo"
                  class="px-3 py-1 rounded-full bg-[#fde68a]/60 hover:bg-[#fde68a] text-[#1c1917] text-xs font-extrabold border border-white/50 cursor-pointer"
                >
                  ↶ Deshacer
                </button>
                <button
                  @click="limpiarLienzo"
                  class="px-3 py-1 rounded-full bg-[#fde68a]/60 hover:bg-[#fde68a] text-[#1c1917] text-xs font-extrabold border border-white/50 cursor-pointer"
                >
                  Limpiar
                </button>
              </div>

              <!-- Controles de Rotación -->
              <div
                v-if="herramientaActual === 'rotar'"
                class="flex items-center gap-3 bg-black/20 border border-white/25 rounded-full px-5 py-2"
              >
                <button
                  @click="rotacionGrados = (rotacionGrados - 90) % 360"
                  class="px-4 py-1.5 rounded-full bg-[#fde68a]/65 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs border border-white/50 cursor-pointer"
                >
                  ↺ -90°
                </button>
                <button
                  @click="rotacionGrados = (rotacionGrados + 90) % 360"
                  class="px-4 py-1.5 rounded-full bg-[#fde68a]/65 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs border border-white/50 cursor-pointer"
                >
                  ↻ +90°
                </button>
                <button
                  @click="voltearH = !voltearH"
                  class="px-4 py-1.5 rounded-full font-extrabold text-xs border transition-colors cursor-pointer"
                  :class="
                    voltearH
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                      : 'bg-[#fde68a]/65 text-[#1c1917] border-white/50'
                  "
                >
                  ⇄ Voltear H
                </button>
                <button
                  @click="voltearV = !voltearV"
                  class="px-4 py-1.5 rounded-full font-extrabold text-xs border transition-colors cursor-pointer"
                  :class="
                    voltearV
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                      : 'bg-[#fde68a]/65 text-[#1c1917] border-white/50'
                  "
                >
                  ⇅ Voltear V
                </button>
              </div>

              <!-- Controles de Ajuste / Compresión -->
              <div
                v-if="herramientaActual === 'ajustar'"
                class="flex flex-wrap items-center justify-center gap-4 bg-black/20 border border-white/25 rounded-full px-6 py-2"
              >
                <div class="flex items-center gap-2">
                  <span class="text-white text-xs font-extrabold uppercase">Resolución:</span>
                  <button
                    v-for="pct in [50, 75, 100]"
                    :key="pct"
                    @click="escalaPorcentaje = pct"
                    class="px-3 py-1 rounded-full text-xs font-extrabold border cursor-pointer"
                    :class="
                      escalaPorcentaje === pct
                        ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                        : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                    "
                  >
                    {{ pct }}%
                  </button>
                </div>

                <div class="h-4 w-[1px] bg-white/30"></div>

                <div class="flex items-center gap-2">
                  <span class="text-white text-xs font-extrabold uppercase">Compresión:</span>
                  <button
                    v-for="cal in [
                      { v: 55, l: 'Máxima reducción' },
                      { v: 78, l: 'Equilibrada' },
                      { v: 92, l: 'Alta calidad' }
                    ]"
                    :key="cal.v"
                    @click="calidadPorcentaje = cal.v"
                    class="px-3 py-1 rounded-full text-xs font-extrabold border cursor-pointer"
                    :class="
                      calidadPorcentaje === cal.v
                        ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                        : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                    "
                  >
                    {{ cal.l }}
                  </button>
                </div>
              </div>

              <!-- Contenedor con Scroll y Zoom -->
              <div
                ref="contenedorScrollRef"
                @wheel="onWheelCanvasZoom"
                @contextmenu.prevent
                class="relative w-full h-[410px] overflow-auto bg-black/25 rounded-2xl p-4 border border-white/25 flex"
              >
                <div
                  class="m-auto relative inline-block transition-transform duration-150"
                  :style="{
                    transform: `rotate(${rotacionGrados}deg) scaleX(${voltearH ? -1 : 1}) scaleY(${voltearV ? -1 : 1})`
                  }"
                >
                  <canvas
                    ref="canvasInteractivoRef"
                    :style="estiloCanvasZoom"
                    class="rounded-lg shadow-xl bg-white block"
                    :class="{
                      'cursor-grab': modoPan || espacioPresionado,
                      'cursor-grabbing': arrastrandoPan,
                      'cursor-crosshair':
                        !modoPan &&
                        !espacioPresionado &&
                        (herramientaActual === 'dibujar' || herramientaActual === 'recortar')
                    }"
                    @mousedown="onCanvasMouseDown"
                    @mousemove="onCanvasMouseMove"
                    @mouseup="onCanvasMouseUp"
                    @mouseleave="onCanvasMouseUp"
                  ></canvas>

                  <div
                    v-if="herramientaActual === 'recortar' && cajaRecorte.activo"
                    :style="estiloOverlayRecorte"
                    class="absolute border-[2.5px] border-dashed border-orange-500 bg-orange-500/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none flex items-end justify-end p-1"
                  >
                    <span
                      class="px-2 py-0.5 rounded bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white font-extrabold text-[10px]"
                    >
                      {{ Math.round(cajaRecorte.w) }} × {{ Math.round(cajaRecorte.h) }} px
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- C. VISTA PARA DIVIDIR PDF -->
            <div
              v-else-if="herramientaActual === 'dividir'"
              class="w-full flex flex-col items-center gap-4"
            >
              <div
                class="flex items-center gap-3 bg-black/20 border border-white/25 rounded-full px-5 py-2"
              >
                <button
                  @click="modoDivisionPdf = 'unico'"
                  class="px-4 py-1.5 rounded-full text-xs font-extrabold border cursor-pointer"
                  :class="
                    modoDivisionPdf === 'unico'
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                      : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                  "
                >
                  Unir seleccionadas en 1 PDF
                </button>
                <button
                  @click="modoDivisionPdf = 'separados'"
                  class="px-4 py-1.5 rounded-full text-xs font-extrabold border cursor-pointer"
                  :class="
                    modoDivisionPdf === 'separados'
                      ? 'bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white border-white'
                      : 'bg-[#fde68a]/65 text-[#1c1917] border-white/40'
                  "
                >
                  Guardar cada página por separado
                </button>
              </div>

              <div
                class="grid grid-cols-4 gap-3.5 w-full max-h-[340px] overflow-y-auto p-3 bg-black/20 rounded-2xl border border-white/20"
              >
                <div
                  v-for="(thumb, idx) in paginasMiniaturas"
                  :key="idx"
                  @click="alternarSeleccionPagina(idx)"
                  class="relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all p-1.5 flex flex-col items-center"
                  :class="
                    paginasSeleccionadas.includes(idx)
                      ? 'border-orange-500 bg-gradient-to-b from-[#f97316]/40 to-[#dc2626]/40 scale-[1.02] shadow-lg'
                      : 'border-white/25 bg-white/10 opacity-60 hover:opacity-90'
                  "
                >
                  <img :src="thumb" class="w-full h-32 object-contain rounded bg-white mb-1.5" />
                  <span class="text-white font-extrabold text-xs">Página {{ idx + 1 }}</span>
                </div>
              </div>
            </div>

            <!-- D. VISTA PARA EDITAR DOCUMENTO -->
            <div
              v-else-if="herramientaActual === 'editar'"
              class="w-full flex flex-col gap-3"
            >
              <textarea
                v-model="textoEditable"
                rows="12"
                class="w-full rounded-2xl bg-[#fde68a]/75 text-[#1c1917] font-medium text-sm p-4 border-2 border-white/60 focus:outline-none focus:border-orange-500 shadow-inner resize-none select-text"
                placeholder="Escribe o edita el contenido del documento..."
              ></textarea>
              <div class="flex justify-between text-white/85 text-xs font-bold px-2">
                <span>Palabras: {{ textoEditable.trim() ? textoEditable.trim().split(/\s+/).length : 0 }}</span>
                <span>Caracteres: {{ textoEditable.length }}</span>
              </div>
            </div>
          </div>

          <!-- Barra Inferior -->
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-white/25">
            <div class="flex flex-col">
              <span class="text-white/90 text-xs font-bold truncate max-w-[320px]">
                📄 {{ nombreArchivoActivo }}
              </span>
              <span class="text-amber-200/80 text-[11px] font-medium">
                <template v-if="herramientaActual === 'dibujar' || herramientaActual === 'recortar'">
                  Tip: Usa <b>Ctrl + Rueda</b> para zoom y <b>Espacio + Arrastrar</b> para mover
                </template>
                <template v-else>
                  Carpeta destino: <b>{{ nombreCarpetaOrigen }}</b>
                </template>
              </span>
            </div>

            <div class="flex items-center gap-2.5">
              <button
                @click="cerrarVentanaHerramienta"
                class="px-5 py-2 rounded-full bg-[#fde68a]/65 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs tracking-wider uppercase border border-white/55 transition-transform hover:scale-105 cursor-pointer"
              >
                Cancelar
              </button>

              <template v-if="herramientaActual === 'editar'">
                <button
                  @click="guardarResultadoHerramienta('txt')"
                  class="px-4 py-2 rounded-full bg-[#fde68a]/80 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs tracking-wider uppercase border border-white/60 cursor-pointer"
                >
                  Guardar TXT
                </button>
                <button
                  @click="guardarResultadoHerramienta('pdf')"
                  class="px-4 py-2 rounded-full bg-[#fde68a]/80 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs tracking-wider uppercase border border-white/60 cursor-pointer"
                >
                  Guardar PDF
                </button>
                <button
                  @click="guardarResultadoHerramienta('docx')"
                  class="px-6 py-2 rounded-full bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white font-extrabold text-xs tracking-wider uppercase border border-white/80 shadow-[0_0_16px_rgba(234,88,12,0.65)] hover:scale-105 transition-transform cursor-pointer"
                >
                  Guardar DOCX en {{ nombreCarpetaOrigen }}
                </button>
              </template>

              <template v-else-if="herramientaActual === 'multimedia'">
                <button
                  @click="guardarResultadoHerramienta('mp3')"
                  class="px-5 py-2 rounded-full bg-[#fde68a]/80 hover:bg-[#fde68a] text-[#1c1917] font-extrabold text-xs tracking-wider uppercase border border-white/60 cursor-pointer"
                >
                  Exportar MP3
                </button>
                <button
                  @click="guardarResultadoHerramienta('wav')"
                  class="px-6 py-2 rounded-full bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white font-extrabold text-xs tracking-wider uppercase border border-white/85 shadow-[0_0_18px_rgba(234,88,12,0.7)] hover:scale-105 transition-transform cursor-pointer"
                >
                  Guardar WAV en {{ nombreCarpetaOrigen }}
                </button>
              </template>

              <button
                v-else
                @click="guardarResultadoHerramienta()"
                class="px-7 py-2 rounded-full bg-gradient-to-r from-[#f97316] to-[#dc2626] text-white font-extrabold text-xs tracking-wider uppercase border border-white/85 shadow-[0_0_18px_rgba(234,88,12,0.7)] hover:scale-105 transition-transform cursor-pointer"
              >
                Guardar en {{ nombreCarpetaOrigen }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>