<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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

declare global {
  interface Window {
    api: {
      onToggleMenu: (callback: (data: { mostrar: boolean; x: number; y: number }) => void) => void
      obtenerRuta: (file: File) => string
      guardarPaginasImagen: (
        paginasBytes: Uint8Array[],
        formatoDestino: string,
        rutaOriginal: string
      ) => Promise<boolean>
      guardarPaginasComoPdf: (
        paginasPngBytes: Uint8Array[],
        rutaOriginal: string
      ) => Promise<boolean>
      guardarTextoDocumento: (
        bloques: BloqueDocumento[],
        formatoDestino: 'txt' | 'docx',
        rutaOriginal: string
      ) => Promise<boolean>
      leerDocumentoTexto: (rutaOriginal: string) => Promise<BloqueDocumento[]>
      convertirImagenBackend: (rutaOriginal: string, formatoDestino: string) => Promise<boolean>
      cerrarMenu: () => void
    }
  }
}

const showMenu = ref(false)
const procesando = ref(false)
const posX = ref(500)
const posY = ref(400)
const opcionActiva = ref<string | null>(null)
const tipoDetectado = ref<'pdf' | 'docx' | 'txt' | 'imagen'>('pdf')

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

const catalogoOpciones = {
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
  ]
}

const etiquetaCentro = computed(() => {
  if (opcionActiva.value) return opcionActiva.value.toUpperCase()
  if (tipoDetectado.value === 'imagen') return 'IMG'
  return tipoDetectado.value.toUpperCase()
})

const segmentos = computed(() => {
  const opciones = catalogoOpciones[tipoDetectado.value] || catalogoOpciones.pdf
  return opciones.map((op) => ({
    ...op,
    path: crearPathSegmento(op.angulo)
  }))
})

onMounted(() => {
  window.api.onToggleMenu((data) => {
    if (data.mostrar) {
      posX.value = data.x
      posY.value = data.y
      showMenu.value = true
    } else if (!procesando.value) {
      showMenu.value = false
      opcionActiva.value = null
    }
  })
})

const detectarTipoEnVuelo = (event: DragEvent) => {
  event.preventDefault()
  const items = event.dataTransfer?.items
  if (!items || items.length === 0) return

  const mime = (items[0].type || '').toLowerCase()
  if (mime.startsWith('image/')) {
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
  formato: string
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
      0.92
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

// Carga la imagen usando Data URI (base64) permitido por la política CSP de Electron
const cargarImagenDesdeBytes = (bytes: Uint8Array): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as any)
    const base64 = uint8ToBase64(u8)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (err) => reject(err)
    img.src = `data:image/png;base64,${base64}`
  })
}

const renderizarPaginaACanvas = async (
  page: any,
  maxLado = 1400
): Promise<{ canvas: HTMLCanvasElement; scale: number; pageWidth: number; pageHeight: number }> => {
  const baseVp = page.getViewport({ scale: 1.0 })
  const ladoMayor = Math.max(baseVp.width, baseVp.height)
  const scale = Math.min(2.0, Math.max(1.2, maxLado / ladoMayor))
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

const renderizarBloquesAPaginas = async (
  bloques: BloqueDocumento[],
  formatoImagen: 'png' | 'jpg'
): Promise<Uint8Array[]> => {
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

    // 1. DIBUJAR IMÁGENES INCRUSTADAS EN EL DOCX
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

    // 2. DIBUJAR TABLAS CON BORDES (<w:tbl>)
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

    // 3. DIBUJAR PÁRRAFOS DE TEXTO CON SOPORTE DE NEGRITAS MIXTAS Y SANGRÍA
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

const procesarArchivo = async (event: DragEvent, formatoDestino: string) => {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const file = files[0]
  const rutaReal = window.api.obtenerRuta(file)
  if (!rutaReal) return

  const ext = rutaReal.split('.').pop()?.toLowerCase() || ''
  if (ext === formatoDestino || (ext === 'jpeg' && formatoDestino === 'jpg')) {
    showMenu.value = false
    opcionActiva.value = null
    window.api.cerrarMenu?.()
    return
  }

  procesando.value = true

  try {
    const esPdf = ext === 'pdf' || file.type === 'application/pdf'
    const esDocTexto = ext === 'docx' || ext === 'txt'

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
  } catch (error: any) {
    const detalle =
      error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
    console.error(`[ERROR EN CONVERSIÓN]: ${detalle}`)
  } finally {
    procesando.value = false
    showMenu.value = false
    opcionActiva.value = null
    window.api.cerrarMenu?.()
  }
}
</script>

<template>
  <div
    class="w-screen h-screen overflow-hidden bg-transparent select-none"
    @dragover="detectarTipoEnVuelo"
  >
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-50"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-75"
    >
      <div
        v-if="showMenu"
        :style="{ left: `${posX}px`, top: `${posY}px` }"
        class="fixed -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] flex items-center justify-center pointer-events-auto"
      >
        <div
          class="absolute inset-[8px] rounded-full bg-orange-950/25 backdrop-blur-2xl border-[2px] border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.45)] pointer-events-none"
        ></div>

        <svg
          viewBox="0 0 320 320"
          class="relative z-10 w-full h-full overflow-visible"
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

          <g v-for="seg in segmentos" :key="seg.id">
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
              class="pointer-events-none font-extrabold text-[15px] tracking-wider transition-colors duration-150"
              :fill="opcionActiva === seg.id ? '#FFFFFF' : '#1c1917'"
            >
              {{ seg.label }}
            </text>
          </g>
        </svg>

        <div
          class="absolute z-20 pointer-events-none flex items-center justify-center"
        >
          <div
            v-if="procesando"
            class="w-9 h-9 border-[3px] border-white border-t-transparent rounded-full animate-spin"
          ></div>

          <div
            v-else
            class="px-5 py-2 rounded-full bg-amber-200/55 border border-white/50 shadow-inner backdrop-blur-md flex items-center justify-center min-w-[74px]"
          >
            <span class="text-[#1c1917] font-extrabold text-xs tracking-wider uppercase">
              {{ etiquetaCentro }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>