// Pruebas de transiciones de foco: no se necesita una sesión gráfica.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const archivo = path.join(__dirname, '../src/main/window-focus.ts')
const compilado = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const modulo = { exports: {} }
new Function('module', 'exports', compilado)(modulo, modulo.exports)
const { mostrarSuperficieOrbit, ocultarSuperficieOrbit } = modulo.exports

function simularVentana({ focused = false, destroyed = false } = {}) {
  const llamadas = []
  let enfocada = focused
  let visible = false
  const ventana = {
    isDestroyed: () => destroyed,
    isFocused: () => enfocada,
    setSkipTaskbar: (valor) => llamadas.push('taskbar:' + valor),
    setFocusable: (valor) => llamadas.push('focusable:' + valor),
    setIgnoreMouseEvents: (valor, opciones) => llamadas.push('mouse:' + valor + (opciones?.forward ? ':forward' : '')),
    showInactive: () => { visible = true; llamadas.push('showInactive') },
    focus: () => { enfocada = true; llamadas.push('focus') },
    blur: () => { enfocada = false; llamadas.push('blur') },
    hide: () => { visible = false; llamadas.push('hide') }
  }
  return { ventana, llamadas, get focused() { return enfocada }, get visible() { return visible } }
}

// Rueda y menú de bandeja visibles sin activar teclado.
const radial = simularVentana()
mostrarSuperficieOrbit(radial.ventana)
assert.deepEqual(radial.llamadas, ['focusable:true', 'taskbar:true', 'mouse:false', 'showInactive'])
assert.equal(radial.focused, false)

// Herramientas interactivas sí pueden recibir teclado.
const editor = simularVentana()
mostrarSuperficieOrbit(editor.ventana, true)
assert.deepEqual(editor.llamadas.slice(0, 2), ['focusable:true', 'taskbar:true'])
assert.equal(editor.focused, true)
assert.equal(editor.llamadas.at(-1), 'focus')

// Al cerrar editor, dejar de capturar teclado ANTES de ocultar.
ocultarSuperficieOrbit(editor.ventana)
assert.deepEqual(editor.llamadas.slice(-5), [
  'mouse:true', 'taskbar:true', 'blur', 'focusable:false', 'hide'
])
assert.equal(editor.focused, false)
assert.equal(editor.visible, false)

// Si hay toast visible, liberar teclado sin ocultar el aviso.
const toast = simularVentana({ focused: true })
ocultarSuperficieOrbit(toast.ventana, true)
assert.deepEqual(toast.llamadas, [
  'mouse:true:forward', 'taskbar:true', 'blur', 'focusable:false'
])
assert.equal(toast.focused, false)

// No desenfocar una ventana que ya había cedido el foco.
const pasiva = simularVentana()
ocultarSuperficieOrbit(pasiva.ventana)
assert.equal(pasiva.llamadas.includes('blur'), false)

// No acceder a una ventana destruida durante el cierre de la app.
const destruida = simularVentana({ destroyed: true })
mostrarSuperficieOrbit(destruida.ventana, true)
ocultarSuperficieOrbit(destruida.ventana)
assert.equal(destruida.llamadas.length, 0)

// Reabrir la rueda tras un editor no debe enfocarla automáticamente.
editor.llamadas.length = 0
mostrarSuperficieOrbit(editor.ventana)
assert.equal(editor.focused, false)
assert.equal(editor.llamadas.includes('focus'), false)

console.log('[Orbit] Pruebas de foco superadas (7 escenarios).')
