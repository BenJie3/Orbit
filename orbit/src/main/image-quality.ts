import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export type FormatoImagenCalidad = 'png' | 'webp' | 'jpg'
export type OperacionImagenCalidad =
  | { tipo: 'recortar'; region: { x: number; y: number; w: number; h: number } }
  | { tipo: 'rotar'; grados: number; voltearH: boolean; voltearV: boolean }

export interface SolicitudImagenCalidad {
  rutaOriginal: string
  rutaSalida: string
  operacion: OperacionImagenCalidad
  // JPEG de salida solo a petición del usuario: siempre implica recodificación.
  conservarJpg?: boolean
}

export function formatoImagenCalidad(extension: string, conservarJpg = false): FormatoImagenCalidad {
  const ext = extension.toLowerCase().replace(/^\./, '')
  if (ext === 'png') return 'png'
  if (ext === 'webp') return 'webp'
  if (ext === 'jpg' || ext === 'jpeg') return conservarJpg ? 'jpg' : 'png'
  throw new Error('Orbit conserva la calidad de PNG, WebP y JPG/JPEG en esta herramienta.')
}

export function normalizarRecorte(
  region: { x: number; y: number; w: number; h: number }, width: number, height: number
): { left: number; top: number; width: number; height: number } {
  if (![region.x, region.y, region.w, region.h, width, height].every(Number.isFinite) ||
      width < 1 || height < 1) throw new Error('La región de recorte no es válida.')
  // La selección del renderer está expresada en píxeles de la imagen mostrada,
  // después de aplicar su orientación EXIF.
  const left = Math.max(0, Math.min(width - 1, Math.round(region.x)))
  const top = Math.max(0, Math.min(height - 1, Math.round(region.y)))
  const right = Math.max(left + 1, Math.min(width, Math.round(region.x + region.w)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round(region.y + region.h)))
  if (region.w <= 0 || region.h <= 0) throw new Error('Selecciona una región de recorte positiva.')
  return { left, top, width: right - left, height: bottom - top }
}

export function validarRotacion(grados: number): 0 | 90 | 180 | 270 {
  if (!Number.isInteger(grados) || grados % 90 !== 0) {
    throw new Error('Las rotaciones sin remuestreo deben ser múltiplos de 90 grados.')
  }
  return (((grados % 360) + 360) % 360) as 0 | 90 | 180 | 270
}

export async function procesarImagenConCalidad(solicitud: SolicitudImagenCalidad): Promise<{
  formato: FormatoImagenCalidad
  modo: 'sin-perdida-adicional' | 'jpeg-recodificado'
  ancho: number
  alto: number
}> {
  const { rutaOriginal, rutaSalida, operacion } = solicitud
  const formato = formatoImagenCalidad(path.extname(rutaOriginal), solicitud.conservarJpg)
  if (path.resolve(rutaOriginal).toLowerCase() === path.resolve(rutaSalida).toLowerCase()) {
    throw new Error('No se puede sobrescribir la imagen original.')
  }
  if (path.extname(rutaSalida).toLowerCase() !== '.' + formato) {
    throw new Error('La extensión de salida no coincide con el codificador seleccionado.')
  }
  const original = await fs.promises.stat(rutaOriginal)
  if (!original.isFile()) throw new Error('La imagen de origen no es un archivo.')
  if (fs.existsSync(rutaSalida)) throw new Error('El archivo de destino ya existe.')

  // Sharp procesa el archivo original en el proceso principal, sin dibujarlo
  // ni redimensionarlo en un canvas de Chromium.
  const metadata = await sharp(rutaOriginal, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata()
  const { width, height, pages, orientation } = metadata
  if (!width || !height || (pages && pages > 1)) {
    throw new Error('La imagen no tiene dimensiones válidas o es una animación no compatible.')
  }
  const intercambia = [5, 6, 7, 8].includes(orientation ?? 1)
  const widthVisible = intercambia ? height : width
  const heightVisible = intercambia ? width : height

  let pipeline = sharp(rutaOriginal, { limitInputPixels: 80_000_000, failOn: 'error' })
    .autoOrient()

  if (operacion.tipo === 'recortar') {
    const rect = normalizarRecorte(operacion.region, widthVisible, heightVisible)
    pipeline = pipeline.extract(rect)
  } else {
    const grados = validarRotacion(operacion.grados)
    if (operacion.voltearH) pipeline = pipeline.flop()
    if (operacion.voltearV) pipeline = pipeline.flip()
    if (grados) pipeline = pipeline.rotate(grados)
  }

  // Intentar conservar ICC, EXIF, XMP e IPTC. Reescribir Orientation=1 evita
  // que otro visor aplique una segunda rotación al archivo ya orientado.
  pipeline = pipeline.keepMetadata().withExifMerge({ IFD0: { Orientation: '1' } })
  if (formato === 'png') pipeline = pipeline.png({ compressionLevel: 6 })
  else if (formato === 'webp') pipeline = pipeline.webp({ lossless: true, effort: 4 })
  else pipeline = pipeline.jpeg({ quality: 100, chromaSubsampling: '4:4:4' })

  try {
    const resultado = await pipeline.toFile(rutaSalida)
    if (!resultado.width || !resultado.height || resultado.size < 20) {
      throw new Error('No se pudo crear una imagen válida.')
    }
    return {
      formato,
      modo: formato === 'jpg' ? 'jpeg-recodificado' : 'sin-perdida-adicional',
      ancho: resultado.width,
      alto: resultado.height
    }
  } catch (error) {
    await fs.promises.rm(rutaSalida, { force: true }).catch(() => {})
    throw error
  }
}
