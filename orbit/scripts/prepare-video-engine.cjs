/* FFmpeg estático externo para Windows x64, verificado por SHA-256.
   LICENCIA: el binario de Gyan es GPLv3. Revisar cumplimiento ANTES del Release público. */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')
const { execFileSync } = require('node:child_process')

const VERSION = '8.1.2'
const ARCHIVO = 'ffmpeg-8.1.2-essentials_build.zip'
const URL_ARCHIVO = 'https://www.gyan.dev/ffmpeg/builds/packages/' + ARCHIVO
const SHA256_ARCHIVO = 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec'
const CARPETA_FINAL = path.join(__dirname, '..', 'build', 'video-engine')
const BINARIO = path.join(CARPETA_FINAL, 'ffmpeg.exe')

async function descargar(url, destino, redirects = 0) {
  if (redirects > 5) throw new Error('Demasiadas redirecciones al descargar FFmpeg.')
  await new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000, headers: { 'User-Agent': 'Orbit-Video-Engine/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        descargar(new URL(res.headers.location, url).href, destino, redirects + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('Descarga de FFmpeg fallida. HTTP ' + res.statusCode))
        return
      }
      const archivo = fs.createWriteStream(destino, { flags: 'wx' })
      res.pipe(archivo)
      archivo.on('finish', () => archivo.close(resolve))
      archivo.on('error', reject)
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Tiempo agotado al descargar FFmpeg.')))
    req.on('error', reject)
  })
}

async function hashArchivo(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log('[Orbit] FFmpeg externo solo se empaqueta para Windows x64.')
    return
  }
  fs.mkdirSync(CARPETA_FINAL, { recursive: true })
  if (fs.existsSync(BINARIO)) {
    execFileSync(BINARIO, ['-hide_banner', '-version'], { timeout: 12000, stdio: 'ignore' })
    console.log('[Orbit] Motor de vídeo ya preparado.')
    return
  }

  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ffmpeg-'))
  const zip = path.join(temporal, ARCHIVO)
  const extraido = path.join(temporal, 'extraido')
  try {
    console.log('[Orbit] Preparando FFmpeg ' + VERSION + ' (descarga única, ~104 MB).')
    await descargar(URL_ARCHIVO, zip)
    const hash = await hashArchivo(zip)
    if (hash !== SHA256_ARCHIVO) throw new Error('SHA-256 del paquete FFmpeg incorrecto: ' + hash)
    const comando = "Expand-Archive -LiteralPath '" + zip.replace(/'/g, "''") +
      "' -DestinationPath '" + extraido.replace(/'/g, "''") + "' -Force"
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando],
      { timeout: 180000, stdio: 'pipe' })
    const raiz = fs.readdirSync(extraido).map((d) => path.join(extraido, d))
      .find((dir) => fs.existsSync(path.join(dir, 'bin', 'ffmpeg.exe')))
    if (!raiz) throw new Error('No se encontró ffmpeg.exe en el ZIP verificado.')
    fs.copyFileSync(path.join(raiz, 'bin', 'ffmpeg.exe'), BINARIO)
    execFileSync(BINARIO, ['-hide_banner', '-version'], { timeout: 12000, stdio: 'ignore' })
    const origenLicencia = path.join(raiz, 'LICENSE')
    if (fs.existsSync(origenLicencia)) {
      fs.copyFileSync(origenLicencia, path.join(CARPETA_FINAL, 'LICENSE.FFMPEG.txt'))
    }
    fs.writeFileSync(path.join(CARPETA_FINAL, 'SOURCE-FFMPEG.txt'),
      'FFmpeg ' + VERSION + ', paquete GPLv3 de Gyan Doshi\n' + URL_ARCHIVO +
      '\nSHA-256: ' + SHA256_ARCHIVO + '\n' +
      'Licencia: https://ffmpeg.org/legal.html\nFuentes: https://ffmpeg.org/download.html\n' +
      'La redistribución exige comprobar que se suministran los avisos, licencias y fuentes correspondientes.\n')
    console.log('[Orbit] FFmpeg preparado y verificado.')
  } catch (error) {
    fs.rmSync(BINARIO, { force: true })
    throw error
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[Orbit] No fue posible preparar el motor de vídeo:', err.message)
  process.exitCode = 1
})
