/**
 * Seed demo **determinista**: 8 iPhones + 2 accesorios + exactamente 1 `reserved` (gate D4).
 *
 * Reglas que cumple y por qué:
 * - **Cero `Math.random`.** Los IDs son constantes; los hechos pasados se fechan con `SEED_NOW`.
 *   Un seed con azar hace que el gate pase o falle según la corrida.
 * - **Una sola lectura del reloj real** (`runNow`, abajo), y sólo para los **plazos**: los tres
 *   vencimientos que no significan nada si se los congela (`LIVE_DEADLINES` en `seed-data.ts`).
 *   El resto de la corrida es determinista dado `runNow`.
 * - **Idempotente**: borra el tenant demo y lo vuelve a crear. Correrlo dos veces deja la base
 *   exactamente igual, que es lo que uno espera de un seed y casi nunca se cumple.
 * - Corre con un rol que **bypassea RLS**: en local, el usuario del SO que creó la base (es
 *   superusuario — la base local NO tiene un rol `postgres`, `scripts/pg-local.sh` no lo crea);
 *   en Supabase, `service_role`. El seed no es un usuario: es el operador.
 *
 * `pnpm --filter @istock/db seed`
 */

import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { databaseUrl } from './env';
import {
  catalogFaqs,
  catalogModels,
  chatbotMessages,
  chatbotThreads,
  entitlements,
  fxSettings,
  listingEvents,
  listingPhotos,
  listings,
  locations,
  memberships,
  reservations,
  sales,
  subscriptions,
  tenants,
  tradeinChecklists,
  tradeinLeads,
  users,
  waClickEvents,
} from './schema';
import {
  DEMO_RESERVATION_FUSE_HOURS,
  DEMO_RESERVATION_MINUTES,
  DEMO_TRIAL_DAYS,
  SEED_DEMO_WA_PHONE_FALLBACK,
  SEED_LISTINGS,
  SEED_MODELS,
  SEED_NOW,
  SEED_OWNER_ID,
  SEED_SELLER_ID,
  SEED_TENANT_ID,
  daysAfter,
  hoursAfter,
  seedMasterKey,
  seedMediaKey,
} from './seed-data';

const RESERVED_LISTING_SLUG = 'iphone-15-pro-max-256-titanio-natural';
const SOLD_LISTING_SLUG = 'iphone-14-128-azul';

async function main(): Promise<void> {
  const { db, close } = createDb({ url: databaseUrl() });
  const waPhone = process.env['SEED_DEMO_WA_PHONE'] ?? SEED_DEMO_WA_PHONE_FALLBACK;

  /**
   * El reloj real, leído **una sola vez** y sólo para los plazos (`LIVE_DEADLINES` en
   * `seed-data.ts`). Una sola lectura y no tres: si el seed tarda, tres `new Date()` dejarían tres
   * "ahoras" distintos y la corrida dejaría de ser reproducible incluso dentro de sí misma.
   */
  const runNow = new Date();

  try {
    // ── auth.users: la identidad la emite Supabase Auth. En local la emula scripts/pg-local.sh.
    // `on conflict do nothing` para no pisar usuarios reales si alguien seedea sobre un proyecto.
    await db.execute(
      `insert into auth.users (id, email, raw_app_meta_data) values
         ('${SEED_OWNER_ID}',  'owner@demo.maat.work',  '{"tenant_id":"${SEED_TENANT_ID}","role":"owner"}'::jsonb),
         ('${SEED_SELLER_ID}', 'seller@demo.maat.work', '{"tenant_id":"${SEED_TENANT_ID}","role":"seller"}'::jsonb)
       on conflict (id) do nothing`,
    );

    // ── Limpieza en orden explícito. `sales.listing_id` es ON DELETE RESTRICT a propósito
    //    (una venta no se borra borrando el equipo), así que va primero y a mano.
    await db.delete(sales).where(eq(sales.tenantId, SEED_TENANT_ID));
    await db.delete(tenants).where(eq(tenants.id, SEED_TENANT_ID));

    // ── Catálogo GLOBAL. Sin tenant_id: un iPhone 14 Pro es el mismo para los 100 tenants.
    for (const model of SEED_MODELS) {
      await db
        .insert(catalogModels)
        .values({
          id: model.id,
          slug: model.slug,
          displayName: model.displayName,
          releaseYear: model.releaseYear,
          storageOptionsGb: [...model.storageOptionsGb],
          colors: [...model.colors],
          createdAt: SEED_NOW,
          updatedAt: SEED_NOW,
        })
        .onConflictDoNothing({ target: catalogModels.id });
    }

    const faqs = [
      { id: '00000000-0000-4000-8000-000000000301', modelSlug: null, question: '¿Qué significa "batería 85%"?', answer: 'Es la salud de la batería que informa el propio iPhone en Ajustes. 100% es una batería como nueva; abajo de 80% Apple recomienda cambiarla.' },
      { id: '00000000-0000-4000-8000-000000000302', modelSlug: 'iphone-14-pro', question: '¿El iPhone 14 Pro tiene siempre pantalla original?', answer: 'No necesariamente: si fue reparado puede tener módulo alternativo. En la ficha figura si la pantalla es original.' },
      { id: '00000000-0000-4000-8000-000000000303', modelSlug: null, question: '¿Qué es "libre de iCloud"?', answer: 'Que el equipo no tiene una cuenta de Apple asociada bloqueándolo. Sin eso, el equipo no se puede usar.' },
    ] as const;
    for (const faq of faqs) {
      const model = SEED_MODELS.find((m) => m.slug === faq.modelSlug);
      await db
        .insert(catalogFaqs)
        .values({
          id: faq.id,
          catalogModelId: model?.id ?? null,
          question: faq.question,
          answer: faq.answer,
          createdAt: SEED_NOW,
          updatedAt: SEED_NOW,
        })
        .onConflictDoNothing({ target: catalogFaqs.id });
    }

    // ── Tenant demo (S13: aislado, cero datos reales).
    await db.insert(tenants).values({
      id: SEED_TENANT_ID,
      slug: 'demo',
      name: 'iStock Demo — Alto Valle',
      waPhone,
      paymentMethods: ['Efectivo USD', 'Transferencia ARS', 'USDT', 'Tarjeta en 3 cuotas'],
      acceptsTradeIn: true,
      plan: 'negocio',
      status: 'active',
      isDemo: true,
      // PLAZO → reloj de la corrida. Congelado, el trial del demo se termina solo un día
      // cualquiera y apaga entitlements (`trialIsAlive`) sin que nadie haya tocado nada.
      trialEndsAt: daysAfter(runNow, DEMO_TRIAL_DAYS),
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

    await db
      .insert(users)
      .values([
        { id: SEED_OWNER_ID, email: 'owner@demo.maat.work', fullName: 'Dueño Demo', createdAt: SEED_NOW, updatedAt: SEED_NOW },
        { id: SEED_SELLER_ID, email: 'seller@demo.maat.work', fullName: 'Vendedor Demo', createdAt: SEED_NOW, updatedAt: SEED_NOW },
      ])
      .onConflictDoNothing({ target: users.id });

    await db.insert(memberships).values([
      { id: '00000000-0000-4000-8000-000000000401', tenantId: SEED_TENANT_ID, userId: SEED_OWNER_ID, role: 'owner', acceptedAt: SEED_NOW, createdAt: SEED_NOW, updatedAt: SEED_NOW },
      { id: '00000000-0000-4000-8000-000000000402', tenantId: SEED_TENANT_ID, userId: SEED_SELLER_ID, role: 'seller', acceptedAt: SEED_NOW, createdAt: SEED_NOW, updatedAt: SEED_NOW },
    ]);

    await db.insert(locations).values([
      { id: '00000000-0000-4000-8000-000000000501', tenantId: SEED_TENANT_ID, name: 'Local Neuquén centro', address: 'Av. Argentina 200, Neuquén', hours: 'lun a vie de 10 a 18, sáb de 10 a 13', city: 'Neuquén', sortOrder: 0, createdAt: SEED_NOW, updatedAt: SEED_NOW },
      { id: '00000000-0000-4000-8000-000000000502', tenantId: SEED_TENANT_ID, name: 'Punto Cipolletti', address: 'Roca 1100, Cipolletti', hours: 'lun a vie de 11 a 19', city: 'Cipolletti', sortOrder: 1, createdAt: SEED_NOW, updatedAt: SEED_NOW },
    ]);

    // TC del dueño, a mano, por tenant. 1487,50 ARS por USD. No hay API de dólar en el hot path.
    await db.insert(fxSettings).values({
      id: '00000000-0000-4000-8000-000000000601',
      tenantId: SEED_TENANT_ID,
      arsPerUsd: 148_750,
      rounding: 'ceil_1000',
      updatedBy: SEED_OWNER_ID,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

    await db.insert(entitlements).values(
      [
        { feature: 'chatbot', enabled: true, limitValue: 40 },
        { feature: 'reservations', enabled: true, limitValue: null },
        { feature: 'margin', enabled: true, limitValue: null },
        { feature: 'pickup_points', enabled: true, limitValue: 3 },
        { feature: 'import_csv', enabled: true, limitValue: null },
      ].map((entry, i) => ({
        id: `00000000-0000-4000-8000-00000000070${String(i + 1)}`,
        tenantId: SEED_TENANT_ID,
        feature: entry.feature,
        enabled: entry.enabled,
        limitValue: entry.limitValue,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      })),
    );

    await db.insert(subscriptions).values({
      id: '00000000-0000-4000-8000-000000000801',
      tenantId: SEED_TENANT_ID,
      provider: 'mercadopago',
      providerPreapprovalId: null,
      externalReference: `tenant:${SEED_TENANT_ID}`,
      plan: 'negocio',
      status: 'trialing',
      amountArs: 52_000_00,
      // PLAZO → reloj de la corrida. `status: 'trialing'` con un `trial_ends_at` pasado es una
      // suscripción que dice estar en prueba y no lo está.
      trialEndsAt: daysAfter(runNow, DEMO_TRIAL_DAYS),
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

    // ── Listings: 8 iPhones + 2 accesorios.
    let photoSeq = 0;
    for (const item of SEED_LISTINGS) {
      const model = item.modelSlug === null ? null : SEED_MODELS.find((m) => m.slug === item.modelSlug);
      await db.insert(listings).values({
        id: item.id,
        tenantId: SEED_TENANT_ID,
        slug: item.slug,
        kind: item.kind,
        catalogModelId: model?.id ?? null,
        title: item.title,
        storageGb: item.storageGb,
        color: item.color,
        condition: item.condition,
        batteryPct: item.batteryPct,
        screenOriginal: item.screenOriginal,
        icloudStatusText: item.icloudStatusText,
        warrantyText: item.warrantyText,
        provenanceText: item.provenanceText,
        description: item.description,
        priceUsd: item.priceUsdCents,
        costUsd: item.costUsdCents,
        supplier: item.supplier,
        internalNotes: item.internalNotes,
        imei: item.imei,
        // ADR-009: `not_checked` es el estado NORMAL y mayoritario. El alta no consulta ENACOM.
        imeiCheckStatus: item.slug === 'iphone-13-128-medianoche' ? 'valid' : 'not_checked',
        imeiCheckStatusRaw: item.slug === 'iphone-13-128-medianoche' ? 'El IMEI consultado no registra denuncia de robo o extravío.' : null,
        imeiCheckedAt: item.slug === 'iphone-13-128-medianoche' ? SEED_NOW : null,
        imeiCheckedBy: item.slug === 'iphone-13-128-medianoche' ? SEED_OWNER_ID : null,
        imeiCheckSource: item.slug === 'iphone-13-128-medianoche' ? 'enacom_web_manual' : null,
        qty: item.qty,
        status: item.status,
        publishedAt: item.status === 'draft' ? null : SEED_NOW,
        soldAt: item.status === 'sold' ? SEED_NOW : null,
        createdBy: SEED_OWNER_ID,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      });

      // 3 fotos reales por ficha: es el mínimo del gate de publicación (DOMAIN.md).
      for (let i = 0; i < 3; i += 1) {
        photoSeq += 1;
        await db.insert(listingPhotos).values({
          id: `00000000-0000-4000-8000-0000000010${String(photoSeq).padStart(2, '0')}`,
          tenantId: SEED_TENANT_ID,
          listingId: item.id,
          sortOrder: i,
          alt: `${item.title} — foto ${String(i + 1)}`,
          masterKey: seedMasterKey({
            tenantId: SEED_TENANT_ID,
            listingId: item.id,
            listingSlug: item.slug,
            index: i,
          }),
          thumbKey: seedMediaKey(item.slug, i, 'thumb'),
          cardKey: seedMediaKey(item.slug, i, 'card'),
          detailKey: seedMediaKey(item.slug, i, 'detail'),
          width: 1600,
          height: 1600,
          cardBytes: 120_000,
          createdAt: SEED_NOW,
          updatedAt: SEED_NOW,
        });
      }

      await db.insert(listingEvents).values({
        tenantId: SEED_TENANT_ID,
        listingId: item.id,
        kind: 'created',
        fromStatus: null,
        toStatus: 'draft',
        actorUserId: SEED_OWNER_ID,
        reason: 'seed demo',
        createdAt: SEED_NOW,
      });
      if (item.status !== 'draft') {
        await db.insert(listingEvents).values({
          tenantId: SEED_TENANT_ID,
          listingId: item.id,
          kind: 'status_change',
          fromStatus: 'draft',
          toStatus: item.status,
          actorUserId: SEED_OWNER_ID,
          reason: 'seed demo',
          createdAt: SEED_NOW,
        });
      }
    }

    /**
     * ── Reserva activa: exactamente una, sobre el listing `reserved` (gate D4).
     *
     * **La fila más frágil del seed.** Es la única cuyo significado depende de estar viva *ahora*:
     * desde S6 el cron `/api/cron/expire-reservations` barre `status = 'active' and
     * expires_at <= now()` cada 5 minutos, mueve el listing a `available` y la unidad no vuelve a
     * estar reservada nunca. Con `expires_at` fechado desde `SEED_NOW` eso pasaba en la primera
     * corrida del cron: el `/demo` perdía el badge "Reservado" en silencio y con retraso.
     *
     * Por eso `expires_at` y `created_at` van contra `runNow`, y la mecha es
     * `DEMO_RESERVATION_FUSE_HOURS` — el porqué de las 72 h, y el precio de que no coincidan con
     * `minutes`, están escritos junto a esa constante en `seed-data.ts`.
     */
    const reservedListing = SEED_LISTINGS.find((l) => l.slug === RESERVED_LISTING_SLUG);
    if (reservedListing === undefined) throw new Error('seed inconsistente: falta el listing reservado');
    await db.insert(reservations).values({
      id: '00000000-0000-4000-8000-000000000901',
      tenantId: SEED_TENANT_ID,
      listingId: reservedListing.id,
      status: 'active',
      minutes: DEMO_RESERVATION_MINUTES,
      // PLAZO → reloj de la corrida.
      expiresAt: hoursAfter(runNow, DEMO_RESERVATION_FUSE_HOURS),
      customerLabel: 'Juan de Cipolletti',
      createdBy: SEED_SELLER_ID,
      // La reserva se muestra **recién hecha**: un `created_at` de `SEED_NOW` con vencimiento en
      // `runNow + 72 h` sería una reserva "creada hace meses y todavía viva", que no existe.
      createdAt: runNow,
      updatedAt: runNow,
    });

    // ── Venta del listing `sold`, con el costo congelado (SENSITIVE).
    const soldListing = SEED_LISTINGS.find((l) => l.slug === SOLD_LISTING_SLUG);
    if (soldListing === undefined) throw new Error('seed inconsistente: falta el listing vendido');
    await db.insert(sales).values({
      id: '00000000-0000-4000-8000-000000000a01',
      tenantId: SEED_TENANT_ID,
      listingId: soldListing.id,
      priceUsd: soldListing.priceUsdCents,
      priceArs: 70_000_000,
      fxArsPerUsd: 148_750,
      paymentMethod: 'Efectivo USD',
      costUsd: soldListing.costUsdCents,
      internalNotes: 'Cliente de Plottier, pagó en efectivo.',
      soldBy: SEED_SELLER_ID,
      soldAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

    // ── Canje: lead + checklist presencial.
    await db.insert(tradeinLeads).values({
      id: '00000000-0000-4000-8000-000000000b01',
      tenantId: SEED_TENANT_ID,
      status: 'evaluating',
      customerName: 'Sofía Demo',
      customerWaPhone: '5492995550000',
      modelText: 'iPhone 12 128 GB',
      storageGb: 128,
      color: 'Negro',
      declaredCondition: 'used_excellent',
      batteryPct: 82,
      notes: 'Lo quiere entregar por un 14.',
      // Mismo defecto que SEED_LISTINGS (2026-08-28): esto NO es "210 con 00 centavos" sino
      // 210 dólares. `internalNotes` de abajo ya decía "210" — el número bueno estaba al lado.
      offerUsd: 21_000,
      internalNotes: 'Ofrecer 210 máximo, tiene detalle en el marco.',
      handledBy: SEED_OWNER_ID,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await db.insert(tradeinChecklists).values(
      [
        { key: 'screen_original', label: 'Pantalla original', result: 'ok' as const },
        { key: 'battery_health', label: 'Salud de batería ≥ 80%', result: 'ok' as const },
        { key: 'icloud_free', label: 'Libre de iCloud', result: 'fail' as const },
        { key: 'face_id', label: 'Face ID funcional', result: 'ok' as const },
      ].map((entry, i) => ({
        id: `00000000-0000-4000-8000-000000000b1${String(i + 1)}`,
        tenantId: SEED_TENANT_ID,
        tradeinLeadId: '00000000-0000-4000-8000-000000000b01',
        itemKey: entry.key,
        itemLabel: entry.label,
        result: entry.result,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      })),
    );

    // ── Eventos de vidriera. SIN PII: ni IP, ni user agent, ni teléfono del visitante.
    await db.insert(waClickEvents).values([
      { tenantId: SEED_TENANT_ID, listingId: SEED_LISTINGS[0]?.id ?? null, source: 'storefront_detail', createdAt: SEED_NOW },
      { tenantId: SEED_TENANT_ID, listingId: SEED_LISTINGS[1]?.id ?? null, source: 'storefront_card', createdAt: SEED_NOW },
      { tenantId: SEED_TENANT_ID, listingId: null, source: 'storefront_footer', createdAt: SEED_NOW },
    ]);

    // ── Chatbot: un hilo con handoff. El contenido sale del DTO público, nunca de la fila cruda.
    await db.insert(chatbotThreads).values({
      id: '00000000-0000-4000-8000-000000000c01',
      tenantId: SEED_TENANT_ID,
      listingId: SEED_LISTINGS[0]?.id ?? null,
      visitorHash: 'seed-visitor-hash',
      messageCount: 2,
      lastMessageAt: SEED_NOW,
      handedOffAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await db.insert(chatbotMessages).values([
      { id: '00000000-0000-4000-8000-000000000c11', tenantId: SEED_TENANT_ID, threadId: '00000000-0000-4000-8000-000000000c01', role: 'user', content: '¿Cómo está la batería del 14 Pro?', tokensIn: 18, tokensOut: 0, model: null, createdAt: SEED_NOW },
      { id: '00000000-0000-4000-8000-000000000c12', tenantId: SEED_TENANT_ID, threadId: '00000000-0000-4000-8000-000000000c01', role: 'assistant', content: 'Está al 89% y la pantalla es original. Si querés reservarlo, te paso con el local por WhatsApp.', tokensIn: 0, tokensOut: 31, model: 'gemini-2.5-flash-lite', createdAt: SEED_NOW },
    ]);

    const total = SEED_LISTINGS.length;
    const reserved = SEED_LISTINGS.filter((l) => l.status === 'reserved').length;
    const iphones = SEED_LISTINGS.filter((l) => l.kind === 'unit').length;
    process.stdout.write(
      `seed OK · tenant "demo" · ${String(total)} listings (${String(iphones)} iPhones + ` +
        `${String(total - iphones)} accesorios) · ${String(reserved)} reserved\n`,
    );
  } finally {
    await close();
  }
}

await main();
