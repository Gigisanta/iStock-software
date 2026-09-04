# iStock reel v10 — brief y guion

Fecha: 2026-09-04. Reemplaza a v9 (rechazada: mockups estáticos, sin gancho, copy genérico, CTA muerto, fotos stock, audio plano).

## Producto y destino
- Marca: **iStock** (producto de MaatWork). App: `istock.maat.work`. Vidriera del cliente: `{slug}.maat.work`.
- Formato: 1080×1920, 30 fps, 18 s (540 frames), H.264 High yuv420p BT.709, AAC 48 kHz, loudnorm I=-17 TP=-1.5.
- Uso: Instagram Reels orgánico + Meta Ads (feed/reels/stories). Safe zone Reels: x 65..1015, y 269..1248.
- Diseñado para verse **sin sonido**: todo el mensaje está en pantalla; música + SFX suman, no cargan.

## Público y promesa
- ICP: reseller de celulares del Alto Valle, 20–200 equipos, atiende por WhatsApp e Instagram.
- Dolor: todas las noches los mismos chats: "¿tenés?", "¿precio?", "¿en pesos?", "¿batería?", "¿fotos?".
- Promesa: cargás el equipo una vez → queda en tu vidriera con tu link → el cliente te escribe por WhatsApp con el equipo y el precio ya escritos.
- CTA: `istock.maat.work` · 14 días gratis.

## Reglas de producto que el video respeta
- UI real, grabada del producto (panel + vidriera demo), no mockups dibujados. Fotos de equipos generadas para el demo (no stock).
- Nunca IMEI, costo ni margen en pantalla: el form de carga se graba sólo hasta el precio y la batería.
- Texto WhatsApp exacto del producto: `Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en altovalle.maat.work y lo quiero.` (el tenant demo se presenta como `Alto Valle Celulares`)
- ARS informativo con `ceil_1000` (`USD 620 ≈ $ 923.000` es lo que muestra la ficha real).
- Copy en rioplatense, voseo.

## Guion (frames a 30 fps)

| # | Frames | Escena | En pantalla | Audio |
|---|---|---|---|---|
| 0 | 0–84 | **Gancho** | Fondo oscuro. Se apilan burbujas de chat entrantes cada vez más rápido: "¿Tenés el 14 Pro?" · "¿Precio?" · "¿Y en pesos?" · "¿Batería?" · "¿Tenés fotos?" · "¿Sigue?". Titular: **Todas las noches, lo mismo.** | pops de notificación acelerando, música entra en el frame 60 |
| 1 | 84–147 | **Cargalo una vez** | Corte a claro. Teléfono real con `/app/stock/nuevo`: se elige modelo, GB, color, estado, precio, batería; "Así va a figurar" se arma solo. Titular: **Cargá el equipo una vez.** | tick de UI por campo, downbeat en el corte |
| 2 | 147–246 | **Tu vidriera** | Vidriera real scrolleando, fotos reales, badges Disponible/Reservado/Vendido. Titular: **Queda en tu vidriera, con tu link.** Chip: `altovalle.maat.work` | música en groove |
| 3 | 246–348 | **La ficha** | Tap en el iPhone 14 Pro → ficha: USD 620 ≈ $ 923.000, batería 89 %, iCloud libre, garantía 90 días, retiro Neuquén/Cipolletti. Titular: **Dólares, pesos, batería, garantía. Todo dicho.** | tap + scroll |
| 4 | 348–456 | **WhatsApp** | Tap en **Lo quiero por WhatsApp** → pantalla estilo WhatsApp con el mensaje ya escrito, enviado. Titular: **Te escriben con el equipo ya escrito.** | swoosh + "sent" |
| 5 | 456–540 | **Cierre** | Logo iStock (tres barras + wordmark) · **14 días gratis** · `istock.maat.work` · "Producto de MaatWork". | acorde final, cola de reverb, silencio limpio al final |

## Piezas a producir
1. Fotos de equipos (11) — Higgsfield `nano_banana_pro` 1:1, se inyectan en la vidriera/panel al grabar.
2. Capturas de UI — Playwright, estados del formulario y páginas completas a 390×844 DPR 3, fotos inyectadas, devtools y campos IMEI/costo ocultos; el scroll y los taps se animan en Remotion.
3. Música — ACE-Step 1.5 local (Apache 2.0, MLX), instrumental 24 s recortado a 18 s, 120 BPM indie electronic con clímax en la escena de WhatsApp.
4. SFX — sintetizados propios (ya en `public/sfx`) + nuevos pops de notificación.
5. Composición Remotion `IstockReelV10` → `out/istock-reel-v10-source.mp4` → finalize ffmpeg → `publish/reel-v10/`.

## Aceptación
- `pnpm typecheck && pnpm lint && pnpm test` verdes en `creative/istock-ad`.
- `ffprobe` del final: 1080×1920, 30 fps, 18.0 s, h264 High yuv420p, aac 48 kHz stereo.
- Loudness medida con `ffmpeg -af loudnorm=print_format=json`: I ≈ -17 LUFS, TP ≤ -1.5 dBTP.
- Contact sheet de 18 frames revisado: nada de texto fuera de la safe zone, ningún IMEI/costo en pantalla.
