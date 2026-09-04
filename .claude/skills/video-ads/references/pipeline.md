# Pipeline v10 paso a paso (comandos reproducibles)

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
Ver `music-acestep.md`. Salida: `public/v10/music.wav` (18 s, 48 kHz, fade out 16.6→18).

## 4. Composición
- `src/theme.ts`: `VIDEO` 1080x1920 30 fps 540 f · `SAFE_ZONE` · `PHONE` {390x844 CSS, scale
  1.45, left 257, top 622, bezel 22, radius 84, statusHeight 50} · `BEATS` {84,147,246,348,456,540}.
- `Phone.tsx` (shell + dynamic island zIndex 2) · `Screenshot.tsx` (status bar blanca "23:52" +
  `Img` con `translateY(-scroll)`) · `Caption.tsx` (kicker + título 68 px en safe zone) ·
  `Wipe.tsx` (placa que sube en 12 f) · `SoundDesign.tsx` (cues y ducking 0.22).
- Escenas: `Hook` (6 burbujas cada 7 f + titular) → `Upload` (form real, anillo accent por
  campo, `y + PHONE.statusHeight`) → `Storefront` (scroll 0→1180 con `glide`) → `Detail`
  (scroll 0→760) → `WhatsApp` (pantalla dibujada; compose bar anclada `bottom: 254`) → `Close`.
- Movimiento: `src/motion.ts` (`ease`, `glide`, `fade`, `pop` spring d16 s170 m0.6, `settle`).

## 5. Render y master
```
pnpm typecheck && pnpm lint && pnpm test && pnpm safe-zone
pnpm render && pnpm finalize && pnpm still
cp out/istock-reel-v10.mp4 publish/reel-v10/01-istock-reel-v10.mp4
cp out/istock-reel-v10-cover.png publish/reel-v10/02-istock-reel-v10-cover.png
```

## 6. QA con evidencia
```
ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_primaries,sample_rate,channels -show_entries format=duration,size out/istock-reel-v10.mp4
ffmpeg -i out/istock-reel-v10.mp4 -af loudnorm=I=-17:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | tail -12
ffmpeg -y -i out/istock-reel-v10.mp4 -vf "fps=30/18,scale=160:-1,tile=10x3" out/v10-final-contact.png
```
Esperado v10: h264 High 1080x1920 30/1 yuv420p bt709, aac 48000 st, 18.000 s;
input_i ≈ -16.1 LUFS, input_tp ≤ -1.5. Mirar el contact sheet: safe zone, nada de IMEI/costo,
titulares legibles en cada escena, portada (frame 500) con marca + CTA.

## 7. Commit
Checks de concurrencia (`ListAgents`, `lsof -d cwd | grep istock`, `git reflog -5`,
`git diff --cached --stat` vacío) y `git add` de paths nombrados: `src scripts public/sfx
public/v10 public/istock-mark.svg publish/reel-v<N> README.md BRIEF-v<N>.md package.json
pnpm-lock.yaml tsconfig.json remotion.config.ts .gitignore`. Prefijo `[feat]`.
