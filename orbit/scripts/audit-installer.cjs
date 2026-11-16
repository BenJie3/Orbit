// Comprobación no destructiva del instalador de Orbit.
// Uso: npm run audit:installer
//      npm run audit:installer -- --release (requiere latest.yml verificable)
// No valida licencias de terceros ni sustituye una prueba de instalación/actualización.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const lock = require(path.join(root, 'package-lock.json'))
const dist = path.join(root, 'dist')
const unpacked = path.join(dist, 'win-unpacked')
const resources = path.join(unpacked, 'resources')
const setupName = 'orbit-' + pkg.version + '-Setup.exe'
const strictRelease = process.argv.includes('--release')
const errors = []
const warnings = []
const passed = []
function check(condition, ok, error) {
  if (condition) passed.push(ok)
  else errors.push(error)
}
function exists(file) { return fs.existsSync(file) && fs.statSync(file).isFile() }
function sha256(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count))
    }
  } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}
function sha512base64(file) {
  const hash = crypto.createHash('sha512')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count))
    }
  } finally { fs.closeSync(fd) }
  return hash.digest('base64')
}

check(pkg.version === lock.version && pkg.version === lock.packages?.['']?.version,
  'Versión de package.json y package-lock.json coincidente.',
  'La versión no coincide entre package.json y package-lock.json.')

const setup = path.join(dist, setupName)
check(exists(setup), 'Instalador NSIS presente: ' + setupName,
  'No se encontró el instalador ' + setupName)
check(exists(path.join(unpacked, 'Orbit.exe')),
  'Ejecutable de Windows incluido.',
  'Falta dist/win-unpacked/Orbit.exe.')
check(exists(path.join(resources, 'app.asar')),
  'Aplicación Electron empaquetada.',
  'Falta resources/app.asar.')

const engine = path.join(resources, 'video-engine')
const ffmpeg = path.join(engine, 'ffmpeg.exe')
const recordPath = path.join(engine, 'motor-verificado.json')
const license = path.join(engine, 'COPYING.GPL-3.0.txt')
const sourceInfo = path.join(engine, 'SOURCE-FFMPEG.txt')
check(exists(ffmpeg), 'FFmpeg incluido como recurso independiente.',
  'Falta resources/video-engine/ffmpeg.exe.')
check(exists(license), 'Texto GPLv3 incluido junto al motor.',
  'Falta la licencia de FFmpeg en el instalador.')
check(exists(sourceInfo), 'Origen de FFmpeg documentado.',
  'Falta SOURCE-FFMPEG.txt.')

if (exists(ffmpeg) && exists(recordPath)) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    check(/^[0-9a-f]{64}$/i.test(record.exeSha256) &&
      sha256(ffmpeg) === record.exeSha256,
      'Hash SHA-256 del FFmpeg empaquetado coincide.',
      'El FFmpeg empaquetado no coincide con su registro SHA-256.')
    check(/^[0-9a-f]{64}$/i.test(record.archiveSha256),
      'Paquete de origen identificado por SHA-256.',
      'Falta la huella SHA-256 del paquete de origen.')
  } catch (err) { errors.push('Registro de integridad del motor no válido: ' + err.message) }
} else {
  errors.push('Falta el registro de integridad del FFmpeg empaquetado.')
}

const updateConfig = path.join(resources, 'app-update.yml')
if (exists(updateConfig)) {
  const settings = fs.readFileSync(updateConfig, 'utf8')
  check(/\bprovider:\s*github\b/.test(settings) && /\bowner:\s*BenJie3\b/.test(settings) &&
    /\brepo:\s*Orbit\b/.test(settings),
    'Proveedor del actualizador: GitHub BenJie3/Orbit.',
    'La configuración del actualizador no apunta a GitHub BenJie3/Orbit.')
} else {
  errors.push('Falta resources/app-update.yml: el instalador no tiene proveedor de actualizaciones.')
}

const manifest = path.join(dist, 'latest.yml')
if (exists(manifest)) {
  const yaml = fs.readFileSync(manifest, 'utf8')
  const sha = yaml.match(/^\s*sha512:\s*['"]?([A-Za-z0-9+/=]+)['"]?\s*$/m)?.[1]
  const name = yaml.match(/^\s*path:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]
  const version = yaml.match(/^\s*version:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]
  check(name === setupName, 'latest.yml referencia el instalador correcto.',
    'latest.yml no referencia ' + setupName + '.')
  check(version === pkg.version, 'latest.yml utiliza la versión correcta.',
    'latest.yml no coincide con la versión ' + pkg.version + '.')
  if (exists(setup)) {
    check(Boolean(sha) && sha === sha512base64(setup),
      'SHA-512 de latest.yml coincide con el instalador.',
      'SHA-512 de latest.yml no coincide con el instalador.')
  }
} else if (strictRelease) {
  errors.push('Falta latest.yml: no se puede comprobar el paquete de actualización.')
} else {
  warnings.push('latest.yml no encontrado: falta validar el manifiesto en un build de publicación.')
}

if (exists(setup)) {
  passed.push('Tamaño de descarga: ' + (fs.statSync(setup).size / 1048576).toFixed(1) + ' MiB.')
}

warnings.push('Pendiente validación manual: firma Authenticode, actualización real y apertura/desinstalación.')
warnings.push('Pendiente revisión legal: fuente correspondiente, avisos y redistribución del FFmpeg GPL.')
for (const item of passed) console.log('[OK] ' + item)
for (const item of warnings) console.warn('[PENDIENTE] ' + item)
for (const item of errors) console.error('[ERROR] ' + item)
console.log('[Orbit] Auditoría: ' + passed.length + ' comprobaciones superadas; ' +
  errors.length + ' errores; ' + warnings.length + ' pendientes.')
if (errors.length) process.exitCode = 1
