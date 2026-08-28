import { describe, expect, it } from 'vitest';
import { DOWNSCALE_MAX_EDGE, downscalePhoto } from './downscale-photo';

/**
 * Este archivo prueba **una** cosa, y es la que no se puede aflojar: bajo el cap no se toca el
 * archivo.
 *
 * El criterio de aceptación de S2 mide bytes de salida del pipeline. Si el navegador re-encodeara
 * siempre, el gate estaría midiendo a Chrome y una degradación de `packages/media` pasaría
 * desapercibida. Por eso `'untouched'` es un valor del tipo y no un detalle de implementación:
 * está para que este test exista.
 *
 * El camino de canvas no se prueba acá: vitest corre en Node y `createImageBitmap` no existe. Eso
 * no es una deuda escondida — se verifica en el e2e de `qa-agent`, que corre en un navegador de
 * verdad, que es el único lugar donde probarlo significa algo.
 */

const fakeFile = (size: number, type = 'image/jpeg'): File =>
  Object.defineProperty(new File([], 'foto.jpg', { type }), 'size', { value: size });

const CAP = 3 * 1024 * 1024;

describe('downscalePhoto', () => {
  it('NO toca un archivo que ya está bajo el cap', async () => {
    await expect(downscalePhoto(fakeFile(CAP - 1), CAP)).resolves.toEqual({ kind: 'untouched' });
    await expect(downscalePhoto(fakeFile(1024), CAP)).resolves.toEqual({ kind: 'untouched' });
  });

  it('el borde exacto tampoco se toca: `<=` es parte de la regla', async () => {
    await expect(downscalePhoto(fakeFile(CAP), CAP)).resolves.toEqual({ kind: 'untouched' });
  });

  it('sin canvas (Node, o un navegador sin soporte) degrada a `failed`, nunca tira', async () => {
    await expect(downscalePhoto(fakeFile(CAP + 1), CAP)).resolves.toEqual({ kind: 'failed' });
  });

  it('el lado mayor de salida es el mismo que MAX_OUTPUT_EDGE del pipeline', () => {
    expect(DOWNSCALE_MAX_EDGE).toBe(1600);
  });
});
