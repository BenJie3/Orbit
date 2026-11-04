// Icono reproducible de Orbit: azul zafiro y cian Fluent.
// Ejecutar: node scripts/generate-icon.cjs (antes del empaquetado Windows).
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const output = path.resolve(__dirname, '../build/icon.png')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="orbit" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <radialGradient id="planet" cx=".35" cy=".3" r=".85">
      <stop offset="0" stop-color="#7dd3fc"/>
      <stop offset=".55" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#0f172a"/>
    </radialGradient>
  </defs>
  <ellipse cx="256" cy="256" rx="210" ry="92" transform="rotate(-32 256 256)"
    fill="none" stroke="url(#orbit)" stroke-width="28" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="91" fill="url(#planet)" stroke="#0f172a" stroke-width="10"/>
  <circle cx="256" cy="256" r="36" fill="#e0f2fe" opacity=".95"/>
  <circle cx="401" cy="149" r="31" fill="#06b6d4" stroke="#2563eb" stroke-width="9"/>
</svg>`

fs.mkdirSync(path.dirname(output), { recursive: true })
sharp(Buffer.from(svg))
  .resize(512, 512)
  .png()
  .toFile(output)
  .then(() => console.log('Icono Zafiro/Cian generado:', output))
  .catch((error) => {
    console.error('No se pudo generar el icono:', error)
    process.exitCode = 1
  })
