const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const codigo = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/src/media-export.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const mod = { exports: {} }
new Function('module', 'exports', codigo)(mod, mod.exports)
const { validarRangoRecorte, elegirFormatoVideo, formatoAudioDisponible } = mod.exports
assert.deepEqual(validarRangoRecorte(2, 5, 20), { inicio: 2, fin: 5, duracionSalida: 3 })
assert.equal(validarRangoRecorte(2, 5, 20, 2).duracionSalida, 1.5)
assert.equal(validarRangoRecorte(-1, 200, 10).fin, 10)
assert.throws(() => validarRangoRecorte(5, 2, 10), /fragmento/)
assert.throws(() => validarRangoRecorte(2, 2, 10), /fragmento/)
assert.throws(() => validarRangoRecorte(0, 2, 10, 0), /velocidad/)
assert.throws(() => validarRangoRecorte(NaN, 2, 10), /no son válidos/)
assert.deepEqual(elegirFormatoVideo((m) => m === 'video/webm;codecs=vp8,opus'), {
  mime: 'video/webm;codecs=vp8,opus', ext: 'webm'
})
assert.deepEqual(elegirFormatoVideo((m) => m === 'video/mp4'), {
  mime: 'video/mp4', ext: 'mp4'
})
assert.throws(() => elegirFormatoVideo(() => false), /codificador/)
assert.equal(formatoAudioDisponible('wav'), 'wav')
assert.throws(() => formatoAudioDisponible('mp3'), /Utiliza WAV/)
assert.throws(() => formatoAudioDisponible('webm'), /Utiliza WAV/)

// El reemplazo global de rAF por un temporizador de 0 ms saturaba la CPU en la captura.
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/src/App.vue'), 'utf8')
assert.ok(!/window\.requestAnimationFrame\s*=/.test(app), 'No sobrescribir requestAnimationFrame')
assert.ok(!/guardarMultimediaBytes\(wavBytes,\s*formatoDestino/.test(app),
  'Nunca guardar bytes WAV utilizando una extensión solicitada distinta')
console.log('[Orbit] Pruebas multimedia superadas (15 casos).')
