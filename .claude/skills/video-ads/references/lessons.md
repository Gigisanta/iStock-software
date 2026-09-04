# Lecciones por versión

## v6–v9 (2026-09-02 → 2026-09-03, rechazadas)
- Mockups dibujados y varios teléfonos flotando: "parece maqueta". → Un teléfono, UI real.
- Fotos stock de Unsplash: genéricas y con deuda de licencia. → Fotos generadas del equipo
  exacto del seed, o fotos reales del cliente.
- Copy genérico ("gestioná tu stock") y CTA `ESCRIBINOS STOCK` sin destino. → Gancho con el
  dolor concreto (los chats de todas las noches) y CTA `istock.maat.work` + 14 días gratis.
- Placas, retículas, numeración por escena: compiten con la promesa. → Una idea por escena.
- Audio: golpe por corte, loops planos. → Cues escasos, ducking, música con dinámica.
- Higgsfield Seedance `video_edit` sobre producto Apple: cambia cámaras y logo entre cuadros.
  → Sólo para fondos abstractos; nunca en la capa de producto.

## v10 (2026-09-04, aprobada como base)
- Status bar sobre la captura tapaba el dynamic island → island con `zIndex 2`.
- Anillo de foco desalineado en el form → sumar `PHONE.statusHeight` a la `y` de `form-geom`.
- Texto del compose de WhatsApp se metía en el teclado → compose bar anclada por `bottom`,
  altura automática.
- Chip de host pisaba un titular de dos líneas → teléfono a `top 640`, chip en `top+250`.
- Titular del gancho casi no se veía → burbujas cada 7 f desde el 2 y `hookEnd` en 84.
- `panel-stock` muestra costo/margen (vista owner) y `panel-lista` URLs localhost → excluidos.
- `rm -rf` bloqueado por política: los retirados se mueven al scratchpad, no se borran.
- `jobs_wait` de Higgsfield exige `index` en cada job.
- PNG masters de fotos (5–9 MB c/u) no van a git: `public/v10/photos/*.png` en `.gitignore`.

## v10 pulido (2026-09-04, pedido de Gio: "más y mejor centrado")
- El teléfono a escala 1.7 se cortaba por abajo (shell hasta y 2075). → Escala 1.45, shell
  600..1868, centrado en x; se pierde un 15 % de tamaño de UI pero el dispositivo se ve entero.
- Todo el texto de overlay pasó a centrado (titulares, chip, gancho como bloque de 720 px, cierre
  con `inline-block` para las píldoras). Las cajas de `verify-safe-zone.mjs` se actualizan a mano
  cuando cambia la geometría: es una lista declarada, no una medición.
- Regla: cada cambio de geometría se revisa con `remotion still` en 6 frames (uno por escena) y
  una tira `hstack` antes de renderizar los 540.

## Sistema de specs (2026-09-04, pedido de Gio: "un sistema y anuncios distintos")
- El reel v10 tenía los beats y las escenas cableados. → `AdSpec` (escenas con `frames`) +
  `timeline()` + `cuesFor()`: el SFX se deriva de la timeline, nunca se escribe a mano.
- `Storefront` y `Detail` eran la misma escena con otra captura. → `Screen` genérica (archivo,
  scroll, host, highlight). Cualquier captura nueva del panel entra sin componente nuevo.
- Música por anuncio: no recortar por duración; camas de 24 s y fade en `SoundDesign`.
- `remotion compositions --log=error` calla también el listado. → sin `--log` en el build.
- El slug se deriva del id de la composición: así el build no necesita leer TS desde Node.
- Highlight sobre una captura con scroll se corre con el scroll; si la idea es un campo (precio
  en pesos, botón de copiar link), la escena va sin scroll.
- El lint prohíbe `cost` en `src/`, y con eso la palabra "costo" en cualquier título.

## Pendientes conocidos
- Escucha humana de la música y de los tres anuncios nuevos (UNVERIFIED al cierre de 2026-09-04).
- Fotos generadas: sirven para el demo, reemplazar por stock real de un cliente cuando exista.
- Probar el master subido a Instagram en un teléfono chico con audio.
