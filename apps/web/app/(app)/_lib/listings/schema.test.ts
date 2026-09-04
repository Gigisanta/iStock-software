import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, checkPhotoFile, newUnitSchema, photoFromFormData } from './schema';

const base = {
  title: 'iPhone 14 Pro 256 Grafito',
  catalogModelId: '4f1a0d2e-6b5c-4a3d-9e8f-0a1b2c3d4e5f',
  condition: 'used_excellent',
  storageGb: '256',
  color: 'Grafito',
  priceUsd: '620',
  batteryPct: '89',
  imei: '',
  costUsd: '',
  description: '',
};

const parse = (patch: Partial<typeof base> = {}) => newUnitSchema.safeParse({ ...base, ...patch });

const fakeFile = (name: string, type: string, size: number): File =>
  // El contenido no importa: `checkPhotoFile` mira forma, no bytes. Un `Blob` de `size` bytes
  // sin materializar `size` bytes de basura alcanza y no infla la RAM del test.
  Object.defineProperty(new File([], name, { type }), 'size', { value: size });

describe('newUnitSchema', () => {
  it('acepta un alta típica y devuelve centavos enteros', () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.priceUsd).toBe(62000);
    expect(result.data.storageGb).toBe(256);
    expect(result.data.batteryPct).toBe(89);
    expect(result.data.imei).toBeNull();
    expect(result.data.costUsd).toBeNull();
  });

  it('normaliza el título (trim y espacios colapsados)', () => {
    const result = parse({ title: '  iPhone   14   Pro  ' });
    expect(result.success && result.data.title).toBe('iPhone 14 Pro');
  });

  it('no exige un título escrito: el server lo deriva del catálogo', () => {
    expect(parse({ title: '' }).success).toBe(true);
    const withoutTitle: Record<string, string> = { ...base };
    delete withoutTitle.title;
    expect(newUnitSchema.safeParse(withoutTitle).success).toBe(true);
  });

  it('sigue limitando un título visible malformado aunque no sea la fuente de verdad', () => {
    expect(parse({ title: 'a'.repeat(121) }).success).toBe(false);
  });

  it('la condición sale del enum de dominio, no de texto libre', () => {
    expect(parse({ condition: 'used_excellent' }).success).toBe(true);
    expect(parse({ condition: 'sealed' }).success).toBe(true);
    expect(parse({ condition: 'impecable' }).success).toBe(false);
    expect(parse({ condition: '' }).success).toBe(false);
  });

  /** Mismos bordes que los `CHECK` de Postgres: fallar acá, no con un error de constraint. */
  it('batería vive en 0..100 y acepta los dos extremos', () => {
    expect(parse({ batteryPct: '0' }).success).toBe(true);
    expect(parse({ batteryPct: '100' }).success).toBe(true);
    expect(parse({ batteryPct: '101' }).success).toBe(false);
    expect(parse({ batteryPct: '-1' }).success).toBe(false);
    expect(parse({ batteryPct: '89%' }).success).toBe(false);
    expect(parse({ batteryPct: '' }).success && parse({ batteryPct: '' }).data?.batteryPct).toBe(
      null,
    );
  });

  it('storageGb tiene que ser mayor a cero', () => {
    expect(parse({ storageGb: '0' }).success).toBe(false);
    expect(parse({ storageGb: '1' }).success).toBe(true);
  });

  it('precio mayor a cero, obligatorio', () => {
    expect(parse({ priceUsd: '0' }).success).toBe(false);
    expect(parse({ priceUsd: '' }).success).toBe(false);
    expect(parse({ priceUsd: '0,01' }).success).toBe(true);
  });

  it('IMEI: 15 dígitos, tolerando espacios y guiones al pegar', () => {
    const ok = parse({ imei: '35 209900-176148 1' });
    expect(ok.success && ok.data.imei).toBe('352099001761481');
    expect(parse({ imei: '35209900176148' }).success).toBe(false);
    expect(parse({ imei: '35209900176148X' }).success).toBe(false);
  });

  /**
   * Luhn **no** bloquea a propósito (ver comentario en `schema.ts`): un IMEI con dígito
   * verificador malo entra igual y se avisa en pantalla. Un alta que rechaza stock es peor.
   */
  it('un IMEI con Luhn inválido igual entra', () => {
    const result = parse({ imei: '352099001761482' });
    expect(result.success && result.data.imei).toBe('352099001761482');
  });
});

describe('catalogModelId', () => {
  /**
   * `checkPublishable` de `@istock/domain` deniega `missing_catalog_model` para todo
   * `kind: 'unit'`. Sin este campo el alta fabrica borradores impublicables — que es exactamente
   * lo que hacía antes de S2 ronda 2.
   */
  it('es obligatorio y tiene forma de uuid', () => {
    expect(parse({ catalogModelId: '' }).success).toBe(false);
    expect(parse({ catalogModelId: 'iphone-14-pro' }).success).toBe(false);
    expect(parse().success).toBe(true);
  });

  it('tolera espacios alrededor al pegar', () => {
    const result = parse({ catalogModelId: `  ${base.catalogModelId}  ` });
    expect(result.success && result.data.catalogModelId).toBe(base.catalogModelId);
  });
});

describe('checkPhotoFile', () => {
  const photo = (size = 1024) => fakeFile('foto.jpg', 'image/jpeg', size);

  it('pide una foto', () => {
    expect(checkPhotoFile(null).ok).toBe(false);
    expect(checkPhotoFile(photo()).ok).toBe(true);
  });

  it('rechaza lo que no sea imagen, y SVG tampoco es imagen acá', () => {
    expect(checkPhotoFile(fakeFile('boleta.pdf', 'application/pdf', 2048)).ok).toBe(false);
    expect(checkPhotoFile(fakeFile('logo.svg', 'image/svg+xml', 2048)).ok).toBe(false);
    expect(checkPhotoFile(fakeFile('foto.heic', 'image/heic', 2048)).ok).toBe(true);
  });

  it('rechaza el archivo pesado antes de leerlo', () => {
    expect(checkPhotoFile(photo(MAX_PHOTO_BYTES + 1)).ok).toBe(false);
    expect(checkPhotoFile(photo(MAX_PHOTO_BYTES)).ok).toBe(true);
  });

  /**
   * El cap nuestro tiene que estar POR DEBAJO del `bodySizeLimit` de Next (3.5 MB) para que el
   * rechazo lo escriba Zod en castellano y no la plataforma con un 413 en inglés. Este test es el
   * que se rompe el día que alguien "recupere" los 8 MB de antes.
   */
  it('el cap deja aire bajo el 413 de Next (3.5 MB) y bajo el proxy (4 MB)', () => {
    expect(MAX_PHOTO_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_PHOTO_BYTES).toBeLessThan(3.5 * 1024 * 1024);
  });
});

describe('photoFromFormData', () => {
  it('ignora el File vacío que manda un input sin elegir nada', () => {
    const formData = new FormData();
    formData.set('photo', fakeFile('', '', 0));
    expect(photoFromFormData(formData)).toBeNull();
  });

  it('devuelve el File real', () => {
    const formData = new FormData();
    formData.set('photo', fakeFile('foto.jpg', 'image/jpeg', 1024));
    expect(photoFromFormData(formData)?.name).toBe('foto.jpg');
  });

  it('no lee `photos` en plural: ese campo murió con el diseño de 8 fotos por submit', () => {
    const formData = new FormData();
    formData.set('photos', fakeFile('foto.jpg', 'image/jpeg', 1024));
    expect(photoFromFormData(formData)).toBeNull();
  });
});
