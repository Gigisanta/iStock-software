import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { photoGateState } from './photo-gate';

/**
 * **La foto que no se puede achicar no se puede mandar.**
 *
 * El bug que este archivo impide que vuelva: `downscalePhoto()` devolvía `'failed'` —HEIC en todo
 * navegador que no sea Safari, o sea el teléfono con el que el ICP fotografía los iPhones que
 * vende—, `PhotoInput` mostraba el aviso correcto en castellano y **el submit seguía habilitado**.
 * El body se pasaba de `bodySizeLimit` y el que contestaba era Next, con un 413 en inglés, que
 * viola `CLAUDE.md` §0.10.
 *
 * Los dos casos que pide el brief están en el primer `describe`, en ese orden y en el mismo test:
 * el orden **es** la afirmación. Bloquear es fácil; lo difícil es desbloquear, y un formulario que
 * queda trabado para siempre es peor que el 413 que estamos evitando.
 *
 * El segundo `describe` mira el fuente en vez de renderizar, por la misma razón que
 * `(storefront)/error.test.ts`: `apps/web/tsconfig` declara `"jsx": "preserve"` (correcto:
 * transpila Next, no Vitest), así que importar un `.tsx` desde Vitest pediría una
 * `vitest.config.ts` en `apps/web/`, que no es de esta columna. Un veredicto puro y bien testeado
 * que después nadie cablea al `disabled` es exactamente el bug de arriba otra vez, así que el
 * cableado se afirma como se puede afirmar: sobre el texto. El comportamiento en un navegador de
 * verdad lo cubre el e2e de `qa-agent`, que es el único lugar donde probarlo significa algo.
 */

const CAP = 3 * 1024 * 1024;
const MAX_MB = 3;
const gate = (originalBytes: number | null, submittedBytes: number | null) =>
  photoGateState({ originalBytes, submittedBytes, maxBytes: CAP, maxMb: MAX_MB });

const HEIC = 9 * 1024 * 1024;

describe('photoGateState · la compuerta del submit', () => {
  it('foto sobre el cap que no se pudo achicar → BLOQUEADO; después una que entra → DESBLOQUEADO', () => {
    // 1. Entra un HEIC de 9 MB. `downscalePhoto` devolvió 'failed', así que el que quedó en el
    //    input es el original: 9 MB > 3 MB.
    const rechazada = gate(HEIC, HEIC);
    expect(rechazada.blocked).toBe(true);
    expect(rechazada.note).toBe(
      'Esa foto pesa 9,0 MB y no la pudimos achicar acá. Probá con una de menos de 3 MB.',
    );

    // 2. El dueño elige otra, de 1,5 MB. La compuerta se levanta sola: no hay que recargar nada.
    const buena = gate(1_500_000, 1_500_000);
    expect(buena.blocked).toBe(false);
    expect(buena.note).toBe('Lista para subir (1,4 MB).');
  });

  it('la compuerta también se levanta si el dueño cancela y deja el input vacío', () => {
    expect(gate(HEIC, HEIC).blocked).toBe(true);
    expect(gate(null, null)).toEqual({ note: null, blocked: false });
  });

  it('el downscale que SÍ entró no bloquea, y lo dice con los dos tamaños', () => {
    const state = gate(HEIC, 2 * 1024 * 1024);
    expect(state.blocked).toBe(false);
    expect(state.note).toBe('La achicamos de 9,0 MB a 2,0 MB.');
  });

  it('bajo el cap no bloquea, y el borde exacto tampoco: `>` es parte de la regla', () => {
    expect(gate(CAP, CAP).blocked).toBe(false);
    expect(gate(CAP + 1, CAP + 1).blocked).toBe(true);
  });

  /**
   * El navegador sin `DataTransfer` no es un caso aparte del código y no debe serlo del test:
   * `downscalePhoto` pudo achicar, pero el swap no se pudo hacer, así que el que va a viajar sigue
   * siendo el grande. Se bloquea por lo que viaja, no por lo que pasó.
   */
  it('achicó pero no se pudo reemplazar el archivo del input → bloquea igual', () => {
    expect(gate(HEIC, HEIC).blocked).toBe(true);
  });

  it('el aviso es en castellano rioplatense y nunca menciona un 413 ni bytes', () => {
    const note = gate(HEIC, HEIC).note ?? '';
    expect(note).toMatch(/Probá/u);
    expect(note).not.toMatch(/413|Body exceeded|limit/iu);
  });
});

const readSrc = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), 'utf8');

describe('el veredicto está cableado al submit de los dos forms', () => {
  it('PhotoInput avisa hacia arriba con `onBlockedChange`, aparte de `onBusyChange`', () => {
    const src = readSrc('./photo-input.tsx');
    expect(src).toMatch(/onBlockedChange\?\.\(/u);
    // La compuerta NO es `busy`: un archivo rechazado no está ocupado y `aria-busy` mentiría.
    expect(src).toMatch(/aria-busy=\{busy\}/u);
  });

  it.each([
    ['../[id]/fotos/agregar-foto-form.tsx'],
    ['../nuevo/nueva-unidad-form.tsx'],
  ])('%s suma photoBlocked al disabled del submit', (file) => {
    const src = readSrc(file);
    expect(src).toMatch(/onBlockedChange=\{setPhotoBlocked\}/u);
    expect(src).toMatch(/disabled=\{isPending \|\| photoBusy \|\| photoBlocked\}/u);
  });
});
