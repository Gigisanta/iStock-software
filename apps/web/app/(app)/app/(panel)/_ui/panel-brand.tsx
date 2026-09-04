import Link from 'next/link';

export function PanelBrand({ variant }: { readonly variant: 'compact' | 'full' }) {
  const compact = variant === 'compact';

  return (
    <Link
      href="/app"
      aria-label="iStock · Ir al inicio"
      className={`panel-brand ${compact ? 'panel-brand-compact' : 'panel-brand-full'}`}
    >
      <img
        src={compact ? '/brand/mark.svg' : '/brand/logo-horizontal.svg'}
        alt={compact ? '' : 'iStock'}
        aria-hidden={compact ? true : undefined}
        width={compact ? 32 : 144}
        height={compact ? 32 : 29}
      />
      {compact ? <span aria-hidden="true">iStock</span> : null}
    </Link>
  );
}
