# Orbit — Fase 0: checklist de preparación de lanzamiento

Este documento separa lo **verificado automáticamente** de lo **comprobado manualmente**. Las casillas no se dan por aprobadas solo porque una compilación termine correctamente.

## Verificaciones automáticas

- [x] Compilación Electron/TypeScript en Windows, Node 20.18.0.
- [x] Pruebas unitarias de selección de wallpapers y gestión de foco.
- [x] Pruebas del generador TXT→PDF.
- [x] Pruebas de píxeles en rotación/recorte PNG, WebP y JPEG→PNG, más orientación EXIF (CI: `npm run test:images`; confirmado en Windows).
- [x] Validación manual de rotación/recorte de imágenes confirmada por el desarrollador. Los metadatos y la precisión de píxeles se verifican también con las pruebas automatizadas.
- [x] Pruebas de salida MP4 con copia de pistas, recodificación y archivo sin audio.
- [x] Instalador NSIS con FFmpeg como recurso separado en el flujo de CI.
- [x] Auditoría de integridad del instalador superada en CI (`npm run audit:installer`); repetir con el instalador candidato definitivo.
- [x] Validación de metadatos **locales** de actualización: `latest.yml`, nombre de archivo y SHA-512 coinciden con el mismo build. Pendiente probar descarga real desde GitHub Releases.

## Pruebas manuales en Windows 10/11

- [x] **Windows del desarrollador:** se ha confirmado que los clips MP4 recientes se reproducen en el reproductor de Windows; no equivale a certificación de todos los códecs.
- [ ] Instalación limpia de Windows, con Orbit totalmente cerrado antes de ejecutar el instalador.
- [ ] Apertura de la rueda, activación por teclas y salida desde System Tray sin icono intrusivo en la barra de tareas.
- [ ] Cerrar editor y rueda y comprobar retorno del teclado a la aplicación anterior.
- [ ] Arrastrar documentos pequeños y grandes; verificar archivos PDF/DOCX/TXT reales y que no sobrescribe originales.
- [ ] Comprobar recortes MP4 con y sin audio, inicio/fin, velocidad y volumen; reproducir resultados en Windows.
- [ ] Medir RAM/CPU tras 5 minutos en reposo y después de 20 aperturas de rueda.
- [ ] Comprobar uninstall y ausencia de procesos residuales; revisar si conserva configuración y si el comportamiento es correcto.
- [ ] Verificar firma digital con `./scripts/audit-signature.ps1` después de `npm run build:win`; el script comprueba instalador y `Orbit.exe`, pero **un CI en verde no significa que estén firmados**. Si aparece `NotSigned` u otro estado distinto de `Valid`, documentarlo antes de distribuir.

## Actualización automática: bloqueo antes del Release definitivo

1. El Release público existente está etiquetado `v0.1.0` pero contiene un instalador de versión interna `1.0.0`. Esto no es un camino de actualización válido: **los nombres de instalador y las versiones internas deben corresponder con el tag publicado**.
2. Una versión interna `1.0.0-rc.1` es **menor** que `1.0.0` en SemVer. Los testers que ya instalaron `1.0.0` no recibirán esa RC como actualización automática. En pruebas, realizar reinstalación manual o definir una estrategia explícita de versiones superiores.
3. El actualizador está configurado para versiones estables (`allowPrerelease=false` y `/releases/latest`). No afirmar que una RC servida como prerelease se descubrirá automáticamente con esa configuración.
4. Para comprobar el actualizador, instalar una versión base con SemVer inferior a una versión de prueba publicada de forma controlada, generar el instalador y su manifiesto con **la misma compilación** y verificar descarga, SHA-512, reinstalación, reinicio y persistencia de configuración.
5. La orden normal `npm run build:win` usa `--publish never`; no publica un Release, ni demuestra que GitHub servirá los metadatos necesarios. No crear un tag/release público hasta completar el resto de las verificaciones.

## Redistribución y licencias

- [ ] Identificar licencias de todas las dependencias distribuidas en la aplicación.
- [ ] Verificar la licencia efectiva de la compilación FFmpeg 8.1.2 de Gyan que se empaqueta como `ffmpeg.exe`.
- [ ] Documentar y poner a disposición el **código fuente correspondiente** a la compilación de FFmpeg, configuraciones/patches y dependencias sujetas a obligaciones de redistribución. Una página genérica de fuentes y el texto GPL por sí solos no demuestran cumplimiento.
- [ ] Revisar avisos de derechos de autor y licencias de los terceros incluidos. Pedir revisión legal si se pretende distribuir ampliamente.
- [ ] Comprobar que ninguna política propia contradiga licencias de terceros.
- [ ] Solo entonces autorizar la publicación de instalador a terceros.

Referencias: https://ffmpeg.org/legal.html y https://www.electron.build/docs/features/auto-update/

## Puerta de salida Fase 0 → Fase 1

No mover el PR a `main` ni publicar `v1.0.0` (o una versión alternativa correctamente elegida) hasta que se hayan aprobado: instalación/reinstalación, conversión funcional, rendimiento, actualización, integridad de metadatos y revisión de licencias.

La futura Fase 1 es la publicación controlada de una versión estable y la observación de los primeros usuarios. Las nuevas funcionalidades se mantienen fuera de esta etapa.
