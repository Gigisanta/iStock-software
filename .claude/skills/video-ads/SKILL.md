---
name: video-ads
description: Sistema de producción de video ads verticales de iStock (Reels + Meta Ads) con Remotion, capturas Playwright de la app real, fotos Higgsfield, música ACE-Step local y master ffmpeg. Usar para iterar el reel existente o producir uno nuevo.
---

# video-ads

Sistema con el que se produjo `creative/istock-ad` v10 (2026-09-04), el primer reel aprobado
después de nueve versiones rechazadas, y con el que ese mismo día se generaron tres anuncios más
(`pesos`, `quince`, `estados`) como **specs de escenas**. Lo que está acá es el **método**; el
estado vivo se lee del repo (`creative/istock-ad/README.md`, `ADS.md`, `src/ads/index.ts`).

## Principio rector
El producto es la prueba. Un video de iStock muestra **la app real capturada**, con un solo
teléfono dominante, una idea por escena y un titular por escena, entendible **sin sonido**.
Todo lo demás (música, SFX, transiciones) acompaña. Las nueve versiones rechazadas fallaron por
mockups dibujados, varios teléfonos flotando, copy genérico, CTA muerto, fotos stock y audio
plano: `references/lessons.md`.

## Pipeline (cada paso tiene comando; ver `references/pipeline.md`)
1. **Brief** `BRIEF-v<N>.md`: promesa, ICP, guion por frames, reglas de producto, aceptación.
2. **Fotos de producto**: Higgsfield `nano_banana_pro` (2 créditos c/u), 1:1, luz natural, mesa
   de madera; se guardan PNG master (gitignore) + JPG 1000 px (versionado, el que se inyecta).
3. **Capturas de UI**: Playwright contra `apps/web` en `:3101`, viewport 390x844 DPR 3,
   `fullPage`, fotos inyectadas por `alt`, marca del tenant demo reescrita en el DOM, IMEI y
   costo ocultos, geometría de campos a `form-geom.json`. Scroll y taps se animan en Remotion,
   nunca se graban en video.
4. **Música**: ACE-Step 1.5 local (Apache 2.0, MLX, `127.0.0.1:8001`), 3 tomas por prompt de
   24 s → camas `public/music/{night,bright,warm}.wav`; el fade lo hace `SoundDesign` según la
   duración del anuncio: `references/music-acestep.md`.
5. **Composición Remotion**: un anuncio es un `AdSpec` en `src/ads/index.ts` (escenas
   `chat-hook · headline-hook · upload · screen · whatsapp · close`, cada una con sus frames);
   `timeline()` y `cuesFor()` derivan tiempos y SFX, `Ad.tsx` lo construye. `src/theme.ts`
   (VIDEO, SAFE_ZONE, COLORS, PHONE, PRODUCT) es la única fuente de constantes.
6. **Render + master**: `pnpm build [<id>]` = render crf 17 → ffmpeg (H.264 High yuv420p
   BT.709, loudnorm I=-17 TP=-1.5 LRA=7, AAC 192k 48 kHz, faststart) → portada → `publish/<slug>/`.
7. **QA**: `pnpm typecheck && pnpm lint && pnpm test && pnpm safe-zone` (`test` incluye la
   validación de specs), `pnpm qa <id>` (un still por escena, tira en `out/qa/`) mirado con los
   ojos antes del render, `ffprobe` + `loudnorm print_format=json` del master.
8. **Publicación**: `publish/<slug>/01-*.mp4 · 02-*-cover.png · 03-caption.txt`. Commit con
   paths nombrados, nunca `out/`, `tools/`, ni PNG masters.

## Reglas duras (las chequea `scripts/lint.mjs` y `scripts/smoke-test.mjs`)
- IMEI, costo, margen: nunca en pantalla ni en `src/` (tokens `imei` y `cost` prohibidos).
- El único host que aparece es `istock.maat.work` (chip, WhatsApp, cierre): la promesa es «te da
  tu propia landing». Nada de hosts de tenant (`altovalle.maat.work` fue un error corregido el
  2026-09-04), ni `demo.maat.work`, ni `iStock Demo`, ni `localhost`. El tenant demo se muestra
  como `Alto Valle Celulares`. Lo rechazan `src/ads/validate.ts`, `scripts/lint.mjs` y el guard
  de `scripts/capture-v10.mjs`.
- Sin gradientes ni `backdrop-filter`: paleta plana, papel claro y tinta oscura.
- Texto, logo y CTA dentro de la safe zone de Reels `x 65..1015, y 269..1248`.
- Texto WhatsApp exacto del producto (mapa `usado A`), ARS con `ceil_1000` como lo muestra la ficha.
- 11–18 s, un solo CTA: `istock.maat.work` + 14 días gratis. Copy rioplatense, voseo.

## Cómo iterar (la próxima versión)
1. Anuncio nuevo con las escenas existentes: un spec en `src/ads/index.ts` + caption; nada más.
   Escena nueva: primero el brief (`BRIEF-v<N>.md`, qué cambia y por qué), después el componente.
2. Tocá una capa por vez, en este orden de costo creciente: copy/frames (el spec) →
   composición → capturas (`pnpm capture`, requiere dev server) → fotos (créditos) → música.
3. Cada cambio de timing se verifica con un contact sheet (`references/pipeline.md` §QA), no de
   memoria. Dos renders seguidos que no mejoran → parar y re-plantear el brief.
4. Variantes para ads (A/B): otro spec con distinto gancho/cierre; `Root.tsx` registra una
   `Composition` por spec y `pnpm build` las renderiza todas.
5. Lo que se descubre va a `references/lessons.md` con fecha, no a la memoria de nadie.

## Herramientas y sus límites (medidos)
| Herramienta | Uso | Límite observado |
|---|---|---|
| Remotion 4 | composición, render | control exacto de frames; sin mockup de scroll real |
| Playwright | capturas de la app | necesita `apps/web` corriendo y tenant demo seedeado |
| Higgsfield `nano_banana_pro` | fotos de equipos | 2 cr c/u; buen producto, pedir siempre 1:1 y fondo simple |
| Higgsfield Seedance video_edit | fondos/transiciones | rompe la consistencia del producto Apple; no para la capa de producto (36 cr por test) |
| ACE-Step 1.5 (MLX) | música | ~17 s por toma; tech house sale plano, indie electronic con dinámica pedida por segundos sale mejor |
| ffmpeg | master, loudness, contact sheet, espectrogramas | evaluar música por envolvente no reemplaza oírla |
