// Orbit utiliza binarios precompilados N-API: no reconstruir uiohook-napi
// con @electron/rebuild durante npm ci (requiere Visual Studio Build Tools).
// Este chequeo falla explícitamente si faltan los binarios Windows x64.
const { uIOhook } = require('uiohook-napi')
const sharp = require('sharp')

if (!uIOhook || typeof uIOhook.start !== 'function' || typeof uIOhook.stop !== 'function') {
  throw new Error('uiohook-napi no expone los métodos de captura global esperados')
}
if (typeof sharp !== 'function') {
  throw new Error('sharp no tiene un binario nativo válido')
}
console.log('[Orbit] Binarios nativos cargados correctamente (uiohook-napi y sharp).')
