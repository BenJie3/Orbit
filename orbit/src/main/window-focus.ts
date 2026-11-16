// Transiciones de foco de Orbit. Sin dependencias nativas; comprobables con mocks.
export interface VentanaFocoOrbit {
  isDestroyed(): boolean
  isFocused(): boolean
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void
  setSkipTaskbar(skip: boolean): void
  setFocusable(focusable: boolean): void
  showInactive(): void
  focus(): void
  blur(): void
  hide(): void
}

// La rueda y la bandeja se muestran sin forzar el foco. Los editores sí
// requieren el teclado: siempre habilitar focusable antes de focus().
export function mostrarSuperficieOrbit(ventana: VentanaFocoOrbit, enfocarEditor = false): void {
  if (ventana.isDestroyed()) return
  // En Windows, cambiar focusable puede modificar estilos nativos.
  // Reafirmar skipTaskbar DESPUÉS de habilitar el foco evita que la rueda
  // aparezca temporalmente como ventana normal en la barra de tareas.
  ventana.setFocusable(true)
  ventana.setSkipTaskbar(true)
  ventana.setIgnoreMouseEvents(false)
  ventana.showInactive()
  if (enfocarEditor) ventana.focus()
}

// Ignorar clics NO libera el teclado si Electron conserva el foco.
// Primero quitar el foco, después hacer la superficie no enfocable.
// Con un toast pendiente se conserva visible, pero no puede robar el teclado.
export function ocultarSuperficieOrbit(ventana: VentanaFocoOrbit, conservarToast = false): void {
  if (ventana.isDestroyed()) return
  ventana.setIgnoreMouseEvents(true, conservarToast ? { forward: true } : undefined)
  ventana.setSkipTaskbar(true)
  if (ventana.isFocused()) ventana.blur()
  ventana.setFocusable(false)
  if (!conservarToast) ventana.hide()
}
