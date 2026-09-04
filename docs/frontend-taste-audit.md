# Frontend taste audit

Estado: aplicado en el frontend actual.

## Lectura de diseño

iStock es un SaaS B2B local con dos momentos distintos:

- marketing y vidriera pública: una experiencia comercial, clara y orientada a una conversación por WhatsApp;
- panel y billing: una herramienta operativa para usar con una mano mientras el negocio sigue funcionando.

La dirección elegida es mineral y editorial: papel frío, tinta profunda, blanco y grises neutros, y superficies planas con profundidad leve. No se agregan gradientes decorativos, métricas inventadas, screenshots falsos ni una segunda marca.

La referencia visual revisada fue [Onorca](https://www.onorca.dev/): hero de promesa corta, navegación
por tabs para recorrer capacidades, escenario oscuro para demostrar el producto, bloques de prueba
con jerarquía editorial y motion discreto. Se tomó el patrón de interacción y ritmo, no sus assets,
copy ni identidad.

## Diales

- Marketing y vidriera: DESIGN_VARIANCE 7, MOTION_INTENSITY 5, VISUAL_DENSITY 4.
- Panel y billing: DESIGN_VARIANCE 4, MOTION_INTENSITY 3, VISUAL_DENSITY 7.

El panel conserva una densidad más alta porque la skill de taste no reemplaza los patrones de dashboard; sí fija jerarquía, consistencia, accesibilidad y estados.

## Cambios aplicados

- Tokens globales para color, superficie, borde, sombra, radio, tipografía y foco visible en apps/web/app/globals.css.
- Lockup SVG local de la identidad en apps/web/public/brand/logo-horizontal.svg y apps/web/public/brand/mark.svg.
- Marketing con hero asimétrico, prueba de flujo reutilizando el copy existente, workflow de tres pasos y alcance editorial.
- El titular del hero mantiene como máximo dos líneas en desktop; Playwright lo mide sobre un viewport
  de 1440 px para que el impacto visual no termine en una columna accidentalmente alta.
- Showcase interactivo inspirado en ese recorrido: tabs accesibles, panel oscuro de producto, entrada
  suave al cambiar de escena y soporte para teclado/reduced motion.
- El escenario suma chrome de ventana neutral, estado de preview y resultado de ficha listo para
  publicar; la banda horizontal repite sólo beneficios verificables (trial sin tarjeta, selección
  de modelo/GB/color, link público y WhatsApp con contexto) y se pausa al recibir foco o hover.
- Las secciones de la landing suman un reveal progresivo guiado por `animation-timeline: view()` cuando
  el navegador lo soporta; el fallback de carga sigue funcionando y `prefers-reduced-motion` lo apaga.
- El contrato de navegador `e2e/s0-marketing-landing.spec.ts` cubre la interacción real del showcase
  y la continuidad de los CTA; el efecto sólo acompaña el cambio de contenido y no es requisito para
  leer ni convertir.
- Pricing con prueba en banda ancha y comparación concentrada de los dos planes pagos; Base queda como la acción principal.
- Vidriera con cards que reservan el estado debajo de la foto, grilla responsive y ficha de producto con composición media + información.
- Las cards de la vidriera responden con un lift y un zoom de imagen muy sutil sólo en dispositivos
  con hover; el foco de teclado y `prefers-reduced-motion` conservan una respuesta segura.
- La preview de marketing ya no dibuja un producto ficticio: reutiliza una captura recortada de la
  grilla real de demo, mientras que el tab de Stock ejecuta selects modelo → capacidad → color.
- Ficha técnica en una matriz de datos, sin una pared de separadores; pickup y medios de pago siguen el mismo lenguaje.
- Panel con header y navegación inferior consistentes, tarjetas de trabajo, estados vacíos honestos, inputs y acciones uniformes.
- La paleta de producto quedó realmente monocromática: los estados operativos usan grises y los
  colores quedan reservados para errores y advertencias; un test recursivo evita que regresen
  utilidades verdes o azules en la UI de producción.
- Los headers sticky usan superficies sólidas, sin `backdrop-filter` ni glassmorphism; el movimiento
  queda reservado a entradas, lifts y cambios de escena que aportan orientación.
- Los CTA públicos de WhatsApp quedaron en copy corto y directo (`Lo quiero por WhatsApp` / `Lo
  quiero igual por WhatsApp`); el contrato del badge evita rayas tipográficas largas en el texto que
  se lee en mobile.
- Cuenta y billing con superficies de foco, formularios de lectura clara y acciones primarias consistentes.
- Entrada sutil sólo cuando respeta prefers-reduced-motion; no hay listeners de scroll ni animación necesaria para entender el contenido.

## Contratos preservados

- Rutas, redirects, labels de navegación, nombres y orden de campos, data-testid, data-storefront, data-listing, data-wa y contratos de Server Action.
- Un único wa.me por ficha pública.
- No se agregó IMEI, costo, margen ni notas internas a la vidriera.
- Se mantiene img para fotos R2; no se incorporó next/image.
- No se alteró el comportamiento de `apps/web/app/layout.tsx`, `proxy.ts`, los loaders, la cache ni
  las acciones; `proxy.ts` sólo recibió una aclaración documental sobre el parser del matcher.
- Los separadores largos en metadata visible de frontend se normalizaron a separadores simples; el
  copy de producto real se mantiene intacto y el fixture demo evita puntuación ornamental.

## Aceptación

~~~text
pnpm --filter @istock/web typecheck
pnpm --filter @istock/web lint
pnpm --filter @istock/web test
pnpm --filter @istock/e2e typecheck
E2E_PORT=3145 pnpm e2e
git diff --check
~~~

Costo delta: una carga local de dos SVG de marca, CSS estático y un componente cliente mínimo para
las tres tabs; no hay dependencia nueva, consulta adicional, transformación de imagen ni token de
runtime.
