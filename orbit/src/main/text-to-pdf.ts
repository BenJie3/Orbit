import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Evita decenas de lienzos de 1224 × 1584 px y sus PNG intermedios.
// Este motor genera texto seleccionable; no rasteriza el archivo TXT.
export const MAX_CARACTERES_TXT_PDF = 1_500_000
const MAX_PAGINAS_TXT_PDF = 300

export async function generarPdfDesdeTexto(contenido: string): Promise<Uint8Array> {
  if (contenido.length > MAX_CARACTERES_TXT_PDF) {
    throw new Error('El archivo TXT supera el límite de 1,5 millones de caracteres para PDF.')
  }

  const doc = await PDFDocument.create()
  const fuente = await doc.embedFont(StandardFonts.Courier)
  const fontSize = 10
  const lineHeight = 14
  const margin = 48
  const pageWidth = 612
  const pageHeight = 792
  const ancho = pageWidth - 2 * margin
  const caracteresPorLinea = Math.max(1, Math.floor(ancho / fuente.widthOfTextAtSize('M', fontSize)))
  const reemplazos = new Map<string, string>()

  const compatible = (caracter: string): string => {
    if (caracter === '\t') return '    '
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(caracter)) return ' '
    const cache = reemplazos.get(caracter)
    if (cache !== undefined) return cache
    try {
      fuente.encodeText(caracter)
      reemplazos.set(caracter, caracter)
      return caracter
    } catch {
      // Los 14 tipos de letra estándar de PDF no incorporan todos los glifos.
      // Sustituir símbolos no codificables evita un fallo sin producir archivos corruptos.
      const transliterado = caracter.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      try {
        fuente.encodeText(transliterado)
        reemplazos.set(caracter, transliterado)
        return transliterado
      } catch {
        reemplazos.set(caracter, '?')
        return '?'
      }
    }
  }

  let pagina = doc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin - fontSize
  let paginasCreadas = 1

  const nuevaLinea = async (texto: string): Promise<void> => {
    if (y < margin) {
      if (paginasCreadas >= MAX_PAGINAS_TXT_PDF) {
        throw new Error('El TXT genera demasiadas páginas; divídelo antes de convertirlo.')
      }
      pagina = doc.addPage([pageWidth, pageHeight])
      paginasCreadas++
      y = pageHeight - margin - fontSize
      // Permitir a Electron atender la ventana durante documentos extensos.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (texto) pagina.drawText(texto, { x: margin, y, size: fontSize, font: fuente, color: rgb(0.1, 0.1, 0.1) })
    y -= lineHeight
  }

  for (const lineaOriginal of contenido.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const caracteres = Array.from(lineaOriginal, compatible).join('')
    if (!caracteres) {
      await nuevaLinea('')
      continue
    }

    let restante = caracteres
    while (restante.length > caracteresPorLinea) {
      const corteEspacio = restante.lastIndexOf(' ', caracteresPorLinea)
      const corte = corteEspacio > caracteresPorLinea / 2 ? corteEspacio + 1 : caracteresPorLinea
      await nuevaLinea(restante.slice(0, corte).trimEnd())
      restante = restante.slice(corte)
    }
    await nuevaLinea(restante)
  }

  return doc.save()
}
