# iStock ads

Anuncios verticales de iStock (SaaS de MaatWork para resellers de celulares) para Instagram Reels y Meta Ads, en Remotion: 1080x1920, 30 fps. Cada anuncio es un spec de escenas en `src/ads/index.ts` (`ADS.md` explica el sistema); hoy hay cuatro: `reel-v10` (18 s), `pesos` (12 s), `quince` (11 s) y `estados` (14.6 s). Brief y guion del primero: `BRIEF-v10.md`.

## Idea (reel-v10)

Seis beats, un teléfono, la app real:

1. `0.0–2.8 s` Gancho sobre fondo oscuro: se apilan seis preguntas de chat y el titular **Todas las noches, lo mismo.**
2. `2.8–4.9 s` **Cargá el equipo una vez.** Formulario real `/app/stock/nuevo` completándose (modelo, GB, color, estado, precio, batería).
3. `4.9–8.2 s` **Te da tu propia landing, con tu link.** Vidriera real scrolleando, chip `istock.maat.work`.
4. `8.2–11.6 s` **Dólares, pesos, batería, garantía. Todo dicho.** Ficha real: `USD 620 ≈ $ <ARS al TC del día>`, batería, iCloud, garantía.
5. `11.6–15.2 s` **Te escriben con el equipo ya escrito.** Chat estilo WhatsApp con el mensaje exacto del producto, enviado.
6. `15.2–18.0 s` Cierre: marca iStock, **Probalo 14 días gratis.**, `istock.maat.work`, Producto de MaatWork.

## Reglas que respeta

- Pantallas capturadas del producto real (`scripts/capture-v10.mjs`), no mockups. El tenant demo se muestra como `Alto Valle Celulares`; el único host que aparece en cualquier anuncio es `istock.maat.work` (la promesa es «tu propia landing»), lo vigilan `scripts/lint.mjs`, `src/ads/validate.ts` y el guard de `scripts/capture-v10.mjs`.
- IMEI, costo y margen nunca aparecen: la captura oculta esos campos y `form-geom.json` lo verifica en el smoke test.
- Mensaje de WhatsApp exacto: `Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en istock.maat.work y lo quiero.`
- Texto, logo y CTA dentro de la safe zone de Reels (`pnpm safe-zone`).
- Sin voz en off: el mensaje se entiende sin sonido.

## Assets

- `public/v10/ui/*.png`: capturas 390x844 a DPR 3 del panel y la vidriera con fotos inyectadas.
- `public/v10/photos/*`: fotos de equipos generadas (Higgsfield `nano_banana_pro`), sólo para el demo.
- `public/music/{night,bright,warm}.wav`: tres tomas instrumentales de 24 s generadas localmente con ACE-Step 1.5 (Apache 2.0, backend MLX). Prompt: `bright indie electronic instrumental, 120 bpm, punchy clap, warm plucky synth arpeggio, deep clean bass, uplifting and modern, tech product commercial, minimal intro for 2 s, full groove from 3 s, energetic final chorus from 12 s`. `SoundDesign` les hace el fade según la duración del anuncio.
- `public/sfx/*.wav`: efectos sintetizados propios.
- `public/istock-mark.svg`: marca.

## Comandos

```
pnpm capture      # requiere apps/web en :3101 con el tenant demo seedeado
pnpm typecheck && pnpm lint && pnpm test   # test = smoke + validación de specs
pnpm specs                                 # sólo la validación de specs
pnpm qa [IstockPesos ...]                  # un still por escena + tira en out/qa/<slug>-scenes.png
pnpm safe-zone
pnpm compositions            # lista los ids y duraciones
pnpm build [IstockPesos ...] # render + master + portada + copia a publish/<slug>/
```

Salida por anuncio: `out/istock-<slug>.mp4` (H.264 High, yuv420p, BT.709, AAC 192k 48 kHz, loudnorm I=-17 TP=-1.5) y `out/istock-<slug>-cover.png`, copiados a `publish/<slug>/` junto al caption.

## Herramientas locales

`tools/ACE-Step-1.5/` (ignorado por git) corre `start_api_server_macos.sh` en `127.0.0.1:8001`; las tomas se piden con `POST /release_task` y se leen con `POST /query_result`.

## Método

Cómo se produce e itera este reel (pipeline, música, lecciones por versión): skill `.claude/skills/video-ads/SKILL.md` en la raíz del repo.
