const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const sharp = require('sharp')

const source = fs.readFileSync(path.join(__dirname, '../src/main/image-quality.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  }
}).outputText
const mod = { exports: {} }
new Function('require', 'module', 'exports', js)(require, mod, mod.exports)
const { formatoImagenCalidad, normalizarRecorte, validarRotacion, procesarImagenConCalidad } = mod.exports

const width = 8, height = 6
const rgba = Buffer.alloc(width * height * 4)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4
  rgba[i] = x * 27 + y
  rgba[i + 1] = y * 31 + x
  rgba[i + 2] = (x * 29 + y * 17) % 256
  rgba[i + 3] = (x + y) % 4 === 0 ? 90 : 255
}
const decoded = async (file) => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const at = (data, w, x, y) => [...data.subarray((y * w + x) * 4, (y * w + x + 1) * 4)]
const tests = []

function test(name, fn) { tests.push({ name, fn }) }

test('Respetar formatos y evitar JPEG por defecto', () => {
  assert.equal(formatoImagenCalidad('.png'), 'png')
  assert.equal(formatoImagenCalidad('.webp'), 'webp')
  assert.equal(formatoImagenCalidad('.jpg'), 'png')
  assert.equal(formatoImagenCalidad('.jpeg', true), 'jpg')
  assert.throws(() => formatoImagenCalidad('.gif'), /conserva la calidad/)
})
test('Recorte limitado a la imagen', () => {
  assert.deepEqual(normalizarRecorte({ x: 6, y: 4, w: 30, h: 30 }, width, height),
    { left: 6, top: 4, width: 2, height: 2 })
  assert.throws(() => normalizarRecorte({ x: 1, y: 1, w: 0, h: 2 }, width, height))
})
test('Rotaciones válidas', () => {
  assert.equal(validarRotacion(-90), 270)
  assert.equal(validarRotacion(450), 90)
  assert.throws(() => validarRotacion(45), /múltiplos/)
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-image-quality-'))
const png = path.join(tmp, 'original.png')
const webp = path.join(tmp, 'original.webp')
const jpg = path.join(tmp, 'original.jpg')
const jpegExif = path.join(tmp, 'orientada.jpeg')
const make = async (input, output, op, conservarJpg = false) =>
  procesarImagenConCalidad({
    rutaOriginal: input, rutaSalida: output,
    operacion: op, conservarJpg
  })

test('PNG rotación 90° intercambia dimensiones sin modificar píxeles', async () => {
  const out = path.join(tmp, 'rotada.png')
  const r = await make(png, out, { tipo: 'rotar', grados: 90, voltearH: false, voltearV: false })
  assert.deepEqual([r.ancho, r.alto, r.modo], [height, width, 'sin-perdida-adicional'])
  const { data, info } = await decoded(out)
  assert.deepEqual([info.width, info.height], [height, width])
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    assert.deepEqual(at(data, height, height - 1 - y, x), at(rgba, width, x, y))
  }
})
test('PNG recorte de píxeles exactos incluyendo alfa', async () => {
  const out = path.join(tmp, 'recorte.png')
  const r = await make(png, out, { tipo: 'recortar', region: { x: 2, y: 1, w: 3, h: 2 } })
  assert.deepEqual([r.ancho, r.alto], [3, 2])
  const { data } = await decoded(out)
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
    assert.deepEqual(at(data, 3, x, y), at(rgba, width, x + 2, y + 1))
  }
})
test('PNG reflejo horizontal previo a rotar 90°', async () => {
  const out = path.join(tmp, 'rotada-reflejada.png')
  await make(png, out, { tipo: 'rotar', grados: 90, voltearH: true, voltearV: false })
  const { data } = await decoded(out)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    assert.deepEqual(at(data, height, height - 1 - y, width - 1 - x), at(rgba, width, x, y))
  }
})
test('WebP recodificado en modo lossless, conserva píxeles decodificados', async () => {
  const out = path.join(tmp, 'rotado.webp')
  const before = await decoded(webp)
  const r = await make(webp, out, { tipo: 'rotar', grados: 180, voltearH: false, voltearV: false })
  assert.equal(r.formato, 'webp')
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'webp')
  const after = await decoded(out)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    assert.deepEqual(at(after.data, width, width - 1 - x, height - 1 - y),
      at(before.data, width, x, y))
  }
})
test('JPG por defecto se guarda PNG sin segunda cuantización', async () => {
  const out = path.join(tmp, 'jpg-a-png.png')
  const before = await decoded(jpg)
  const r = await make(jpg, out, { tipo: 'rotar', grados: 180, voltearH: false, voltearV: false })
  assert.equal(r.formato, 'png')
  const after = await decoded(out)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    assert.deepEqual(at(after.data, width, width - 1 - x, height - 1 - y),
      at(before.data, width, x, y))
  }
})
test('JPG explícito conserva extensión y declara recodificación', async () => {
  const out = path.join(tmp, 'rotado-jpg.jpg')
  const r = await make(jpg, out, { tipo: 'rotar', grados: 90, voltearH: false, voltearV: false }, true)
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(r.modo, 'jpeg-recodificado')
  assert.deepEqual([meta.width, meta.height], [height, width])
})
test('Orientación EXIF corregida una vez y dimensiones visibles', async () => {
  const before = await sharp(jpegExif).metadata()
  assert.equal(before.orientation, 6)
  const out = path.join(tmp, 'exif-recortada.png')
  const r = await make(jpegExif, out, { tipo: 'recortar', region: { x: 1, y: 2, w: 3, h: 4 } })
  assert.deepEqual([r.ancho, r.alto], [3, 4])
  const meta = await sharp(out).metadata()
  assert.ok(meta.orientation === undefined || meta.orientation === 1,
    'La salida EXIF no debe girarse una segunda vez.')
  // Los píxeles deben corresponder a la imagen auto-orientada mostrada.
  const expected = await sharp(jpegExif).autoOrient()
    .extract({ left: 1, top: 2, width: 3, height: 4 })
    .ensureAlpha().raw().toBuffer()
  const result = await sharp(out).ensureAlpha().raw().toBuffer()
  assert.deepEqual(result, expected)
})
test('Nunca se sobrescribe el archivo original', async () => {
  await assert.rejects(
    () => make(png, png, { tipo: 'rotar', grados: 90, voltearH: false, voltearV: false }),
    /sobrescribir/
  )
})

;(async () => {
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(png)
  await sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ quality: 78 }).toFile(webp)
  await sharp(rgba, { raw: { width, height, channels: 4 } }).flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 }).toFile(jpg)
  // Insertar Orientation=6 en un bloque EXIF APP1 real. Algunos codificadores
  // normalizan esa etiqueta al generar el JPG, anulando el caso de prueba.
  const tiff = Buffer.alloc(6 + 8 + 2 + 12 + 4)
  tiff.write('Exif\\0\\0', 0, 'binary')
  tiff.write('II', 6, 'ascii')
  tiff.writeUInt16LE(42, 8)
  tiff.writeUInt32LE(8, 10)
  tiff.writeUInt16LE(1, 14)
  tiff.writeUInt16LE(0x0112, 16)
  tiff.writeUInt16LE(3, 18)
  tiff.writeUInt32LE(1, 20)
  tiff.writeUInt16LE(6, 24)
  tiff.writeUInt32LE(0, 28)
  const marker = Buffer.from([0xff, 0xe1, 0, tiff.length + 2])
  const baseline = await fs.promises.readFile(jpg)
  await fs.promises.writeFile(jpegExif, Buffer.concat([
    baseline.subarray(0, 2), marker, tiff, baseline.subarray(2)
  ]))
  for (const t of tests) {
    await t.fn()
    console.log('[OK] ' + t.name)
  }
  console.log('[Orbit] Calidad de imagen: ' + tests.length + ' pruebas superadas.')
})().catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => {
    // En Windows libvips puede cerrar los manejadores unas milésimas más tarde.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await fs.promises.rm(tmp, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 })
      .catch((error) => console.warn('[Orbit] Limpieza temporal diferida:', error.message))
  })
