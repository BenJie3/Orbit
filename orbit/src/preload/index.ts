import { contextBridge, ipcRenderer, webUtils } from 'electron'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

export interface SegmentoTexto {
  texto: string
  bold?: boolean
  fontSize?: number
}

export interface BloqueDocumento {
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

export interface EstadoTrayOrbit {
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

export interface ResultadoActualizacion {
  estado: 'actualizado' | 'disponible' | 'descargando' | 'error'
  versionNueva?: string
  mensaje: string
  urlDescarga?: string
}

contextBridge.exposeInMainWorld('api', {
  onToggleMenu: (callback: (data: { mostrar: boolean; x: number; y: number }) => void) => {
    ipcRenderer.removeAllListeners('toggle-menu')
    ipcRenderer.on('toggle-menu', (_, data) => callback(data))
  },

  onScrollMenu: (callback: (direccion: 'up' | 'down') => void) => {
    ipcRenderer.removeAllListeners('scroll-menu')
    ipcRenderer.on('scroll-menu', (_, direccion: 'up' | 'down') => callback(direccion))
  },

  onTrayMenu: (callback: (estado: EstadoTrayOrbit) => void) => {
    ipcRenderer.removeAllListeners('abrir-menu-tray')
    ipcRenderer.on('abrir-menu-tray', (_, estado: EstadoTrayOrbit) => callback(estado))
  },

  // Escucha cuando se guarda cualquier archivo para mostrar la Notificación Toast Flotante
  onArchivoGuardadoToast: (
    callback: (data: { nombre: string; ruta: string; carpeta: string }) => void
  ) => {
    ipcRenderer.removeAllListeners('archivo-guardado-toast')
    ipcRenderer.on('archivo-guardado-toast', (_, data) => callback(data))
  },

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
  }) => ipcRenderer.invoke('actualizar-config-tray', accion),

  buscarActualizaciones: () =>
    ipcRenderer.invoke('buscar-actualizaciones') as Promise<ResultadoActualizacion>,

  obtenerRuta: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || (file as any).path || ''
    } catch {
      return (file as any).path || ''
    }
  },

  guardarPaginasImagen: (
    paginasBytes: Uint8Array[],
    formatoDestino: string,
    rutaOriginal: string,
    sufijoPersonalizado?: string
  ) =>
    ipcRenderer.invoke(
      'guardar-paginas-imagen',
      paginasBytes,
      formatoDestino,
      rutaOriginal,
      sufijoPersonalizado
    ),

  guardarPaginasComoPdf: (
    paginasPngBytes: Uint8Array[],
    rutaOriginal: string,
    dimensiones?: { width: number; height: number }[],
    sufijoPersonalizado?: string
  ) =>
    ipcRenderer.invoke(
      'guardar-paginas-como-pdf',
      paginasPngBytes,
      rutaOriginal,
      dimensiones,
      sufijoPersonalizado
    ),

  guardarTextoDocumento: (
    bloques: BloqueDocumento[],
    formatoDestino: 'txt' | 'docx',
    rutaOriginal: string
  ) => ipcRenderer.invoke('guardar-texto-documento', bloques, formatoDestino, rutaOriginal),

  leerDocumentoTexto: (rutaOriginal: string) =>
    ipcRenderer.invoke('leer-documento-texto', rutaOriginal),

  convertirImagenBackend: (rutaOriginal: string, formatoDestino: string) =>
    ipcRenderer.invoke('convertir-imagen-backend', rutaOriginal, formatoDestino),

  unirPdfsBackend: (rutasPdfs: string[]) => ipcRenderer.invoke('unir-pdfs-backend', rutasPdfs),

  convertirImagenesAPdfUnico: (rutasImagenes: string[]) =>
    ipcRenderer.invoke('convertir-imagenes-a-pdf-unico', rutasImagenes),

  leerImagenPortapapeles: () => ipcRenderer.invoke('leer-imagen-portapapeles'),

  // Multimedia: Lee y guarda archivos de Audio/Video/GIF procesados
  leerArchivoBinario: (rutaOriginal: string) =>
    ipcRenderer.invoke('leer-archivo-binario', rutaOriginal) as Promise<Uint8Array>,

  guardarMultimediaBytes: (
    bytes: Uint8Array,
    extDestino: string,
    rutaOriginal: string,
    sufijoPersonalizado?: string
  ) =>
    ipcRenderer.invoke(
      'guardar-multimedia-bytes',
      bytes,
      extDestino,
      rutaOriginal,
      sufijoPersonalizado
    ),

  mostrarArchivoEnCarpeta: (rutaArchivo: string) =>
    ipcRenderer.invoke('mostrar-archivo-en-carpeta', rutaArchivo),

  setMouseIgnore: (ignorar: boolean) => ipcRenderer.send('set-mouse-ignore', ignorar),

  activarModoVentana: () => ipcRenderer.send('activar-modo-ventana'),

  cerrarMenu: () => ipcRenderer.send('forzar-cierre-menu')
})