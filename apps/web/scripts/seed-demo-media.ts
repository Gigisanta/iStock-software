import { and, asc, eq } from 'drizzle-orm';
import {
  createDb,
  databaseUrl,
  listingPhotos,
  listings,
  tenants,
} from '@istock/db';
import { buildDemoPhotoSource, uploadListingPhoto } from '@istock/media';

const DEMO_SLUG = 'demo';

/**
 * Completa el tenant técnico del demo con objetos de media reales.
 *
 * `packages/db/src/seed.ts` conserva el seed de datos puro y deja mappings deterministas. Este
 * paso operativo hidrata esos mappings a través de `uploadListingPhoto`, que es el único camino
 * permitido para escribir variantes públicas y el master privado. Es idempotente: la fuente es
 * estable y las keys content-addressed, así que repetirlo no crea una familia nueva de objetos.
 *
 * En local usa `MEDIA_LOCAL_ROOT`; en producción usa R2 cuando `MEDIA_DRIVER=r2`. El comando raíz
 * `pnpm db:seed` lo ejecuta después del seed de Postgres y le pasa una raíz local única.
 */
async function main(): Promise<void> {
  const { db, close } = createDb({ url: databaseUrl(), onIdleTimeoutSeconds: 5 });
  let listingCount = 0;
  let photoCount = 0;

  try {
    const tenant = (
      await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.slug, DEMO_SLUG), eq(tenants.isDemo, true)))
        .limit(1)
    )[0];
    if (tenant === undefined) throw new Error('no existe el tenant demo: corré primero pnpm db:seed');

    const demoListings = await db
      .select({ id: listings.id, slug: listings.slug })
      .from(listings)
      .where(eq(listings.tenantId, tenant.id))
      .orderBy(asc(listings.slug));
    if (demoListings.length === 0) throw new Error('el tenant demo no tiene listings para hidratar');

    const updatedAt = new Date();
    for (const listing of demoListings) {
      const photos = await db
        .select({ id: listingPhotos.id, sortOrder: listingPhotos.sortOrder })
        .from(listingPhotos)
        .where(
          and(
            eq(listingPhotos.tenantId, tenant.id),
            eq(listingPhotos.listingId, listing.id),
          ),
        )
        .orderBy(asc(listingPhotos.sortOrder));
      if (photos.length === 0) throw new Error(`el listing demo ${listing.slug} no tiene fotos mapeadas`);

      listingCount += 1;
      for (const photo of photos) {
        const source = await buildDemoPhotoSource({
          listingSlug: listing.slug,
          photoIndex: photo.sortOrder,
        });
        const uploaded = await uploadListingPhoto({
          tenantId: tenant.id,
          listingId: listing.id,
          data: source,
        });

        await db
          .update(listingPhotos)
          .set({
            masterKey: uploaded.masterKey,
            thumbKey: uploaded.thumbKey,
            cardKey: uploaded.cardKey,
            detailKey: uploaded.detailKey,
            width: uploaded.width,
            height: uploaded.height,
            cardBytes: uploaded.variants.card.bytes,
            updatedAt,
          })
          .where(
            and(
              eq(listingPhotos.tenantId, tenant.id),
              eq(listingPhotos.listingId, listing.id),
              eq(listingPhotos.id, photo.id),
            ),
          );
        photoCount += 1;
      }
    }
  } finally {
    await close();
  }

  console.info(`demo media OK · ${String(listingCount)} listings · ${String(photoCount)} fotos`);
}

await main();
