/** Estado de `updateListingPriceAction`. */
export interface PriceActionState {
  readonly error: string | null;
}

export const initialPriceActionState: PriceActionState = { error: null };
