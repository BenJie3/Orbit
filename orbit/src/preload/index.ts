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

contextBridge.exposeInMainWorld('api', {
  onToggleMenu: (callback: (data: { mostrar: boolean; x: number; y: number }) => void) => {
    ipcRenderer.removeAllListeners('toggle-menu')
    ipcRenderer.on('toggle-menu', (_, data) => callback(data))
  },

  obtenerRuta: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || (file as any).path || ''
    } catch {
      return (file as any).path || ''
    }
  },

  // Guarda una o varias páginas de imagen directamente en la carpeta original
  guardarPaginasImagen: (
    paginasBytes: Uint8Array[],
    formatoDestino: string,
    rutaOriginal: string
  ) => ipcRenderer.invoke('guardar-paginas-imagen', paginasBytes, formatoDestino, rutaOriginal),

  // Guarda páginas renderizadas dentro de un archivo PDF nuevo
  guardarPaginasComoPdf: (paginasPngBytes: Uint8Array[], rutaOriginal: string) =>
    ipcRenderer.invoke('guardar-paginas-como-pdf', paginasPngBytes, rutaOriginal),

  // Guarda bloques estructurados en formato .TXT o .DOCX
  guardarTextoDocumento: (
    bloques: BloqueDocumento[],
    formatoDestino: 'txt' | 'docx',
    rutaOriginal: string
  ) => ipcRenderer.invoke('guardar-texto-documento', bloques, formatoDestino, rutaOriginal),

  // Lee archivos .DOCX o .TXT del disco y devuelve sus párrafos y formatos
  leerDocumentoTexto: (rutaOriginal: string) =>
    ipcRenderer.invoke('leer-documento-texto', rutaOriginal),

  // Convierte Imagen -> PDF / JPG / PNG / WEBP con Sharp
  convertirImagenBackend: (rutaOriginal: string, formatoDestino: string) =>
    ipcRenderer.invoke('convertir-imagen-backend', rutaOriginal, formatoDestino),

  cerrarMenu: () => ipcRenderer.send('forzar-cierre-menu')
})