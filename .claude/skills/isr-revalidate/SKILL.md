---
name: isr-revalidate
description: Contrato de cache de la vidriera - ISR con tags por tenant, invalidación al mutar stock y verificación de que el 95% de los hits no toca Postgres. Usar en toda mutación de stock y en todo render de vidriera.
---

# isr-revalidate

La vidriera es **casi estática**. Ese es el motivo de que el costo por tenant sea centavos.
Romper el cache rompe el modelo de negocio, no sólo la performance.

## Contrato de tags
| tag | invalidan |
|---|---|
| `storefront:{slug}` | cualquier cambio de stock visible del tenant |
| `listing:{id}` | cambios de una unidad puntual |

## Quién invalida
**El panel** (`app-agent`), en la misma server action que muta. Toda mutación que cambia lo que ve
un visitante llama `revalidateTag`:

- crear / publicar listing (`draft → available`)
- cambio de precio o de TC del tenant
- `available → reserved` y expiración de reserva (`reserved → available`)
- venta (`→ sold`)
- alta/baja/reordenamiento de fotos
- cambio de datos del tenant que salen en la vidriera (teléfono, punto de retiro, horario)

**Olvidar el `revalidateTag` es un bug de slice, no un detalle.** El síntoma en producción es el peor
posible: el visitante escribe por WhatsApp por un equipo que ya se vendió.

## Fuera del cache
- Nada en la vidriera se renderiza con `cache: 'no-store'` "por las dudas".
- Cero `useEffect` + `fetch` para el listado: el HTML ya trae los datos.
- Cero Supabase Realtime en la vidriera. Realtime es **sólo** panel autenticado.
- `revalidate` por tiempo es el **piso de seguridad** (ej. 300s), no el mecanismo principal.
  El mecanismo principal es la invalidación por tag.

## Aislamiento entre tenants
El slug es parte de la clave de cache. Un test debe probar que **el contenido de un tenant nunca
se sirve bajo el host de otro** — un cache leak entre tenants es un incidente crítico.

## Verificación
1. Cargar la ficha 10 veces → contar queries a Postgres → debe ser **0** después de la primera.
2. Mutar el precio en el panel → recargar la vidriera → el precio nuevo aparece **sin esperar TTL**.
3. Medir la tasa de hits que llegan a la DB. **Alarma si supera 5%** (`cost-auditor`).

## Aceptación
```
pnpm --filter web test -- revalidate && pnpm e2e -- storefront-cache
```
