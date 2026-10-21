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
* **Node.js** `v20.x` (recomendado)
* **Windows 10 / 11 (x64)**

### Pasos para ejecutar en desarrollo
```bash
# 1. Clonar el repositorio
git clone [https://github.com/TU_USUARIO/orbit.git](https://github.com/TU_USUARIO/orbit.git)
cd orbit

# 2. Instalar dependencias
npm install --legacy-peer-deps

# 3. Iniciar en modo desarrollo
npm run dev
