/**
 * Estado de `addPhotoAction`. Aparte porque un archivo `'use server'` sólo exporta funciones async.
 *
 * No hay campo para "la foto elegida": ningún navegador deja repoblar un `<input type="file">`.
 * Cuando falla, hay que volver a elegirla y la pantalla lo dice.
 */
export interface PhotoActionState {
  readonly error: string | null;
}

export const initialPhotoActionState: PhotoActionState = { error: null };
