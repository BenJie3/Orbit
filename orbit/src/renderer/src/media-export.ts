// Reglas de validación compartidas y testeables del recorte multimedia.
// La codificación real se realiza mediante MediaRecorder (vídeo) o PCM (audio).
export interface RangoRecorte {
  inicio: number
  fin: number
  duracionSalida: number
}

export function validarRangoRecorte(inicio: number, fin: number, duracion: number, velocidad = 1): RangoRecorte {
  if (![inicio, fin, duracion, velocidad].every(Number.isFinite)) {
    throw new Error('La duración o los límites del recorte no son válidos.')
  }
  if (duracion <= 0 || velocidad <= 0 || velocidad > 4) {
    throw new Error('La duración o la velocidad del archivo no es válida.')
  }
  const desde = Math.max(0, inicio)
  const hasta = Math.min(duracion, fin)
  if (hasta - desde < 0.1) {
    throw new Error('Selecciona un fragmento de al menos 0.1 segundos.')
  }
  return { inicio: desde, fin: hasta, duracionSalida: (hasta - desde) / velocidad }
}

export function elegirFormatoVideo(isSupported: (mime: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } {
  const formatos: { mime: string; ext: 'mp4' | 'webm' }[] = [
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ]
  const encontrado = formatos.find((f) => isSupported(f.mime))
  if (!encontrado) throw new Error('No hay un codificador de vídeo disponible en este equipo.')
  return encontrado
}

// PCM WAV nunca debe guardarse con extensión MP3 o WebM.
export function formatoAudioDisponible(solicitado: string): 'wav' {
  if (solicitado !== 'wav') {
    throw new Error('Orbit todavía no dispone de un codificador ' + solicitado.toUpperCase() + '. Utiliza WAV.')
  }
  return 'wav'
}
