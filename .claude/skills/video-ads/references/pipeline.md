# Pipeline paso a paso (comandos reproducibles)

Directorio: `creative/istock-ad` (pnpm, Remotion 4.0.520, Playwright 1.62.1).

## 0. Dev server de la app (para capturas)
```
cd apps/web && pnpm dev -p 3101
```
Vidriera: `http://demo.localhost:3101/`, ficha `/p/iphone-14-pro-256-grafito`.
Panel: login driver local `owner@demo.maat.work` + cualquier password ≥ 8, click
`button[value="sign_in"]`. Alta: `/app/stock/nuevo`.

## 1. Fotos (Higgsfield)
- `generate_image_batch` modelo `nano_banana_pro`, 1:1, prompts tipo: "iPhone 14 Pro 256 GB
  space black, used excellent, on a light wooden desk, natural window light, product photo,
  no text, no hands". Una por equipo del seed (11 en v10).
- `jobs_wait` necesita `jobs:[{index, job_id}]` (el `index` es obligatorio).
- Descargar PNG a `public/v10/photos/<slug>.png` (ignorado) y convertir:
```
sips -Z 1000 -s format jpeg -s formatOptions 82 X.png --out X.jpg
```

## 2. Capturas (`scripts/capture-v10.mjs`, `pnpm capture`)
- Viewport 390x844, `deviceScaleFactor: 3`, `fullPage: true`.
- `PHOTO_MAP` alt → jpg: se inyecta como base64 en cada `<img>` cuyo `alt` matchea.
- `clean(page)`: reescribe text nodes (`iStock Demo — Alto Valle` → `Alto Valle Celulares`,
  `demo.maat.work` → `altovalle.maat.work`), oculta `nextjs-portal`, toasts, `nav.panel-nav`,
  y los grupos de campo de IMEI y costo (`label.parentElement.style.display='none'`).
- Estados del form: `form-0..4` (modelo → GB/color → estado → precio/batería), con geometría de
  cada campo en CSS px a `form-geom.json` (IMEI/costo con w=h=0, lo verifica el smoke test).
- La ficha escribe `wa-href.txt` con el `wa.me` real: el texto de `PRODUCT.waText` sale de ahí.

## 3. Música
Ver `music-acestep.md`. Salida: `public/music/{night,bright,warm}.wav` (24 s, 48 kHz, sin recorte:
`SoundDesign` hace fade in 12 f / fade out 24 f según la duración del anuncio).

## 4. Composición (sistema de specs, desde 2026-09-04)
- `src/theme.ts`: `VIDEO` 1080x1920 30 fps · `SAFE_ZONE` · `PHONE` {390x844 CSS, scale 1.45,
  left 257, top 622, bezel 22, radius 84, statusHeight 50} · `PRODUCT` (tenant, host, waText).
- `src/ads/spec.ts`: tipos `AdSpec`/`SceneSpec` y `timeline(spec)` (start/end, kickers, `prev`).
  `src/ads/sound.ts`: `cuesFor(scenes)` deriva whoosh/sweep/tap/tick/riser/impact/chimes.
  `src/ads/index.ts`: los anuncios (`ADS`). `src/Ad.tsx`: builder (wipes, glow, visibilidad,
  `SoundDesign`). `src/Root.tsx`: una `Composition` por spec.
- Escenas (`src/scenes/`): `Hook` (`ChatHook`, `HeadlineHook`) · `Upload` (form real, anillo
  `FieldTap` por campo) · `Screen` (cualquier captura: scroll `glide`, pill host, highlight) ·
  `WhatsApp` · `Close`. Tabla de campos por escena: `creative/istock-ad/ADS.md`.
- Primitivas: `Phone.tsx` (island zIndex 2) · `Screenshot.tsx` (status bar "23:52" + scroll) ·
  `Caption.tsx` (kicker + título centrado) · `Wipe.tsx` (12 f) · `FieldTap.tsx` ·
  `SoundDesign.tsx` (música por cama + cues, ducking 0.22).
- Movimiento: `src/motion.ts` (`ease`, `glide`, `fade`, `pop` spring d16 s170 m0.6, `settle`).
- Un anuncio nuevo = un spec + `publish/<slug>/03-caption.txt`. Nada más se toca.

## 5. Render y master
```
pnpm typecheck && pnpm lint
pnpm compositions                # ids y duraciones
pnpm build [IstockPesos ...]     # render crf 17 → ffmpeg master → portada (fin-40 f) → publish/<slug>/
pnpm test && pnpm safe-zone
```
`scripts/build-ads.mjs` lee los ids de `remotion compositions`, deriva el slug del id
(`IstockReelV10` → `reel-v10`) y exige que el caption exista antes de renderizar.

## 6. QA con evidencia
```
ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_primaries,sample_rate,channels -show_entries format=duration,size out/istock-<slug>.mp4
ffmpeg -i out/istock-<slug>.mp4 -af loudnorm=I=-17:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | tail -12
ffmpeg -y -i out/istock-<slug>.mp4 -vf "fps=30/18,scale=160:-1,tile=10x3" out/<slug>-final-contact.png
```
Antes del render, stills por escena: `npx remotion still src/index.ts <id> out/qa/<id>-<n>.png
--frame=<n>` y un `hstack` con ffmpeg, mirado. Esperado (v10): h264 High 1080x1920 30/1 yuv420p bt709, aac 48000 st, 18.000 s;
input_i ≈ -16.1 LUFS, input_tp ≤ -1.5. Mirar el contact sheet: safe zone, nada de IMEI/costo,
titulares legibles en cada escena, portada (frame 500) con marca + CTA.

## 7. Commit
Checks de concurrencia (`ListAgents`, `lsof -d cwd | grep istock`, `git reflog -5`,
`git diff --cached --stat` vacío) y `git add` de paths nombrados: `src scripts public/sfx
public/v10 public/music public/istock-mark.svg publish/<slug> README.md ADS.md BRIEF-v<N>.md
package.json pnpm-lock.yaml tsconfig.json remotion.config.ts .gitignore`. Prefijo `[feat]`.
