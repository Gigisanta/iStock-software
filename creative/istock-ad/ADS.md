# Anuncios de iStock como datos

Cada anuncio es un `AdSpec` en `src/ads/index.ts`: id de composición, slug de publicación, cama
musical y una lista ordenada de escenas. `timeline()` (`src/ads/spec.ts`) calcula start/end de cada
escena, numera los kickers de las escenas con teléfono y decide qué captura queda debajo para el
slide. `cuesFor()` (`src/ads/sound.ts`) deriva todos los efectos de sonido de la timeline.
`Ad.tsx` construye cualquier spec; `Root.tsx` registra una `Composition` por spec.

## Escenas disponibles

| kind | fondo | qué hace | campos |
|---|---|---|---|
| `chat-hook` | tinta | burbujas de chat que se apilan y un titular | `messages[{text,time,at}]`, `headline[]`, `headlineAt` |
| `headline-hook` | tinta | 2–3 líneas grandes que caen una tras otra, sub opcional | `lines[]`, `sub?` |
| `upload` | papel | formulario real de alta completándose paso a paso | `title` |
| `screen` | papel | cualquier captura con scroll suave, pill de host y tap resaltado | `title`, `file`, `scrollFrom?`, `scrollTo`, `host?`, `highlight?{field,at}` |
| `whatsapp` | papel | chat con el mensaje exacto del producto, enviado | `title` |
| `close` | tinta | marca, líneas de cierre, CTA `istock.maat.work` | `lines[]` |

Reglas del builder: wipe de 12 frames en cada cambio tinta↔papel; entre escenas de teléfono la
nueva pantalla entra deslizando sobre la anterior; `frames` de cada escena es su duración y la
suma es la del anuncio. Las camas musicales (`public/music/{night,bright,warm}.wav`) duran 24 s y
`SoundDesign` les aplica fade, así que sirven para cualquier anuncio de hasta 24 s.

## Anuncios publicados (2026-09-04)

| id | slug | ángulo | duración | música |
|---|---|---|---|---|
| `IstockReelV10` | `reel-v10` | todas las noches las mismas preguntas → cargá una vez, vidriera, ficha, WhatsApp | 18.0 s | night |
| `IstockPesos` | `pesos` | "¿y en pesos cuánto es?" → USD y ARS al cambio del día, solos | 12.0 s | bright |
| `IstockQuince` | `quince` | 15 equipos en una tarde → formulario, stock entero en un link | 11.0 s | warm |
| `IstockEstados` | `estados` | dejá de armar el estado a mano → copiar link, vidriera, WhatsApp | 14.6 s | bright |

## Agregar un anuncio

1. Escribí el spec en `src/ads/index.ts` y sumalo a `ADS`. El id es `Istock<Nombre>`; el slug
   sale del id (`IstockReelV10` → `reel-v10`).
2. Escribí `publish/<slug>/03-caption.txt` (rioplatense, URL `istock.maat.work`, hashtags).
3. `pnpm typecheck && pnpm lint`, stills de QA por escena (`npx remotion still src/index.ts
   <id> out/qa/<id>-<frame>.png --frame=<n>`) y un hstack mirado con los ojos.
4. `pnpm build [<id>]` renderiza, masteriza (ffmpeg, loudnorm), saca la portada y copia todo a
   `publish/<slug>/`. `pnpm test && pnpm safe-zone` cierran.
