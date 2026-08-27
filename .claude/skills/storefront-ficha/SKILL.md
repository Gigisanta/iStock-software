---
name: storefront-ficha
description: Checklist de aceptación de la ficha pública de producto - los 15 campos mínimos, presupuesto de bytes, badge de estado y el único botón de WhatsApp. Usar al construir o revisar la ficha.
---

# storefront-ficha

La ficha es **el gate de "done cobrable"**. Si le falta un campo, la slice no pasa.

## Campos mínimos (los 15, todos obligatorios)
1. **3 fotos reales** del equipo (no render, no foto de catálogo)
2. condición (`sellado` / `open box` / `tester A+` / `usado excelente` / `usado con detalle`)
3. capacidad (GB)
4. color
5. procedencia
6. batería %
7. pantalla original (sí/no//no aplica)
8. iCloud — **texto explícito**, no un booleano suelto
9. garantía
10. **precio USD**
11. **precio ARS** (calculado con el TC del dueño)
12. punto de retiro + horario
13. medios de pago
14. acepta canje (sí/no)
15. badge de stock/reserva

\+ **UN** botón `wa.me` (ver skill `wa-payload`).

## Prohibido en la ficha
IMEI · costo · margen · notas internas · proveedor · cualquier campo que no esté en `publicListingDTO`.

## Presupuesto de performance (medido, no estimado)
| ítem | techo |
|---|---|
| imagen `card` en grilla | **200KB** |
| imágenes de la ficha (3, variante `detail`) | lazy load salvo la primera |
| JS de cliente en la ficha | mínimo — RSC por default |
| DB hits | **0** en el caso cacheado |

Above-the-fold: foto + modelo + condición + **precio** + botón WA. Sin scroll, en un celular chico.

## Estado honesto
- `available` → botón WA con copy de compra
- `reserved` → badge "Reservado" + copy alternativo. **Nunca** "disponible".
- `sold` → la ficha **no** se lista en la grilla; la URL directa muestra "vendido" + link a similares
  (decidir en `PRODUCT.md`: 200 con aviso, no 404, para no romper links compartidos en WhatsApp).

## Mobile-first
Se lee **con una mano, parado en la calle, con 4G malo**. Tocá los tamaños de tap target
(mín 44px) y el contraste. Si necesitás zoom para leer el precio, está mal.

## Aceptación
```
pnpm --filter web test -- storefront-ficha
```
El test verifica los 15 campos presentes, cero campos prohibidos en el HTML renderizado
(incluido `__NEXT_DATA__`), y el peso de la imagen `card`.
