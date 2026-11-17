const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.join(__dirname, '../src/main/update-version.ts')
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const compare = mod.exports.compararVersiones
const tests = [
  ['1.0.0', '0.1.0', 1],
  ['v0.1.0', '1.0.0', -1],
  ['v1.0.0', '1.0.0', 0],
  ['1.0.0-rc.1', '1.0.0', -1],
  ['1.0.0', '1.0.0-rc.1', 1],
  ['1.0.0-rc.2', '1.0.0-rc.1', 1],
  ['1.0.0-rc.10', '1.0.0-rc.2', 1],
  ['1.0.0-beta.9', '1.0.0-rc.1', -1],
  ['1.0.1-rc.1', '1.0.0', 1],
  ['1.0.1', '1.0.0', 1],
  ['2.0.0', '1.99.99', 1],
  ['1.0.0+build2', '1.0.0+build1', 0],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
  ['1.0.0-01', '1.0.0', null],
  ['no-es-semver', '1.0.0', null]
]
for (const [a, b, expected] of tests) {
  assert.equal(compare(a, b), expected, a + ' comparado con ' + b)
}
console.log('[Orbit] Comparación SemVer del actualizador superada (' + tests.length + ' casos).')
