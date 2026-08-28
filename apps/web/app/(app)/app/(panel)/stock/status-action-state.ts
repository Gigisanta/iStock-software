/** Estado de `setListingStatusAction`. Aparte porque un `'use server'` sólo exporta funciones. */
export interface StatusActionState {
  readonly error: string | null;
}

export const initialStatusActionState: StatusActionState = { error: null };
