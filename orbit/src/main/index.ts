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

    // 1. BLOQUE DE IMAGEN / FRANJA GRÁFICA (Logos, Firma, Pleca)
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
      const maxWidthEmu = 6050000 // ~16.8 cm (ancho útil de la hoja)
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

    // 2. BLOQUE DE TABLA CON BORDES REALES (<w:tbl>)
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

    // 3. BLOQUE DE TEXTO (Soporta negritas parciales por palabra/segmento y alineación derecha)
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

  win.webContents.on('console-message', (_, level, message, line) => {
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

  ipcMain.handle(
    'guardar-bytes-directo',
    async (_, bufferData: Uint8Array, formatoDestino: string, rutaOriginal: string) => {
      try {
        const parsedPath = path.parse(rutaOriginal)
        const newPath = path.join(parsedPath.dir, `${parsedPath.name}_orbit.${formatoDestino}`)

        await fs.promises.writeFile(newPath, Buffer.from(bufferData))
        setTimeout(() => shell.showItemInFolder(newPath), 10)
        return true
      } catch (error) {
        console.error('Error al guardar bytes:', error)
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
        const parsedPath = path.parse(rutaOriginal)
        const newPath = path.join(parsedPath.dir, `${parsedPath.name}_orbit.${formatoDestino}`)

        if (formatoDestino === 'txt') {
          const lineasTxt: string[] = []
          for (const b of bloques) {
            if (b.tipo === 'salto_pagina') {
              lineasTxt.push('\r\n----------------------------------------\r\n')
            } else if (b.tipo === 'texto' && b.texto) {
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
              : '[Este PDF contiene únicamente imágenes sin texto seleccionable]'
          await fs.promises.writeFile(newPath, contenidoFinal, 'utf8')
        } else {
          const docxBuffer = generarDocxEstructurado(bloques)
          await fs.promises.writeFile(newPath, docxBuffer)
        }

        setTimeout(() => shell.showItemInFolder(newPath), 10)
        return true
      } catch (error) {
        console.error('Error al guardar documento:', error)
        return false
      }
    }
  )

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