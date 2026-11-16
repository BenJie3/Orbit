const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const codigo = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/wallpaper-colors.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const mod = { exports: {} }
new Function('module', 'exports', codigo)(mod, mod.exports)
const { leerColorProyecto, obtenerTonoImagen } = mod.exports

const pixel = (r, g, b, repeticiones = 32) =>
  Uint8Array.from(Array.from({ length: repeticiones }, () => [r, g, b]).flat())

const rojoOscuro = obtenerTonoImagen(pixel(34, 2, 5))
assert.ok(!rojoOscuro.neutro && (rojoOscuro.h < 20 || rojoOscuro.h > 340),
  'El rojo oscuro no debe regresar al tema zafiro')

const azulOscuro = obtenerTonoImagen(pixel(3, 3, 37))
assert.ok(!azulOscuro.neutro && azulOscuro.h > 230 && azulOscuro.h < 250,
  'El azul oscuro debe conservar su tonalidad')

const verde = obtenerTonoImagen(pixel(12, 180, 25))
assert.ok(!verde.neutro && verde.h > 95 && verde.h < 145,
  'El verde brillante debe producir una tonalidad verde')

const gris = obtenerTonoImagen(pixel(52, 52, 52))
assert.equal(gris.neutro, true, 'El fondo gris debe producir un tema neutro')
const negro = obtenerTonoImagen(pixel(0, 0, 0))
assert.equal(negro.neutro, true, 'El negro debe producir un tema neutro')

assert.equal(obtenerTonoImagen(new Uint8Array(0)), null)
const hexRojo = leerColorProyecto('#ff0022')
assert.ok(hexRojo.h < 15 || hexRojo.h > 340)
assert.ok(leerColorProyecto('0 1 0').h > 100)
assert.ok(leerColorProyecto('0.125 0.125 0.125').neutro)
assert.ok(leerColorProyecto({ value: '0 0 1' }).h > 235)
assert.ok(leerColorProyecto([255, 0, 0]).h < 5)
assert.equal(leerColorProyecto('uncolor'), null)
console.log('[Orbit] Pruebas de color de wallpaper superadas (12 casos).')
