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

  // Abre y sincroniza el nuevo menú personalizado de la bandeja del sistema
  onTrayMenu: (callback: (estado: EstadoTrayOrbit) => void) => {
    ipcRenderer.removeAllListeners('abrir-menu-tray')
    ipcRenderer.on('abrir-menu-tray', (_, estado: EstadoTrayOrbit) => callback(estado))
  },

  actualizarConfigTray: (accion: {
    tipo: 'toggle-gaming' | 'timer' | 'tecla' | 'autostart' | 'abrir-reciente' | 'limpiar-recientes' | 'salir'
    valor?: any
  }) => ipcRenderer.invoke('actualizar-config-tray', accion),

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

  activarModoVentana: () => ipcRenderer.send('activar-modo-ventana'),

  cerrarMenu: () => ipcRenderer.send('forzar-cierre-menu')
})