# Orbit

<div align="center">

# 🪐 ORBIT
### Convertidor Radial y Suite de Herramientas Flotantes para Windows

**Convierte, recorta, firma, divide y edita tus archivos al vuelo con un solo gesto en tu cursor.**

![Electron](https://img.shields.io/badge/Electron-31.4-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white)

</div>

---

## ✨ ¿Qué es Orbit?

**Orbit** es una utilidad nativa en segundo plano para Windows diseñada para eliminar la fricción de abrir programas pesados o subir archivos a páginas web solo para convertirlos o editarlos. 

Al mantener presionada tu tecla de activación (**Shift** por defecto) mientras arrastras cualquier archivo, Orbit despliega un **menú radial con estética Glassmorphism** exactamente debajo de tu cursor, detectando de forma automática el formato del archivo y guardando el resultado instantáneamente en su misma carpeta de origen.

---

## 🎨 Motor Camaleón (Windows + Wallpaper Engine)

Orbit utiliza por defecto una paleta Azul Zafiro / Cian Fluent. Desde el panel de la bandeja del sistema puedes activar **Adaptar al fondo de pantalla** para aplicar automáticamente una paleta a la rueda radial y al icono de la bandeja.

El motor lee el proyecto seleccionado de Wallpaper Engine cuando existe una vista previa accesible y utiliza un histograma HSL para identificar el tono dominante; también dispone de un respaldo para fondos de Windows. Emplea vigilancia de archivos y comprobaciones periódicas ligeras. La respuesta depende de cómo Wallpaper Engine guarde cada fondo: los cambios de escena dentro de un wallpaper animado pueden no generar un nuevo archivo de configuración.

**Diagnóstico:** al iniciar con `npm run dev`, la terminal muestra `[Orbit Wallpaper] Fuente:` y el color detectado. Orbit busca primero la configuración bajo el usuario de Windows y consulta mediante el comando oficial `getWallpaper` el wallpaper que se reproduce actualmente (incluidas playlists); no selecciona una entrada antigua del historial. Si aparece `Wallpaper Engine (preview)`, el tono procede de la miniatura del proyecto activo; si aparece `Imagen de fondo de Windows`, no se encontró un recurso usable de Wallpaper Engine. Cuando no se puede identificar ninguna imagen, Orbit mantiene el azul zafiro en lugar de usar por error el color de acento de Windows. Ahora se analizan también los tonos oscuros y los fondos neutros. Los proyectos con `schemecolor` pueden usar ese valor cuando la vista previa es demasiado gris; los videos sin imagen previa intentan obtener una miniatura desde Windows mediante Electron. **Limitación:** la miniatura proporcionada por Windows no está garantizada para todos los formatos, y los cambios de escena internos de un wallpaper animado no se capturan fotograma por fotograma. Si vuelve el tema Zafiro, la terminal incluye un diagnóstico de qué recurso faltó.

## 🎞️ Motor de vídeo (Windows)

El recorte rápido utiliza un ejecutable independiente de **FFmpeg 8.1.2**. Durante el primer `npm run dev` o `npm run build:win`, el script `npm run setup:video` descarga una distribución oficial de Gyan Doshi (~104 MB), comprueba su SHA-256, extrae solo `ffmpeg.exe` y lo incorpora al instalador con `electron-builder` (`extraResources`). Las ejecuciones posteriores reutilizan un binario verificado. Esto aumenta el tamaño instalado respecto a la edición anterior: debemos medirlo antes de la Release Candidate.

**Licencias:** la compilación de FFmpeg de Gyan utiliza **GPLv3** y se distribuye como programa separado. Se incluye su texto de licencia, el origen del binario y la suma SHA-256. **Antes de publicar un instalador a terceros, debemos comprobar y completar el cumplimiento de redistribución, incluidos los códigos fuente correspondientes y avisos de terceros.** El empaquetado y las pruebas automáticas no sustituyen esa revisión. Consulta [licencias de FFmpeg](https://ffmpeg.org/legal.html) y [descarga de Gyan](https://www.gyan.dev/ffmpeg/builds/).

## 🔄 Actualizaciones

En la versión instalada para Windows, el panel permite comprobar, descargar y aplicar nuevas versiones desde GitHub Releases, sin abrir el navegador. El instalador se valida con los metadatos de publicación de `electron-updater` y se instala mediante NSIS. Para que funcione, el Release debe contener el instalador compatible y el archivo `latest.yml`. Las actualizaciones no se ejecutan desde `npm run dev`.

## 🚀 Características Principales

### 1. 🔄 Modo Conversión Instantánea (Rueda Principal)
Orbit detecta el tipo de archivo en cuanto lo arrastras sobre la rueda y adapta sus 4 cuadrantes automáticamente:
* **Desde PDF:** Convierte a `DOCX` (preservando estructura, negritas, tablas e imágenes), `JPG`, `PNG` o `TXT`.
* **Desde Word (`DOCX`):** Convierte a `PDF`, `JPG`, `PNG` o `TXT`.
* **Desde Texto (`TXT`):** Convierte a `DOCX`, `PDF`, `JPG` o `PNG`.
* **Desde Imágenes (`JPG`, `PNG`, `WEBP`):** Convierte de forma ultrarrápida a `PDF`, `JPG`, `PNG` o `WEBP`.

### 2. 🛠️ Modo Herramientas Interactivas (Giro con Rueda del Ratón)
Mientras mantienes abierta la rueda radial, gira la **rueda del ratón hacia abajo (Scroll Down)** para cambiar al instante al **Modo TOOLS**:
* **✂️ Recortar (`PDF`, `Imágenes`, `DOCX`, `TXT`):** Selecciona un área exacta con vista previa de dimensiones en píxeles y exporta el recorte.
* **✒️ Dibujar / Firmar (`PDF`, `DOCX`, `TXT`, `Imágenes`):** Lienzo de alta precisión con curvas suavizadas, grosores de pluma (Fina, Medio, Marcador), colores de tinta, zoom de hasta **400%**, desplazamiento con mano (`Espacio + Arrastrar`) e historial para deshacer (`Ctrl + Z`).
* **📑 Dividir (`PDF`):** Selecciona visualmente qué páginas deseas extraer en un nuevo PDF único o sepáralas en archivos individuales.
* **🔄 Rotar (`PDF`, `Imágenes`, `DOCX`, `TXT`):** Gira páginas a `-90°` / `+90°` o voltéalas horizontal y verticalmente.
* **📐 Ajustar (`Imágenes`):** Redimensiona la escala (`25%`, `50%`, `75%`, `100%`) y comprime la calidad (`Ligera`, `Óptima`, `Máxima`).
* **📝 Editar (`DOCX`, `TXT`):** Editor rápido con contador de palabras y caracteres con exportación directa a `TXT`, `PDF` o `DOCX`.

### Correcciones de estabilidad (fase 0)

* **TXT → PDF:** el texto se convierte en el proceso principal a páginas PDF con texto seleccionable, sin generar PNG de página completa. Por seguridad, los TXT de entrada tienen un límite de 4 MB y 1,5 millones de caracteres; los archivos extraordinariamente extensos muestran un error en lugar de bloquear la interfaz.
* **Calidad al recortar y rotar fotografías:** PNG conserva la codificación sin pérdida; WebP se guarda con el modo lossless, y los JPG/JPEG se exportan por defecto como **PNG** para no aplicar otra compresión JPEG. El editor ofrece la opción «JPG calidad máxima (recomprime)» si se prefiere mantener el formato original, con posible pérdida por recodificación. El recorte se realiza en píxeles originales, y las rotaciones de 90° no reducen resolución. Se intenta preservar EXIF e ICC y se normaliza la orientación para evitar giros duplicados. **Limitación:** la salida PNG de un JPG mantiene los píxeles decodificados sin pérdida nueva, pero no recupera detalle ya perdido por el JPEG ni equivale a una transformación jpegtran de coeficientes DCT. Si se han hecho dibujos o quitado el fondo, se utiliza el lienzo editado y se guarda en PNG para no descartar los cambios.
* **Recorte de vídeo:** utiliza FFmpeg como proceso externo para exportar **MP4 con H.264/AAC**. Si el origen ya utiliza esos códecs, sin modificar velocidad ni volumen, copia las pistas sin recodificar (más rápido, pero el punto de inicio puede ajustarse al fotograma clave próximo). Si el origen requiere conversión o se modifica la velocidad/volumen, utiliza libx264/AAC (más lento y exacto en el tramo). Verifica los códecs de salida antes de confirmar el archivo. La compatibilidad con el reproductor de Windows debe probarse también en una instalación real.
* **Recorte de audio:** produce **WAV PCM**. No se ofrece MP3 ni WebM cuando no existe un codificador para esos formatos; antes podían producirse archivos WAV con una extensión incorrecta.
* **Fallos de conversión:** Orbit muestra un mensaje de error en lugar de ocultarlo silenciosamente. La compatibilidad real de algunos vídeos y audios requiere pruebas con archivos de cada formato en Windows.

### 3. 🎛️ Panel de Control en la Bandeja del Sistema (System Tray)
Haz clic en el icono orbital de la bandeja del sistema para abrir el centro de control de Orbit:
* **Modo Pausa y Temporizadores:** Pausa la tecla de activación indefinidamente o por **30 min**, **1 hora** o **2 horas** (ideal al jugar o redactar). También puedes hacer **doble clic** en el icono de la bandeja para pausar/reanudar al instante.
* **Tecla Personalizable:** Elige entre `Mantener Shift`, `Doble Shift ⚡`, `Mantener Alt` o `Mantener Ctrl`.
* **Historial de Conversiones Recientes:** Acceso directo para mostrar en el Explorador de Windows los últimos archivos generados.
* **Auto-inicio:** Opción integrada para iniciar Orbit automáticamente al encender Windows.

---

## 🛠️ Arquitectura y Tecnologías

* **Frontend (Renderer):** Vue 3 (Composition API) + TypeScript + Tailwind CSS + Geometría SVG dinámica + Mozilla `pdfjs-dist` para renderizado y análisis tipográfico/espacial de documentos PDF.
* **Backend (Main Process):** Electron + Node.js + `sharp` (procesamiento de imágenes de alto rendimiento) + `pdf-lib` (construcción de documentos PDF) + Motor propio `zlib`/OpenXML para lectura y generación nativa de archivos `.docx` sin dependencias externas.
* **Integración con Windows:** `uiohook-napi` para escucha global de teclado/ratón a bajo nivel y notificador nativo en C#/PowerShell (`SHChangeNotify` vía `shell32.dll`) para refrescar el Escritorio y carpetas de Windows en tiempo real sin parpadeos.

---

## 💻 Instalación y Desarrollo Local

### Prerrequisitos
* **Node.js** `v20.18.0` (versión de desarrollo fijada para preservar la compatibilidad de módulos nativos de Electron 31)
* **Windows 10 / 11 (x64)**

### Pasos para ejecutar en desarrollo
```bash
# 1. Clonar el repositorio
git clone https://github.com/BenJie3/Orbit.git
cd Orbit/orbit

# 2. Instalar exactamente las dependencias declaradas en el lockfile
npm ci --legacy-peer-deps

# 3. Verificar TypeScript e iniciar en modo desarrollo
npm run typecheck
npm run dev
