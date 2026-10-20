<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

// --- 1. PARCHES DE COMPATIBILIDAD PARA CHROMIUM / ELECTRON CON PDF.JS MODERNO ---
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

// --- 2. CONFIGURACIÓN DEL MOTOR PDF.JS EN HILO PRINCIPAL CON URL REAL DE VITE ---
;(window as any).Worker = undefined
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Evita que Chromium pause el renderizado por estar en una ventana sin foco
window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  return window.setTimeout(() => cb(performance.now()), 0)
}

declare global {
  interface Window {
    api: {
      onToggleMenu: (callback: (data: { mostrar: boolean; x: number; y: number }) => void) => void
      obtenerRuta: (file: File) => string
      guardarBytesDirecto: (
        bufferData: Uint8Array,
        formatoDestino: string,
        rutaOriginal: string
      ) => Promise<boolean>
      guardarTextoDocumento: (
        parrafos: string[],
        formatoDestino: 'txt' | 'docx',
        rutaOriginal: string
      ) => Promise<boolean>
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
const tipoDetectado = ref<'pdf' | 'imagen'>('pdf')

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
  imagen: [
    { id: 'pdf', label: 'PDF', angulo: -90, tx: 160, ty: 55 },
    { id: 'jpg', label: 'JPG', angulo: 0, tx: 265, ty: 160 },
    { id: 'png', label: 'PNG', angulo: 90, tx: 160, ty: 265 },
    { id: 'webp', label: 'WEBP', angulo: 180, tx: 55, ty: 160 }
  ]
}

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
  } else {
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

const conTimeout = <T>(promesa: Promise<T>, nombrePaso: string, ms = 10000): Promise<T> => {
  return Promise.race([
    promesa,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: Se quedó colgado en -> ${nombrePaso}`)), ms)
    )
  ])
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

    // 1. PDF -> IMAGEN (JPG / PNG / WEBP)
    if (esPdf && ['jpg', 'png', 'webp'].includes(formatoDestino)) {
      console.log(`[PASO 1] Abriendo PDF para convertir a ${formatoDestino.toUpperCase()}...`)
      const arrayBuffer = await conTimeout(file.arrayBuffer(), 'file.arrayBuffer()')
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true,
        isOffscreenCanvasSupported: false
      } as any)

      const pdf = await conTimeout(loadingTask.promise, 'pdfjsLib.getDocument().promise')
      console.log(`[PASO 2] PDF cargado (${pdf.numPages} págs). Renderizando página 1...`)
      const page = await conTimeout(pdf.getPage(1), 'pdf.getPage(1)')

      const baseVp = page.getViewport({ scale: 1.0 })
      const ladoMayor = Math.max(baseVp.width, baseVp.height)
      const escalaOptima = Math.min(2.0, Math.max(1.0, 1600 / ladoMayor))
      const viewport = page.getViewport({ scale: escalaOptima })

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Error en canvas 2D')

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, canvas.width, canvas.height)

      const renderTask = page.render({ canvasContext: context, viewport } as any)
      await conTimeout(renderTask.promise, 'page.render().promise')

      console.log('[PASO 3] Guardando imagen en disco...')
      const bytes = await conTimeout(
        canvasToUint8ArrayDirecto(canvas, formatoDestino),
        'canvasToBlob'
      )
      await conTimeout(
        window.api.guardarBytesDirecto(bytes, formatoDestino, rutaReal),
        'guardarBytesDirecto'
      )
      console.log('[PASO 4] ¡Conversión de PDF a Imagen completada!')
    }

    // 2. PDF -> DOCX o TXT
    else if (esPdf && (formatoDestino === 'txt' || formatoDestino === 'docx')) {
      console.log(`[PASO 1] Abriendo PDF para extraer texto a ${formatoDestino.toUpperCase()}...`)
      const arrayBuffer = await conTimeout(file.arrayBuffer(), 'file.arrayBuffer()')
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        isEvalSupported: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false
      } as any)

      const pdf = await conTimeout(loadingTask.promise, 'pdfjsLib.getDocument().promise')
      console.log(`[PASO 2] Extrayendo texto de ${pdf.numPages} páginas...`)
      const parrafos: string[] = []

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await conTimeout(pdf.getPage(i), `pdf.getPage(${i})`)
        const textContent = await conTimeout(page.getTextContent(), `page.getTextContent(${i})`)
        const textoPagina = textContent.items
          .map((item: any) => item.str || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()

        if (textoPagina) parrafos.push(textoPagina)
      }

      if (parrafos.length === 0) {
        parrafos.push('[Documento PDF basado en imagen sin texto seleccionable]')
      }

      console.log('[PASO 3] Guardando documento...')
      await conTimeout(
        window.api.guardarTextoDocumento(
          parrafos,
          formatoDestino as 'txt' | 'docx',
          rutaReal
        ),
        'guardarTextoDocumento'
      )
      console.log('[PASO 4] ¡Documento guardado con éxito!')
    }

    // 3. IMAGEN -> PDF / JPG / PNG / WEBP
    else if (!esPdf) {
      await conTimeout(
        window.api.convertirImagenBackend(rutaReal, formatoDestino),
        'convertirImagenBackend'
      )
    }
  } catch (error: any) {
    const detalle =
      error instanceof Error
        ? `${error.name}: ${error.message} | Stack: ${error.stack}`
        : JSON.stringify(error, Object.getOwnPropertyNames(error || {}))
    console.error(`[ERROR DETALLADO EN CONVERSIÓN]: ${detalle}`)
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
              {{ opcionActiva ? opcionActiva : tipoDetectado === 'pdf' ? 'PDF' : 'IMG' }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>