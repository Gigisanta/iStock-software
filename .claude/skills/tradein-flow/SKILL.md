---
name: tradein-flow
description: Flujo de canje presencial - form público, checklist de recepción, inbox del panel y accept-to-stock que crea la unidad en draft. Usar en la slice S8 y en cualquier cambio de canje.
---

# tradein-flow

El canje es **presencial**. El software no tasa ni compra a distancia: **agenda y ordena**.

## Etapas
```
lead (form público)  →  contactado  →  agendado  →  recibido  →  aceptado → unidad en draft
                                                              ↘ rechazado
```

## 1. Form público (en la vidriera)
Campos: modelo (autocomplete sobre `catalog_models`) · capacidad · condición declarada ·
batería % declarada · pantalla original · iCloud liberado (sí/no/no sé) · fotos (opcional, máx 3) ·
nombre · WhatsApp · punto de retiro preferido.

**Reglas:**
- **Nada de tasación automática.** No mostramos precio de compra estimado. La expectativa la fija
  el dueño en persona, no un algoritmo. Prometer un número y bajarlo después quema al cliente.
- Rate limit por IP. Honeypot + validación Zod. Sin captcha de terceros en V1.
- El lead crea `tradein_leads` con `tenant_id` del host. **Nunca** pide IMEI en el form público.

## 2. Inbox en el panel
Lista ordenada por fecha, con estado y botón directo de WhatsApp al interesado.
**No es un CRM.** Es una bandeja con estados y una nota libre.

## 3. Checklist de recepción (presencial, en el panel)
`tradein_checklists`: IMEI (**acá sí**, es panel privado) · consulta ENACOM (link + resultado enum) ·
iCloud verificado · batería medida · pantalla original verificada · detalles estéticos ·
fotos de recepción · precio de compra acordado.

**El IMEI se carga acá y nunca sale del panel.** Ni a la vidriera, ni a logs, ni al chatbot.

## 4. Accept-to-stock
Aceptar el canje **crea una `listing` unit en `draft`** con: modelo, capacidad, color, condición
verificada, batería, `cost_usd` = precio de compra acordado, IMEI, y link al `tradein_lead` de origen.

**Queda en `draft`, nunca en `available` automáticamente.** El dueño le pone fotos y precio de venta
antes de publicar. Publicar solo lo decide una persona.

## Trazabilidad
`listing_events` registra `created_from_tradein` con el `lead_id`. Poder responder
"¿de dónde salió este equipo?" es requisito de compliance, no un nice-to-have.

## Aceptación
```
pnpm --filter web test -- tradein && pnpm e2e -- tradein
```
e2e: form público → aparece en inbox → checklist → aceptar → existe unidad en `draft` con el costo
cargado, **invisible para el rol seller**.
