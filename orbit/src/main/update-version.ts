// Comparación SemVer para el filtro rápido de GitHub Releases.
// electron-updater continúa siendo responsable de validar, descargar e instalar.
type Parte = number | string
type Version = { numerica: [number, number, number]; pre: Parte[] }

function leerVersion(version: string): Version | null {
  const match = version.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  const pre: Parte[] = match[4] ? match[4].split('.').map((x) =>
    /^(0|[1-9]\d*)$/.test(x) ? Number(x) : x) : []
  if (pre.some((x) => x === '' || (typeof x === 'string' && /^\d+$/.test(x)))) return null
  return { numerica: [Number(match[1]), Number(match[2]), Number(match[3])], pre }
}

// Positivo: a es mayor que b. Negativo: a es menor que b.
// null: SemVer desconocido; no decidir por adelantado, delegar en updater.
export function compararVersiones(a: string, b: string): -1 | 0 | 1 | null {
  const va = leerVersion(a)
  const vb = leerVersion(b)
  if (!va || !vb) return null
  for (let i = 0; i < 3; i++) {
    if (va.numerica[i] !== vb.numerica[i]) {
      return va.numerica[i] > vb.numerica[i] ? 1 : -1
    }
  }
  if (!va.pre.length && vb.pre.length) return 1
  if (va.pre.length && !vb.pre.length) return -1
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    if (i >= va.pre.length) return -1
    if (i >= vb.pre.length) return 1
    const x = va.pre[i], y = vb.pre[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x > y ? 1 : -1
  }
  return 0
}
