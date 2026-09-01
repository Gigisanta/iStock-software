'use client';

import { useEffect, useState } from 'react';

const MESSAGES = [
  'Hola, vi el iPhone 14 Pro 256 GB Grafito a USD 620 en tu vidriera y lo quiero.',
  '¿Sigue disponible el iPhone 13 128 GB? Vi que tiene 88% de batería.',
  'Quiero entregar mi iPhone 12 como parte de pago. ¿Cuándo puedo pasar?',
] as const;

type Stage = 'idle' | 'new-message' | 'qualified';

/**
 * Demo de la promesa central de iStock: no simula una integración de WhatsApp ni recibe mensajes.
 * Muestra el texto que el botón `wa.me` prepara para que el vendedor sepa qué consulta va a entrar.
 */
export function WhatsAppFlowPreview() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [stage, setStage] = useState<Stage>('idle');
  const message = MESSAGES[messageIndex] ?? MESSAGES[0];

  useEffect(() => {
    setTypedLength(0);
    const timer = window.setInterval(() => {
      setTypedLength((current: number) => {
        if (current >= message.length) return current;
        return current + 1;
      });
    }, 17);
    return () => window.clearInterval(timer);
  }, [message]);

  const selectMessage = (index: number) => {
    setMessageIndex(index);
    setStage('qualified');
  };

  return (
    <section className="flow-showcase" aria-labelledby="flow-title">
      <div className="flow-copy">
        <p className="flow-eyebrow">WhatsApp, pero con contexto</p>
        <h2 id="flow-title">Antes de abrir el chat, ya sabés qué quiere.</h2>
        <p>
          iStock arma el mensaje con el equipo, capacidad, condición y precio. Eso baja el
          “hola, info” y te deja priorizar venta, consulta y canje desde el primer vistazo.
        </p>

        <div className="flow-toolbar" aria-label="Tipos de consulta de ejemplo">
          {['Compra concreta', 'Consulta de stock', 'Canje'].map((label, index) => (
            <button
              className={messageIndex === index ? 'is-active' : undefined}
              key={label}
              onClick={() => selectMessage(index)}
              type="button"
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>

      </div>

      <div className="phone-stage">
        <button
          aria-expanded={stage !== 'idle'}
          className={`dynamic-island stage-${stage}`}
          onClick={() => setStage(stage === 'idle' ? 'new-message' : 'idle')}
          type="button"
        >
          <span className="island-dot" />
          <span>{stage === 'idle' ? 'Tu vidriera está lista' : 'Mensaje listo para WhatsApp'}</span>
          <span className="island-action">{stage === 'idle' ? 'Tocá' : '×'}</span>
        </button>

        <div className="message-card">
          <div className="message-card-top">
            <span className="wa-mark" aria-hidden="true">◔</span>
            <div>
              <strong>WhatsApp</strong>
              <span>Mensaje que le llega al negocio</span>
            </div>
            <span className="message-tag">{messageIndex === 2 ? 'CANJE' : 'VENTA'}</span>
          </div>
          <div className="message-bubble" aria-hidden="true">
            {message.slice(0, typedLength)}
            <span className="typewriter-caret" aria-hidden="true" />
          </div>
          <p className="sr-only">Mensaje de ejemplo: {message}</p>
          <p className="message-hint">
            {messageIndex === 0
              ? 'Prioridad alta: intención de compra y producto exacto.'
              : messageIndex === 1
                ? 'Filtrá por disponibilidad sin pedir el modelo de nuevo.'
                : 'Derivalo a Canjes: llega con intención y equipo a evaluar.'}
          </p>
        </div>
      </div>

    </section>
  );
}
