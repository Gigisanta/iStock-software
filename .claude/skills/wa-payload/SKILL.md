---
name: wa-payload
description: Construcción del texto y la URL wa.me del botón de WhatsApp de la ficha pública, más el tracking del click. Usar en cualquier lugar que genere un link de WhatsApp.
---

# wa-payload

El botón de WhatsApp **es el producto**. Un texto mal armado rompe el único momento que factura.

## Texto canónico
```
Hola, vi el {modelo} {storage} {color} ({condición}) a USD {precio} en {slug}.maat.work y lo quiero.
```
Ejemplo real de referencia (`CLAUDE.md` §1):
```
Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.
```

## Reglas
1. Vive en `packages/domain/wa.ts` como `buildWaMessage(listing, slug)`. **Función pura.**
   Nadie arma este texto a mano en un componente.
2. **Un solo botón `wa.me` por ficha.** Dos botones = dos conversaciones = cero ventas.
3. Encoding: `encodeURIComponent` sobre el texto completo. Verificá que el `+` y los acentos
   sobrevivan del lado de WhatsApp (probar en device real, no sólo en el test).
4. Teléfono: E.164 **sin** `+` ni espacios (`5492994xxxxxx`). Se toma del tenant, se valida con Zod
   al guardarlo, no al usarlo.
5. URL: `https://wa.me/{phoneE164}?text={encoded}`.
6. **Prohibido en el texto:** IMEI, costo, margen, notas internas, nombre del proveedor.
7. Precio: el **USD** de la ficha, formateado igual que en pantalla. Si en pantalla dice `620`,
   en el mensaje dice `620`. Discrepancia = bug.
8. Listing `reserved` → el copy cambia y lo dice ("está reservado, ¿te aviso si se libera?").
   Nunca prometas disponibilidad que el DTO no respalda.

## Tracking
Al click se registra `wa_click_events`: `tenant_id`, `listing_id`, `ts`, `referrer`, hash de IP.
**Sin PII.** El registro es `fire-and-forget` (`navigator.sendBeacon` o server action no bloqueante):
**nunca** demora la apertura de WhatsApp.

## Tests
- texto exacto contra el string canónico (byte a byte)
- URL-encoding de acentos y espacios
- caso `reserved` cambia el copy
- ningún campo sensible aparece en el output (test de allowlist)
