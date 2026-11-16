// Prueba real del PDF generado, sin abrir Electron.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { PDFDocument } = require('pdf-lib')

const codigo = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/text-to-pdf.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const modulo = { exports: {} }
new Function('require', 'module', 'exports', codigo)(require, modulo, modulo.exports)
const { generarPdfDesdeTexto, MAX_CARACTERES_TXT_PDF } = modulo.exports

;(async () => {
  const casos = [
    ['Hola Orbit\nTexto simple\n', 1],
    ['Acentos: canción, México, niño, pingüino. Símbolos: 🎬 ✅', 1],
    ['Una línea realmente larga. '.repeat(500), 2],
    [Array.from({ length: 150 }, (_, i) => 'Línea ' + (i + 1)).join('\n'), 2],
    ['', 1]
  ]
  for (const [input, esperado] of casos) {
    const bytes = await generarPdfDesdeTexto(input)
    assert.ok(bytes.length > 500, 'El PDF no debe estar vacío')
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-', 'Cabecera PDF válida')
    const doc = await PDFDocument.load(bytes)
    assert.ok(doc.getPageCount() >= esperado, 'Debe paginar correctamente')
  }
  await assert.rejects(() => generarPdfDesdeTexto('X'.repeat(MAX_CARACTERES_TXT_PDF + 1)), /límite/)
  console.log('[Orbit] TXT -> PDF validado: 6 casos, PDF real y límites de tamaño.')
})().catch((error) => { console.error(error); process.exitCode = 1 })
