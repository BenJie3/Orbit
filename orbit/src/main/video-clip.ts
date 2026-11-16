import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface RecorteVideo {
  origen: string
  salida: string
  inicioSeg: number
  finSeg: number
  duracionTotal: number
  velocidad: number
  volumen: number
  ffmpeg: string
}
export type ModoRecorteVideo = 'copia-rapida' | 'recodificado'

export function validarRecorteVideo(p: RecorteVideo): number {
  for (const n of [p.inicioSeg, p.finSeg, p.duracionTotal, p.velocidad, p.volumen]) {
    if (!Number.isFinite(n)) throw new Error('El recorte incluye valores no válidos.')
  }
  if (p.inicioSeg < 0 || p.finSeg <= p.inicioSeg || p.finSeg > p.duracionTotal + 0.3) {
    throw new Error('Selecciona un rango válido dentro de la duración del vídeo.')
  }
  if (p.finSeg - p.inicioSeg < 0.1 || p.velocidad < 0.5 || p.velocidad > 2 ||
      p.volumen < 0 || p.volumen > 2) {
    throw new Error('Los límites, la velocidad o el volumen están fuera del rango admitido.')
  }
  if (!/\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(p.origen)) {
    throw new Error('Este formato de vídeo todavía no está admitido para recorte.')
  }
  if (path.resolve(p.origen) === path.resolve(p.salida)) {
    throw new Error('El recorte no puede sobrescribir el vídeo original.')
  }
  return Math.min(p.finSeg, p.duracionTotal) - p.inicioSeg
}

export function metadatosCompatibles(salidaFfmpeg: string): { h264: boolean; aac: boolean; audio: boolean } {
  const lineas = salidaFfmpeg.split(/\r?\n/).filter((l) => /Stream #.+: (Video|Audio):/i.test(l))
  const video = lineas.find((l) => /: Video:/i.test(l))
  const audio = lineas.find((l) => /: Audio:/i.test(l))
  return {
    h264: Boolean(video && /:\s*Video:\s*h264(?:[\s,(]|$)/i.test(video)),
    aac: Boolean(audio && /:\s*Audio:\s*aac(?:[\s,(]|$)/i.test(audio)),
    audio: Boolean(audio)
  }
}

export function argumentosRecorte(p: RecorteVideo, destinoTemporal: string, modo: ModoRecorteVideo): string[] {
  const duracion = validarRecorteVideo(p)
  const comun = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', String(p.inicioSeg), '-i', p.origen,
    '-map', '0:v:0', '-map', '0:a:0?']
  if (modo === 'copia-rapida') {
    return [...comun, '-t', String(duracion), '-c:v', 'copy', '-c:a', 'copy', '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart', '-f', 'mp4', destinoTemporal]
  }
  // La recodificación se reserva para códecs no compatibles o cambios de
  // velocidad/volumen. H.264 + AAC + yuv420p es la combinación de mayor
  // compatibilidad de la salida MP4 para Windows.
  const vf = p.velocidad === 1 ? [] : ['-vf', 'setpts=(PTS-STARTPTS)/' + p.velocidad]
  const af = []
  if (p.volumen !== 1 || p.velocidad !== 1) {
    const filtros = []
    if (p.velocidad !== 1) filtros.push('atempo=' + p.velocidad)
    if (p.volumen !== 1) filtros.push('volume=' + p.volumen)
    af.push('-af', filtros.join(','))
  }
  const salidaDuracion = duracion / p.velocidad
  return [...comun, ...vf, ...af, '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
    '-t', String(salidaDuracion), '-movflags', '+faststart', '-f', 'mp4', destinoTemporal]
}

async function ejecutar(ffmpeg: string, args: string[], maxMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let errores = ''
    let terminado = false
    const tiempo = setTimeout(() => {
      proc.kill()
      terminar(new Error('FFmpeg excedió el tiempo límite del recorte.'))
    }, maxMs)
    const terminar = (error?: Error, texto?: string) => {
      if (terminado) return
      terminado = true
      clearTimeout(tiempo)
      if (error) reject(error)
      else resolve(texto || '')
    }
    proc.stderr.on('data', (chunk: Buffer) => {
      errores += chunk.toString('utf8')
      if (errores.length > 30000) errores = errores.slice(-30000)
    })
    proc.once('error', (error) => terminar(error))
    proc.once('close', (code) => {
      if (code === 0) terminar(undefined, errores)
      else terminar(new Error('FFmpeg terminó con error ' + code + ': ' + errores.slice(-500)))
    })
  })
}

async function inspeccionar(ffmpeg: string, archivo: string): Promise<ReturnType<typeof metadatosCompatibles>> {
  // FFmpeg -i termina con código 1 por no tener salida, aunque lee metadatos.
  // Conservar su stderr para detectar los códecs reales del archivo.
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', archivo],
      { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let salida = ''
    let finalizado = false
    const terminar = (error?: Error, resultado?: ReturnType<typeof metadatosCompatibles>) => {
      if (finalizado) return
      finalizado = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(resultado!)
    }
    const timeout = setTimeout(() => {
      proc.kill()
      terminar(new Error('Tiempo agotado inspeccionando el archivo multimedia.'))
    }, 15000)
    proc.stderr.on('data', (buffer: Buffer) => {
      if (salida.length < 120000) salida += buffer.toString('utf8')
    })
    proc.once('error', (err) => terminar(err))
    proc.once('close', () => {
      const info = metadatosCompatibles(salida)
      if (!/Stream #.*: Video:/i.test(salida)) {
        terminar(new Error('No se detectó una pista de vídeo válida.'))
      } else terminar(undefined, info)
    })
  })
}

export async function recortarVideoConFfmpeg(p: RecorteVideo): Promise<ModoRecorteVideo> {
  const duracion = validarRecorteVideo(p)
  if (!fs.existsSync(p.ffmpeg)) {
    throw new Error('No está instalado el motor de vídeo incluido con Orbit. Ejecuta npm run setup:video.')
  }
  if (!(await fs.promises.stat(p.origen)).isFile()) {
    throw new Error('El archivo de vídeo original no existe.')
  }
  if (fs.existsSync(p.salida)) throw new Error('El destino ya existe. Vuelve a intentar el recorte.')

  const origen = await inspeccionar(p.ffmpeg, p.origen)
  if ((await fs.promises.stat(p.origen)).size === 0) {
    throw new Error('El vídeo de origen está vacío.')
  }
  const permiteCopia = origen.h264 && (!origen.audio || origen.aac) &&
    p.velocidad === 1 && p.volumen === 1
  const intentos: ModoRecorteVideo[] = permiteCopia ? ['copia-rapida', 'recodificado'] : ['recodificado']
  let ultimoError: unknown
  for (const modo of intentos) {
    const destinoTemporal = path.join(path.dirname(p.salida),
      '.orbit-' + randomUUID() + '.mp4')
    try {
      const args = argumentosRecorte(p, destinoTemporal, modo)
      await ejecutar(p.ffmpeg, args, Math.min(30 * 60 * 1000, Math.max(60000, duracion * 20000)))
      const info = await fs.promises.stat(destinoTemporal)
      if (info.size < 1024) throw new Error('FFmpeg produjo un archivo demasiado pequeño.')
      const salida = await inspeccionar(p.ffmpeg, destinoTemporal)
      if (!salida.h264 || (salida.audio && !salida.aac)) {
        throw new Error('El archivo final no contiene H.264/AAC compatible con Windows.')
      }
      await fs.promises.rename(destinoTemporal, p.salida)
      return modo
    } catch (error) {
      ultimoError = error
      // No dejar archivos incompletos ni sustituir el vídeo de origen.
    } finally {
      await fs.promises.rm(destinoTemporal, { force: true }).catch(() => {})
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new Error('No se pudo generar un MP4 compatible.')
}
