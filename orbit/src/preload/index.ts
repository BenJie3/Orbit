import { contextBridge, ipcRenderer, webUtils } from 'electron'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
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

  // Guarda directamente los bytes de la imagen renderizada sin pasar por Sharp (Instantáneo)
  guardarBytesDirecto: (
    bufferData: Uint8Array,
    formatoDestino: string,
    rutaOriginal: string
  ) => ipcRenderer.invoke('guardar-bytes-directo', bufferData, formatoDestino, rutaOriginal),

  // Guarda texto extraído del PDF en formato .TXT o .DOCX (Word nativo)
  guardarTextoDocumento: (
    parrafos: string[],
    formatoDestino: 'txt' | 'docx',
    rutaOriginal: string
  ) => ipcRenderer.invoke('guardar-texto-documento', parrafos, formatoDestino, rutaOriginal),

  // Convierte Imagen -> PDF o Imagen -> Imagen en el Backend con Sharp
  convertirImagenBackend: (rutaOriginal: string, formatoDestino: string) =>
    ipcRenderer.invoke('convertir-imagen-backend', rutaOriginal, formatoDestino),

  cerrarMenu: () => ipcRenderer.send('forzar-cierre-menu')
})