/** Título canónico de una unidad: el dueño elige variantes y no tiene que redactarlo. */
export function buildUnitTitle(
  displayName: string,
  storageGb: number | null,
  color: string | null,
): string {
  return [
    displayName.trim(),
    storageGb === null ? null : String(storageGb),
    color?.trim() === '' ? null : color?.trim() ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
    .replace(/\s+/gu, ' ');
}
