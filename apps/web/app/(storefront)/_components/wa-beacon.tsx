/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El beacon del click de WhatsApp. **No es un Client Component, y no por gusto.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Registra el click en el botón de la ficha: un `POST` a `/api/track` que termina en una fila de
 * `wa_click_events`. Es telemetría, y la regla que ordena todo lo demás es que **la telemetría no
 * puede ponerse adelante de la venta**: el `<a>` sigue siendo el `wa.me` real, la navegación no
 * espera nada y acá no hay —ni puede haber— una sola línea que cancele el click. El gate del LEAD
 * lo verifica sobre TODO `_components/**` incluidos los comentarios, así que ni siquiera se nombra
 * la función que lo haría: la regla no se puede cumplir "casi".
 *
 * ── Por qué un `<script>` en línea y no un Client Component ───────────────────────────────────
 * La recomendación era un componente cliente chico que enganchara el click de forma delegada. No
 * se puede, y el que lo impide es el propio repo: **la regla W001 de `apps/web/scripts/web-lint.mjs`
 * prohíbe `"use client"` en todo `(storefront)`** salvo el error boundary, que está exento por
 * nombre de archivo. O sea que un componente cliente acá no compila el lint, y `web-lint.mjs` es
 * del LEAD: no es un archivo que esta columna pueda tocar para hacerse lugar.
 *
 * Resulta que la restricción empuja a la solución más barata, así que se documenta como decisión y
 * no como rodeo:
 *
 * | | Client Component | este `<script>` |
 * |---|---|---|
 * | JS embarcado | el componente + su entrada al bundle + su payload de Flight | ~0,4 KB inline |
 * | cuándo engancha el click | recién cuando **hidrata** | al parsear, antes de la primera foto |
 * | qué pasa con 4G malo | el click temprano no se registra | se registra igual |
 *
 * El tercer renglón es el que decide: el caso de uso es una persona parada en la calle que abre el
 * link de un estado y aprieta el botón enseguida. Un listener que depende de la hidratación pierde
 * exactamente los clicks más impacientes, que son los más calientes.
 *
 * ── Por qué `dangerouslySetInnerHTML` con una constante ───────────────────────────────────────
 * Es la única forma soportada de emitir un `<script>` en línea: React **escapa** los hijos de
 * texto (`"` pasaría a `&quot;`) y rompería el JS. La excepción está acotada igual que la de W001
 * con el error boundary — por nombre de archivo, y con un test que verifica que la excepción no es
 * una puerta: `beacon.test.ts` exige que lo inyectado sea esta constante de módulo, sin una sola
 * interpolación, y que este componente **no reciba props**. No hay dato del dueño ni del visitante
 * que pueda llegar a esta cadena: no entra ninguno.
 *
 * ── Lo que el script NO hace ──────────────────────────────────────────────────────────────────
 * - **No dispara en el `view`.** Si contara pageviews, `allowed requests ≈ pageviews` (el renglón
 *   fijo del WAF se volvería proporcional al tráfico) y la tabla dejaría de medir intención de
 *   compra: cuánta gente **miró** ya lo cuenta PostHog, esta tabla existe para contar cuánta
 *   **apretó**.
 * - **No usa `fetch`.** El browser cancela un `fetch` en vuelo cuando la pestaña navega afuera, y
 *   navegar afuera es literalmente lo que hace este click. `navigator.sendBeacon` existe para esto:
 *   encola en el browser y sobrevive a la navegación.
 * - **No manda nada del visitante.** El cuerpo son dos campos: qué ficha y de dónde salió el
 *   click. El tenant no viaja: lo pone el servidor desde el host (ver el handler).
 */

/**
 * Delegado sobre `document` en fase de captura, para que ningún handler intermedio pueda dejarlo
 * sin efecto, y con guarda de instalación única: si el componente se rindiera dos veces, dos
 * listeners serían **dos filas por un click** y la tabla contaría el doble de intenciones.
 *
 * `id` ausente ⇒ no se manda nada. Un click en la ficha sin la unidad que lo generó sería una fila
 * que no le sirve a nadie: el valor entero de la tabla es que el dueño sepa **qué equipo** le
 * generó la conversación.
 */
const WA_BEACON_SCRIPT = `(function(){
if(window.__waBeacon)return;
window.__waBeacon=1;
document.addEventListener('click',function(e){
var t=e.target;
if(!t||!t.closest)return;
var a=t.closest('a[data-wa="listing"]');
if(!a)return;
var id=a.getAttribute('data-wa-listing');
if(!id||!navigator.sendBeacon)return;
navigator.sendBeacon('/api/track',JSON.stringify({listingId:id,source:'storefront_detail'}));
},true);
})();`;

export function WaClickBeacon() {
  return <script dangerouslySetInnerHTML={{ __html: WA_BEACON_SCRIPT }} />;
}
