const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/main/video-clip.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText
const mod = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports)
const { validarRecorteVideo, metadatosCompatibles, argumentosRecorte, recortarVideoConFfmpeg } = mod.exports

const fake = { origen: 'C:\\clips\\entrada.mp4', salida: 'C:\\clips\\salida.mp4',
  inicioSeg: 1, finSeg: 3, duracionTotal: 6, velocidad: 1, volumen: 1, ffmpeg: 'ffmpeg.exe' }
assert.equal(validarRecorteVideo(fake), 2)
assert.throws(() => validarRecorteVideo({ ...fake, finSeg: 0.5 }), /rango/)
assert.throws(() => validarRecorteVideo({ ...fake, velocidad: 0 }), /límites/)
assert.ok(argumentosRecorte(fake, 'C:\\clips\\temp.mp4', 'copia-rapida').includes('copy'))
assert.ok(argumentosRecorte(fake, 'C:\\clips\\temp.mp4', 'recodificado').includes('libx264'))
assert.ok(!argumentosRecorte({ ...fake, velocidad: 1.5 }, 'temp.mp4', 'recodificado', false).includes('-af'))

const sampleOutput = 'Stream #0:0(und): Video: h264 (High), yuv420p, 320x240\n' +
  'Stream #0:1(und): Audio: aac (LC), 48000 Hz'
assert.deepEqual(metadatosCompatibles(sampleOutput), { h264: true, aac: true, audio: true })
assert.deepEqual(metadatosCompatibles('Stream #0:0: Video: vp9, yuv420p'), {
  h264: false, aac: false, audio: false
})
assert.equal(metadatosCompatibles('Stream #0:0: Video: h264 (High 10), yuv420p10le').h264, false)
assert.equal(metadatosCompatibles('Stream #0:0: Video: h264 (High 4:4:4), yuv444p').h264, false)

;(async () => {
  const ffmpeg = path.join(__dirname, '..', 'build', 'video-engine', 'ffmpeg.exe')
  if (!fs.existsSync(ffmpeg)) {
    throw new Error('Falta FFmpeg verificado. Ejecuta npm run setup:video antes de esta prueba.')
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-video-test-'))
  try {
    const original = path.join(tmp, 'entrada.mp4')
    const rapido = path.join(tmp, 'salida-copia.mp4')
    const ajustado = path.join(tmp, 'salida-recodificada.mp4')
    const sinAudio = path.join(tmp, 'sin-audio.mp4')
    const recorteSilencioso = path.join(tmp, 'recorte-silencioso.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=44100',
      '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', original
    ], { timeout: 45000, stdio: 'pipe' })

    const modo1 = await recortarVideoConFfmpeg({
      origen: original, salida: rapido, inicioSeg: 0.5, finSeg: 2.5,
      duracionTotal: 4, velocidad: 1, volumen: 1, ffmpeg
    })
    assert.equal(modo1, 'copia-rapida')
    assert.ok(fs.statSync(rapido).size > 1024)
    execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', rapido,
      '-f', 'null', '-'], { timeout: 45000, stdio: 'pipe' })

    const modo2 = await recortarVideoConFfmpeg({
      origen: original, salida: ajustado, inicioSeg: 0.5, finSeg: 2.5,
      duracionTotal: 4, velocidad: 1.5, volumen: 1.2, ffmpeg
    })
    assert.equal(modo2, 'recodificado')
    assert.ok(fs.statSync(ajustado).size > 1024)
    execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', ajustado,
      '-f', 'null', '-'], { timeout: 45000, stdio: 'pipe' })

    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15',
      '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', sinAudio
    ], { timeout: 45000, stdio: 'pipe' })
    await recortarVideoConFfmpeg({
      origen: sinAudio, salida: recorteSilencioso, inicioSeg: 0.5, finSeg: 2.0,
      duracionTotal: 3, velocidad: 1.5, volumen: 1, ffmpeg
    })
    execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', recorteSilencioso,
      '-f', 'null', '-'], { timeout: 45000, stdio: 'pipe' })

    console.log('[Orbit] MP4 validado: copia, recodificación y vídeo sin audio.')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})().catch((err) => { console.error(err); process.exitCode = 1 })
