import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

let mainWindow: BrowserWindow | null = null
let shiftPresionado = false
let shellNotifierProc: ChildProcessWithoutNullStreams | null = null

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

// --- NOTIFICADOR NATIVO DE WINDOWS EXPLORER (SHChangeNotify en shell32.dll) ---
function iniciarNotificadorEscritorio() {
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

function guardarYRefrescarEscritorio(rutaArchivo: string, datos: Buffer | string) {
  if (typeof datos === 'string') {
    fs.writeFileSync(rutaArchivo, datos, 'utf8')
  } else {
    const fd = fs.openSync(rutaArchivo, 'w')
    fs.writeFileSync(fd, datos)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
  }

  // Dispara el refresco instantáneo del Escritorio en Windows
  if (shellNotifierProc && shellNotifierProc.stdin.writable) {
    shellNotifierProc.stdin.write(`${rutaArchivo}\n`)
  }
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

// --- EXTRACTOR BINARIO Y XML DE ARCHIVOS ZIP (.DOCX) ---
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

// --- PARSER COMPLETO DE .DOCX (Lee Imágenes incrustadas, Tablas y Texto con formato) ---
async function parsearDocxABloques(rutaDocx: string): Promise<BloqueDocumento[]> {
  const zipBuf = await fs.promises.readFile(rutaDocx)
  const docBuf = extraerBufferDeZip(zipBuf, 'word/document.xml')
  if (!docBuf) return [{ tipo: 'texto', texto: '[No se pudo abrir el archivo DOCX]' }]

  const xml = docBuf.toString('utf8')

  // 1. Mapa de relaciones para localizar imágenes (rId -> word/media/imageX.png)
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

  // Recorremos en orden exacto tanto Tablas (<w:tbl>) como Párrafos (<w:p>)
  const elementosRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g
  const elementos = contenidoBody.match(elementosRegex) || []

  for (const elXml of elementos) {
    // CASO A: TABLA (<w:tbl>)
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

    // CASO B: PÁRRAFO (<w:p>)
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

    // Buscar si el párrafo tiene imágenes incrustadas (<a:blip r:embed="rId..."/>)
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

        // Respetar proporción definida en Word si existe <wp:extent cx="..." cy="..."/>
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
      } catch (e) {
        console.error('Error procesando imagen interna de DOCX:', e)
      }
    }

    // Extraer texto del párrafo
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

// --- EMPAQUETADOR ZIP NATIVO PARA CREAR .DOCX ---
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
  iniciarNotificadorEscritorio()

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

  // 1. GUARDAR PÁGINAS DE IMAGEN Y REFRESCAR ESCRITORIO AL INSTANTE
  ipcMain.handle(
    'guardar-paginas-imagen',
    async (_, paginasBytes: Uint8Array[], formatoDestino: string, rutaOriginal: string) => {
      try {
        if (paginasBytes.length === 1) {
          const outPath = obtenerRutaSalida(rutaOriginal, formatoDestino)
          guardarYRefrescarEscritorio(outPath, Buffer.from(paginasBytes[0]))
        } else {
          for (let i = 0; i < paginasBytes.length; i++) {
            const outPath = obtenerRutaSalida(rutaOriginal, formatoDestino, `_pag${i + 1}`)
            guardarYRefrescarEscritorio(outPath, Buffer.from(paginasBytes[i]))
          }
        }
        return true
      } catch (error) {
        console.error('Error al guardar páginas de imagen:', error)
        return false
      }
    }
  )

  // 2. GUARDAR PÁGINAS RENDERIZADAS COMO UN DOCUMENTO .PDF
  ipcMain.handle(
    'guardar-paginas-como-pdf',
    async (_, paginasPngBytes: Uint8Array[], rutaOriginal: string) => {
      try {
        const pdfDoc = await PDFDocument.create()
        for (const pngBytes of paginasPngBytes) {
          const img = await pdfDoc.embedPng(pngBytes)
          const page = pdfDoc.addPage([612, 792])
          page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
        }
        const pdfBytes = await pdfDoc.save()
        const outPath = obtenerRutaSalida(rutaOriginal, 'pdf')
        guardarYRefrescarEscritorio(outPath, Buffer.from(pdfBytes))
        return true
      } catch (error) {
        console.error('Error creando PDF desde documento:', error)
        return false
      }
    }
  )

  // 3. GUARDAR DOCUMENTO .DOCX O .TXT
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
              : '[Este documento contiene únicamente imágenes sin texto seleccionable]'
          guardarYRefrescarEscritorio(outPath, contenidoFinal)
        } else {
          const docxBuffer = generarDocxEstructurado(bloques)
          guardarYRefrescarEscritorio(outPath, docxBuffer)
        }
        return true
      } catch (error) {
        console.error('Error al guardar documento:', error)
        return false
      }
    }
  )

  // 4. LEER ARCHIVOS .DOCX (CON IMÁGENES Y TABLAS) O .TXT DESDE EL DISCO
  ipcMain.handle('leer-documento-texto', async (_, rutaOriginal: string) => {
    try {
      const ext = path.extname(rutaOriginal).toLowerCase()
      if (ext === '.docx') {
        return await parsearDocxABloques(rutaOriginal)
      } else {
        const contenido = await fs.promises.readFile(rutaOriginal, 'utf8')
        const lineas = contenido.split(/\r?\n/)
        const bloques: BloqueDocumento[] = lineas.map((linea) => ({
          tipo: 'texto',
          texto: linea,
          segmentos: [{ texto: linea, fontSize: 11, bold: false }],
          fontSize: 11,
          bold: false,
          align: 'left',
          espacioDespues: 60
        }))
        return bloques
      }
    } catch (error) {
      console.error('Error leyendo documento:', error)
      return []
    }
  })

  // 5. CONVERSIÓN ULTRARRÁPIDA DE IMÁGENES EN BACKEND
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
          guardarYRefrescarEscritorio(outPath, Buffer.from(pdfBytes))
        } else if (formatoDestino === 'jpg') {
          const outBuf = await sharp(rutaOriginal)
            .rotate()
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 92 })
            .toBuffer()
          guardarYRefrescarEscritorio(outPath, outBuf)
        } else if (formatoDestino === 'png') {
          const outBuf = await sharp(rutaOriginal).rotate().png().toBuffer()
          guardarYRefrescarEscritorio(outPath, outBuf)
        } else if (formatoDestino === 'webp') {
          const outBuf = await sharp(rutaOriginal).rotate().webp({ quality: 92 }).toBuffer()
          guardarYRefrescarEscritorio(outPath, outBuf)
        }

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
  if (shellNotifierProc) {
    shellNotifierProc.kill()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})