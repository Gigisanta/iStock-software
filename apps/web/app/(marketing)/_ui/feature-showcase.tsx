'use client';

import { useState } from 'react';

const FEATURES = [
  {
    id: 'stock',
    label: 'Stock',
    eyebrow: 'Carga rápida',
    title: 'Cargá cada equipo una sola vez.',
    body: 'Modelo, capacidad, color, condición y precio. El nombre se arma solo para que no pierdas tiempo escribiendo.',
  },
  {
    id: 'storefront',
    label: 'Vidriera',
    eyebrow: 'Publicación clara',
    title: 'Una vidriera que se entiende de un vistazo.',
    body: 'Fotos reales, información completa y un link simple para compartir en tu estado o en tu bio.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    eyebrow: 'Consulta lista',
    title: 'La conversación empieza con contexto.',
    body: 'El cliente llega con el equipo y el precio ya escritos. Vos recibís una consulta concreta, no un “¿info?”.',
  },
] as const;

type FeatureId = (typeof FEATURES)[number]['id'];

const PREVIEW_MODELS = [
  {
    id: 'iphone-14-pro',
    label: 'iPhone 14 Pro',
    storage: ['128 GB', '256 GB', '512 GB'],
    colors: ['Grafito', 'Plata', 'Oro'],
  },
  {
    id: 'iphone-15',
    label: 'iPhone 15',
    storage: ['128 GB', '256 GB'],
    colors: ['Negro', 'Azul', 'Rosa'],
  },
] as const;

type PreviewModelId = (typeof PREVIEW_MODELS)[number]['id'];

export function FeatureShowcase() {
  const [activeId, setActiveId] = useState<FeatureId>('stock');
  const active = FEATURES.find((feature) => feature.id === activeId) ?? FEATURES[0];

  return (
    <section className="marketing-showcase" aria-labelledby="showcase-title">
      <div className="marketing-showcase-copy">
        <p className="marketing-kicker">El recorrido completo</p>
        <h2 id="showcase-title">Del mostrador al WhatsApp.</h2>
        <p>
          Tres momentos simples para que tu stock deje de vivir en una planilla y empiece a trabajar
          por vos.
        </p>

        <div
          className="marketing-showcase-tabs"
          role="tablist"
          aria-label="Cómo funciona iStock"
          aria-orientation="horizontal"
        >
          {FEATURES.map((feature, index) => {
            const selected = feature.id === activeId;
            const tabId = `showcase-tab-${feature.id}`;
            const panelId = `showcase-panel-${feature.id}`;
            return (
              <button
                key={feature.id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className="marketing-showcase-tab"
                onClick={() => setActiveId(feature.id)}
                onKeyDown={(event) => {
                  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
                    return;
                  }

                  event.preventDefault();
                  const move = event.key === 'ArrowRight' ? 1 : -1;
                  const nextIndex =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? FEATURES.length - 1
                        : (index + move + FEATURES.length) % FEATURES.length;
                  const nextFeature = FEATURES[nextIndex];
                  if (!nextFeature) return;

                  setActiveId(nextFeature.id);
                  document.getElementById(`showcase-tab-${nextFeature.id}`)?.focus();
                }}
              >
                {feature.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="marketing-showcase-stage">
        <div className="showcase-browserbar" aria-hidden="true">
          <span className="showcase-browser-controls">
            <span className="showcase-browser-dot" />
            <span className="showcase-browser-dot" />
            <span className="showcase-browser-dot" />
          </span>
          <span className="showcase-browser-url">nortecel.maat.work</span>
          <span className="showcase-stage-status">
            <span className="showcase-status-dot" />
            Vista previa
          </span>
        </div>

        <div
          key={active.id}
          id={`showcase-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`showcase-tab-${active.id}`}
          className={`marketing-showcase-panel marketing-showcase-panel--${active.id}`}
        >
          <div className="showcase-panel-heading">
            <div>
              <p>{active.eyebrow}</p>
              <h3>{active.title}</h3>
            </div>
          </div>
          <p className="showcase-panel-body">{active.body}</p>
          <ShowcaseContent feature={active.id} />
        </div>
      </div>
    </section>
  );
}

function ShowcaseContent({ feature }: { readonly feature: FeatureId }) {
  if (feature === 'storefront') {
    return (
      <figure className="showcase-storefront-preview">
        <img
          src="/marketing/storefront-preview.png"
          alt="Vista real de una grilla de equipos publicados"
          width="896"
          height="390"
          loading="lazy"
          decoding="async"
        />
      </figure>
    );
  }

  if (feature === 'whatsapp') {
    return (
      <div className="showcase-message">
        <p className="showcase-message-meta">Mensaje listo para enviar</p>
        <blockquote>
          Hola, vi el iPhone 14 Pro 256 en tu vidriera y lo quiero.
        </blockquote>
        <span className="showcase-message-note">El cliente llega con el contexto puesto.</span>
      </div>
    );
  }

  return (
    <StockConfiguratorPreview />
  );
}

function StockConfiguratorPreview() {
  const [modelId, setModelId] = useState<PreviewModelId>('iphone-14-pro');
  const [storage, setStorage] = useState('256 GB');
  const [color, setColor] = useState('Grafito');
  const model = PREVIEW_MODELS.find((candidate) => candidate.id === modelId) ?? PREVIEW_MODELS[0];

  return (
    <form className="showcase-configurator" aria-label="Demostración del alta de un equipo">
      <div className="showcase-configurator-fields">
        <label>
          <span>Modelo</span>
          <select
            data-testid="showcase-model-select"
            value={modelId}
            onChange={(event) => {
              const next = PREVIEW_MODELS.find((candidate) => candidate.id === event.target.value);
              if (!next) return;
              setModelId(next.id);
              setStorage(next.storage[0]);
              setColor(next.colors[0]);
            }}
          >
            {PREVIEW_MODELS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Capacidad</span>
          <select value={storage} onChange={(event) => setStorage(event.target.value)}>
            {model.storage.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Color</span>
          <select value={color} onChange={(event) => setColor(event.target.value)}>
            {model.colors.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <output className="showcase-configurator-result" aria-live="polite">
        <strong>{`${model.label} ${storage} ${color}`}</strong>
        <span>El título aparece solo.</span>
        <span className="showcase-configurator-status">
          <span className="showcase-status-dot" aria-hidden="true" />
          Ficha lista para publicar
        </span>
      </output>
    </form>
  );
}
