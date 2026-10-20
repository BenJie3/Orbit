import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

let mainWindow: BrowserWindow | null = null
let shiftPresionado = false

// --- GENERADOR NATIVO DE WORD (.DOCX) SIN LIBRERÍAS EXTERNAS ---
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

function generarDocxDesdeParrafos(parrafos: string[]): Buffer {
  const escaparXml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const bodyXml = parrafos
    .map((p) => `<w:p><w:r><w:t>${escaparXml(p)}</w:t></w:r></w:p>`)
    .join('')

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`

  return crearZipBuffer([
    { nombre: '[Content_Types].xml', contenido: Buffer.from(contentTypes, 'utf8') },
    { nombre: '_rels/.rels', contenido: Buffer.from(rels, 'utf8') },
    { nombre: 'word/document.xml', contenido: Buffer.from(documentXml, 'utf8') }
  ])
}

function createWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.bounds

  const win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => {
    win.showInactive()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // NUEVO: Redirige todos los console.log y errores de Vue directo a tu terminal de VS Code
  win.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const niveles = ['DEBUG', 'INFO', 'WARN', 'ERROR']
    console.log(`[VUE-${niveles[level] || 'LOG'}] ${message} (Línea ${line})`)
  })
  return win
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.orbit.converter')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  mainWindow = createWindow()

  uIOhook.on('keydown', (e) => {
    if (
      (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) &&
      !shiftPresionado
    ) {
      shiftPresionado = true
      if (mainWindow && !mainWindow.isDestroyed()) {
        const cursor = screen.getCursorScreenPoint()
        const display = screen.getPrimaryDisplay()
        const { x: dispX, y: dispY, width, height } = display.bounds

        const margen = 170
        const posX = Math.max(margen, Math.min(width - margen, cursor.x - dispX))
        const posY = Math.max(margen, Math.min(height - margen, cursor.y - dispY))

        mainWindow.setIgnoreMouseEvents(false)
        mainWindow.webContents.send('toggle-menu', {
          mostrar: true,
          x: posX,
          y: posY
        })
      }
    }
  })

  uIOhook.on('keyup', (e) => {
    if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) {
      shiftPresionado = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true })
        mainWindow.webContents.send('toggle-menu', {
          mostrar: false,
          x: 0,
          y: 0
        })
      }
    }
  })

  uIOhook.start()

  ipcMain.on('forzar-cierre-menu', () => {
    shiftPresionado = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  // 1. GUARDADO INSTANTÁNEO DE PDF -> IMAGEN (Sin recodificar con Sharp)
  ipcMain.handle(
    'guardar-bytes-directo',
    async (_, bufferData: Uint8Array, formatoDestino: string, rutaOriginal: string) => {
      try {
        const parsedPath = path.parse(rutaOriginal)
        const newPath = path.join(parsedPath.dir, `${parsedPath.name}_orbit.${formatoDestino}`)

        await fs.promises.writeFile(newPath, Buffer.from(bufferData))

        // Abrimos la carpeta en segundo plano para NO bloquear ni retrasar el cierre del menú
        setTimeout(() => shell.showItemInFolder(newPath), 10)
        return true
      } catch (error) {
        console.error('Error al guardar bytes:', error)
        return false
      }
    }
  )

  // 2. GUARDADO DE PDF -> TXT o DOCX
  ipcMain.handle(
    'guardar-texto-documento',
    async (_, parrafos: string[], formatoDestino: 'txt' | 'docx', rutaOriginal: string) => {
      try {
        const parsedPath = path.parse(rutaOriginal)
        const newPath = path.join(parsedPath.dir, `${parsedPath.name}_orbit.${formatoDestino}`)

        if (formatoDestino === 'txt') {
          await fs.promises.writeFile(newPath, parrafos.join('\r\n\r\n'), 'utf8')
        } else {
          const docxBuffer = generarDocxDesdeParrafos(parrafos)
          await fs.promises.writeFile(newPath, docxBuffer)
        }

        setTimeout(() => shell.showItemInFolder(newPath), 10)
        return true
      } catch (error) {
        console.error('Error al guardar documento de texto:', error)
        return false
      }
    }
  )

  // 3. CONVERSIÓN ULTRARRÁPIDA DE IMÁGENES EN BACKEND
  ipcMain.handle(
    'convertir-imagen-backend',
    async (_, rutaOriginal: string, formatoDestino: string) => {
      try {
        const parsedPath = path.parse(rutaOriginal)
        const newPath = path.join(parsedPath.dir, `${parsedPath.name}_orbit.${formatoDestino}`)

        if (formatoDestino === 'pdf') {
          const pngBuffer = await sharp(rutaOriginal).rotate().png().toBuffer()
          const pdfDoc = await PDFDocument.create()
          const img = await pdfDoc.embedPng(pngBuffer)

          const page = pdfDoc.addPage([img.width, img.height])
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })

          const pdfBytes = await pdfDoc.save()
          await fs.promises.writeFile(newPath, pdfBytes)
        } else if (formatoDestino === 'jpg') {
          await sharp(rutaOriginal)
            .rotate()
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 92 })
            .toFile(newPath)
        } else if (formatoDestino === 'png') {
          await sharp(rutaOriginal).rotate().png().toFile(newPath)
        } else if (formatoDestino === 'webp') {
          await sharp(rutaOriginal).rotate().webp({ quality: 92 }).toFile(newPath)
        }

        setTimeout(() => shell.showItemInFolder(newPath), 10)
        return true
      } catch (error) {
        console.error('Error convirtiendo imagen:', error)
        return false
      }
    }
  )
})

app.on('window-all-closed', () => {
  uIOhook.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})