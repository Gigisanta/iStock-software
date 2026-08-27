import { describe, expect, it } from 'vitest';

import {
  PRERENDER_SEED_SLUG,
  RESERVED_SLUGS,
  RESERVED_SUBDOMAINS,
  TENANT_SERVED_RESERVED_SLUGS,
  isReservedSlug,
  isReservedSubdomain,
} from './reserved-slugs';
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_PATTERN, normalizeSlug } from './slug';

describe('la lista canónica cubre las familias que la hacen útil', () => {
  it('reserva la infraestructura que ya vive o va a vivir en *.maat.work', () => {
    for (const name of ['www', 'api', 'cdn', 'mail', 'smtp', 'ns1', 'ns2', 'dns', 'static', 'assets']) {
      expect(isReservedSlug(name), name).toBe(true);
    }
  });

  it('reserva las rutas del producto, que colisionan con el apex y no con el subdominio', () => {
    for (const name of ['app', 'api', 'precios', 'ingresar', 'stock', 'ajustes', 'canjes', 'demo']) {
      expect(isReservedSlug(name), name).toBe(true);
    }
  });

  it('reserva la superficie de phishing contra nuestros propios dueños de negocio', () => {
    // Es la familia que se olvida siempre: `pagos.maat.work` con un formulario de login ajeno
    // es indistinguible de nosotros para el dueño de un local de Cipolletti.
    for (const name of ['login', 'signin', 'auth', 'cuenta', 'password', 'seguridad', 'soporte',
      'billing', 'pagos', 'checkout', 'factura', 'webhook']) {
      expect(isReservedSlug(name), name).toBe(true);
    }
  });

  it('reserva nuestra marca y la de los proveedores, para que nadie se haga pasar por nosotros', () => {
    for (const name of ['maat', 'maatwork', 'istock', 'vercel', 'supabase', 'mercadopago']) {
      expect(isReservedSlug(name), name).toBe(true);
    }
  });

  it('tiene tamaño suficiente para no ser una lista de juguete', () => {
    expect(RESERVED_SLUGS.size).toBeGreaterThanOrEqual(50);
  });

  it('un nombre común de negocio del Alto Valle no queda atrapado por la lista', () => {
    // Una lista de reservados que se pasa de larga bloquea clientes reales y nadie se entera:
    // el dueño prueba un nombre, dice "reservado", y se va.
    for (const name of ['nortecel', 'cipocel', 'neuquen-cel', 'iphonesur', 'valle-mobile']) {
      expect(isReservedSlug(name), name).toBe(false);
    }
  });
});

describe('cada entrada de la lista es un slug que la DB podría haber aceptado', () => {
  it('todas son minúsculas, sin espacios ni puntos, dentro del largo máximo', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slug, slug).toBe(slug.toLowerCase());
      expect(slug.length, slug).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      expect(/^[a-z0-9-]+$/u.test(slug), slug).toBe(true);
    }
  });

  it('las que llegan al largo mínimo tienen forma de slug registrable', () => {
    // Las de 1–2 caracteres (`s`, `p`, `mp`) las rechaza el largo mínimo: están en la lista como
    // intención declarada, no porque hagan falta. Las demás tienen que ser slugs de verdad, o
    // estarían "reservando" algo que nadie podría haber escrito.
    const registrables = [...RESERVED_SLUGS].filter((slug) => slug.length >= SLUG_MIN_LENGTH);
    expect(registrables.length).toBeGreaterThan(50);
    for (const slug of registrables) {
      expect(SLUG_PATTERN.test(slug), slug).toBe(true);
    }
  });

  it('ninguna entrada necesita normalizarse: la lista ya está en forma canónica', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(normalizeSlug(slug), slug).toBe(slug);
    }
  });
});

describe('las dos caras de la lista no pueden divergir', () => {
  it('todo subdominio que va a marketing es imposible de registrar', () => {
    // Esta es LA invariante. Si se rompe, hay alguien pagando un plan cuyo link nunca muestra
    // su negocio: no falla nada, no hay error, aparece con el primer cliente.
    const huerfanos = [...RESERVED_SUBDOMAINS].filter((label) => !RESERVED_SLUGS.has(label));
    expect(huerfanos).toEqual([]);
  });

  it('la única diferencia entre las dos caras es la excepción declarada', () => {
    const diferencia = [...RESERVED_SLUGS].filter((slug) => !RESERVED_SUBDOMAINS.has(slug));
    expect(new Set(diferencia)).toEqual(new Set(TENANT_SERVED_RESERVED_SLUGS));
  });

  it('`demo` es irregistrable y aun así sirve su propia vidriera', () => {
    // La única asimetría legítima (S13). Una unificación ingenua de las dos listas la rompe en
    // silencio: o el demo se queda sin vidriera, o el nombre `demo` queda libre para cualquiera.
    expect(isReservedSlug('demo')).toBe(true);
    expect(isReservedSubdomain('demo')).toBe(false);
  });

  it('el slug semilla del prerender no lo puede registrar nadie y nunca es una vidriera', () => {
    // `PRERENDER_SEED_SLUG` es la entrada estática que genera el build de `/s/[slug]`. Quien lo
    // registrara se quedaría con esa entrada. Es la divergencia real que había entre las dos
    // listas antes de unificarlas.
    expect(isReservedSlug(PRERENDER_SEED_SLUG)).toBe(true);
    expect(isReservedSubdomain(PRERENDER_SEED_SLUG)).toBe(true);
    expect(SLUG_PATTERN.test(PRERENDER_SEED_SLUG)).toBe(true);
  });

  it('la excepción con vidriera propia también está en la lista canónica', () => {
    for (const slug of TENANT_SERVED_RESERVED_SLUGS) {
      expect(RESERVED_SLUGS.has(slug), slug).toBe(true);
    }
  });
});

describe('las consultas responden sobre el slug ya normalizado, nunca sobre el crudo', () => {
  it('un nombre que no está en la lista no se reserva por parecido', () => {
    expect(isReservedSlug('www2')).toBe(false);
    expect(isReservedSubdomain('appstore')).toBe(false);
  });

  it('`WWW` no se filtra: normalizar va antes de preguntar, no después', () => {
    // Documenta el contrato del borde. `isReservedSlug` no normaliza a propósito: si normalizara
    // acá, el valor que termina en la base seguiría siendo el crudo.
    expect(isReservedSlug('WWW')).toBe(false);
    expect(isReservedSlug(normalizeSlug('  WWW  '))).toBe(true);
  });
});
