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

## Pendientes conocidos
- Escucha humana de la música (UNVERIFIED al cierre de v10).
- Fotos generadas: sirven para el demo, reemplazar por stock real de un cliente cuando exista.
- Probar el master subido a Instagram en un teléfono chico con audio.
