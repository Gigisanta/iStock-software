'use client';

import { useState } from 'react';

interface SubscriptionSubmitButtonProps {
  readonly disabled?: boolean;
  readonly label: string;
  readonly pendingLabel?: string;
  readonly className?: string;
}

/**
 * Submit del checkout hosteado.
 *
 * El POST sigue siendo un formulario HTML normal: este componente sólo agrega feedback inmediato
 * y evita dos envíos desde la misma pestaña mientras el navegador navega a Mercado Pago. No es
 * una garantía de idempotencia entre pestañas; el handler server-side sigue siendo la autoridad.
 */
export function SubscriptionSubmitButton({
  disabled = false,
  label,
  pendingLabel = 'Conectando…',
  className = '',
}: SubscriptionSubmitButtonProps) {
  const [submitted, setSubmitted] = useState(false);
  const isDisabled = disabled || submitted;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-busy={submitted}
      onClick={() => setSubmitted(true)}
      className={`min-h-[52px] rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 ${className}`}
    >
      {submitted ? pendingLabel : label}
    </button>
  );
}
