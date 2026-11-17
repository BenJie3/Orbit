// Extracción de colores sin dependencias de Electron ni del sistema operativo.
export interface TonoWallpaper {
  h: number
  s: number
  neutro: boolean
}

function rgbAHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return [0, 0, l * 100]

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  return [((h * 60) + 360) % 360, s * 100, l * 100]
}

export function leerColorProyecto(valor: unknown): TonoWallpaper | null {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    const objeto = valor as Record<string, unknown>
    if ('value' in objeto) return leerColorProyecto(objeto.value)
    if (['r', 'g', 'b'].every((clave) => typeof objeto[clave] === 'number')) {
      return leerColorProyecto([objeto.r, objeto.g, objeto.b])
    }
    return null
  }

  let valores: number[]
  if (Array.isArray(valor)) {
    valores = valor.map(Number)
  } else if (typeof valor === 'string') {
    const texto = valor.trim()
    const hex = texto.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i)
    if (hex) {
      const compacto = hex[1].length === 3
        ? hex[1].split('').map((x) => x + x).join('')
        : hex[1]
      valores = [0, 2, 4].map((i) => parseInt(compacto.slice(i, i + 2), 16))
    } else {
      const normalizado = texto.replace(/^rgba?\(/i, '').replace(/\)$/, '')
      valores = normalizado.split(/[\s,;]+/).filter(Boolean).map(Number)
    }
  } else {
    return null
  }

  if (valores.length < 3 || !valores.slice(0, 3).every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) {
    return null
  }
  const rgb = valores.slice(0, 3)
  const normalizado = rgb.every((x) => x <= 1)
  const [h, s] = rgbAHsl(...(rgb.map((x) => normalizado ? x * 255 : x) as [number, number, number]))
  return { h: s < 8 ? 220 : h, s, neutro: s < 8 }
}

export function obtenerTonoImagen(pixeles: Uint8Array, canales = 3): TonoWallpaper | null {
  if (canales < 3 || pixeles.length < canales) return null
  const pesos = new Float64Array(36)
  const senos = new Float64Array(36)
  const cosenos = new Float64Array(36)
  const saturaciones = new Float64Array(36)

  let muestrasColor = 0
  for (let i = 0; i + 2 < pixeles.length; i += canales) {
    const [h, s, l] = rgbAHsl(pixeles[i], pixeles[i + 1], pixeles[i + 2])
    // Los tonos muy oscuros también cuentan: antes se ignoraba todo l < 12.
    // Descartar únicamente negro/blanco casi perfectos y ruido casi gris.
    if (l < 1.5 || l > 98.5 || s < 9) continue
    const indice = Math.min(35, Math.floor(h / 10))
    const peso = Math.pow(s / 100, 1.3) * Math.max(0.17, Math.min(1, (l + 6) / 45))
    pesos[indice] += peso
    senos[indice] += Math.sin(h * Math.PI / 180) * peso
    cosenos[indice] += Math.cos(h * Math.PI / 180) * peso
    saturaciones[indice] += s * peso
    muestrasColor++
  }

  // Si casi todos los píxeles son negros/grises, usar una paleta grafito.
  // No inventar rojo ni volver siempre al azul zafiro.
  if (muestrasColor === 0) return { h: 220, s: 0, neutro: true }

  let mejor = -1, mayor = 0
  for (let i = 0; i < 36; i++) {
    if (pesos[i] <= 0) continue
    const suavizado = pesos[i] + 0.25 * (pesos[(i + 35) % 36] + pesos[(i + 1) % 36])
    if (suavizado > mayor) { mayor = suavizado; mejor = i }
  }
  if (mejor < 0) return { h: 220, s: 0, neutro: true }

  let pesoTotal = 0, seno = 0, coseno = 0, sumaSat = 0
  for (const indice of [(mejor + 35) % 36, mejor, (mejor + 1) % 36]) {
    pesoTotal += pesos[indice]
    seno += senos[indice]
    coseno += cosenos[indice]
    sumaSat += saturaciones[indice]
  }
  if (pesoTotal <= 0) return { h: 220, s: 0, neutro: true }
  const h = (Math.atan2(seno, coseno) * 180 / Math.PI + 360) % 360
  return { h, s: sumaSat / pesoTotal, neutro: false }
}
