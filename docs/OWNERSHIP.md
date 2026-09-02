> Sección §4 del contrato. Lo mantiene el **LEAD**; nadie más escribe acá. `AGENTS.md` §4 lo
> referencia y esta tabla **manda** sobre cualquier `.claude/agents/*.md` que discrepe.
> Extraído sin cambios de la ex-`CLAUDE.md` el 2026-09-01; las citas "§2", "§3", "§4" apuntan a
> `AGENTS.md`.

# File ownership — un writer por directorio

| Path | Owner | Nadie más escribe acá |
|---|---|---|
| `packages/db/**` | `db-agent` | ✅ |
| `packages/domain/**` | `domain-agent` | ✅ |
| `packages/media/**` | `media-agent` | ✅ |
| `packages/ai/**` | `ai-agent` | ✅ |
| `apps/web/app/(app)/**`, `apps/web/app/api/**` | `app-agent` | ✅ |
| `apps/web/app/(storefront)/**`, `proxy.ts` | `storefront-agent` | ✅ |
| `apps/web/app/(billing)/**`, webhooks MP | `billing-agent` | ✅ |
| `tests/**`, `e2e/**` | `qa-agent` | ✅ |
| `packages/*/src/**/*.test.ts` (unit del propio paquete) | el owner del paquete | ✅ |
| `docs/**` (excepto `docs/research/**`) | `docs-keeper` | ✅ |
| `docs/research/**` | `researcher` (uno por topic-file) | ✅ |
| `docs/COST.md` | `cost-auditor` | ✅ |
| `AGENTS.md` (y su symlink `CLAUDE.md`), `docs/OWNERSHIP.md`, `.claude/**`, `.agents/skills/istock-roles/**` | **LEAD** | ✅ |
| `scripts/**`, `vercel.json`, **todo script que un `package.json` corra como `lint`/`guard`/`check`/`verify`/`audit`** (hoy seis: los cinco `*-lint.mjs` más `packages/domain/scripts/purity-check.mjs`) | **LEAD** | ✅ |
| `config/**` (reglas de WAF y demás config de plataforma) | **LEAD** | ✅ |
| `apps/web/instrumentation.ts` | `app-agent` | ✅ |
| `apps/web/next.config.ts`, `apps/web/app/layout.tsx` | **LEAD** | ✅ |

Conflicto de ownership = el LEAD reasigna. Un agente **nunca** edita fuera de su columna.

**Agregado por el LEAD en FASE 4** (hueco real, lo encontró `docs-keeper` al no poder asignar dueño a
dos entradas del board): los **gates no tienen dueño en la tabla y por lo tanto no los tenía nadie**.
`scripts/accept-*.sh`, `scripts/guard-*.sh`, `scripts/probes/**`, las reglas de lint de
`apps/web/scripts/` y `vercel.json` son del LEAD, por un motivo que no
es jerárquico sino de independencia: **el gate no puede ser del mismo writer que el código que
audita.** Por la misma regla, **`config/firewall-rules.json` es del LEAD** (fila nueva, FASE 4):
las reglas de rate limit deciden qué endpoints de `app-agent` y de `storefront-agent` tienen techo,
así que no pueden ser de ninguno de los dos.

**Generalizado a los lints de paquete, LEAD, 2026-08-28, y lo pidió el agente auditado.** La fila
decía `apps/web/scripts/*-lint.mjs`, o sea nombraba **un** lint en vez de la clase, y por ese hueco
`packages/db/scripts/rls-lint.mjs` —el gate que sostiene *"sin RLS no hay merge"*— quedaba adentro
de `packages/db/**`, o sea del mismo writer cuyas policies audita. No es teoría: en esta misma
slice `db-agent` **le agregó una sección** (3b, `ALTER POLICY`) y lo reportó preguntando si le
correspondía. Le correspondía preguntar, y la respuesta es no. **Todo `*-lint.mjs`, viva donde
viva, es del LEAD**, por la misma razón que `scripts/probes/**`: el gate no puede ser del writer
que audita.

El agujero que destapó vale escribirlo porque explica el costo de haberlo tenido: `rls-lint.mjs`
leía sólo `CREATE POLICY`, y `0006` trajo el **primer `ALTER POLICY` del repo**. Medido por el LEAD
sobre el archivo real: con `ALTER POLICY … WITH CHECK (true)` agregado a `0006`, la versión vieja
imprimía `rls-lint OK · 74 policies` y salía **0** — la regla `0007`, la que este archivo nombra
como fallo, tenía una puerta al lado sin cerrar. Con 3b: `exit=1` y
`0007 reservations.reservations_tenant_insert (ALTER) deja WITH CHECK (true)`. Detalle a no
"arreglar": 3b **no** exige `WITH CHECK` en un `ALTER`, porque en Postgres la cláusula omitida
queda como estaba y pedirla sería falso positivo.

El precio del corte está aceptado: `db-agent` escribe policies todo el tiempo y ya no puede
ampliar el lint que las mira. **Pide, no edita** — igual que con los techos del WAF. Un lint que
crece de la mano del código que audita es un lint que nunca lo va a contradecir.

**Y la regla se dejó de apoyar en el nombre del archivo, LEAD, 2026-08-28.** Censé la clase que
ADR-022 dice cubrir y resultó que no la cubre. `find . -name '*-lint.mjs'` devuelve **cinco**
archivos, pero el `lint` de `packages/domain` es **`scripts/purity-check.mjs`**: no termina en
`-lint.mjs`, así que la regla anterior **no lo alcanzaba**, y quedó adentro de `packages/domain/**`
— o sea de `domain-agent`, el writer cuya pureza audita. Es el mismo agujero que ADR-022 vino a
tapar, reabierto un nivel más arriba: **una regla que nombra un sufijo en vez de la clase falla
igual que la que nombraba un archivo.**

**La regla vigente no mira cómo se llama el archivo, mira qué hace:** es del LEAD **todo script que
un `package.json` del repo corra como `lint`, `guard`, `check`, `verify` o `audit`**, además de
`scripts/**` y `scripts/probes/**`. La definición es **censable en un comando**, y ese es el punto:
enumerar los `package.json` da la lista sin que nadie tenga que acordarse de ella. Hoy son seis
— `web-lint.mjs`, `rls-lint.mjs`, `ai-lint.mjs`, `media-lint.mjs`, `qa-lint.mjs`, `purity-check.mjs`.

**No se mudan a `scripts/`, y la alternativa se evaluó.** Mover los seis es editar seis
`package.json` en cinco columnas ajenas y reescribir la resolución de paths de cada uno, todo para
arreglar un problema de **rótulo**. Y no lo arreglaría: `purity-check.mjs` muestra que el fallo no
es *dónde vive el archivo* sino *cómo la regla identifica a su sujeto*. Una regla apoyada en la
ubicación tendría el mismo hueco de sufijo el día que alguien ponga un gate en otro lado. Se quedan
donde están; lo que cambia es que la definición ahora se puede correr.

**Corolario, y es el que hace la diferencia:** esto no puede depender de que un agente haya leído
este párrafo. Va a `guard-gates.sh` — censar los `package.json`, resolver el target de cada script
de gate, y exigir que el archivo declare al LEAD como owner. Un gate nuevo escrito por el writer que
audita tiene que romper **el día que nace**, no la vez que a alguien se le ocurra censar. Fila
**`T28`** del board.

**Y el mismo defecto, un nivel más arriba: la EJECUCIÓN de un gate también se censa. LEAD,
2026-08-28.** `ci.yml` tiene cuatro comentarios distintos contando la misma historia con distinto
nombre — `guard-routes`, `guard-grants`, `accept-fase2` y `accept-fase3` se escribieron, quedaron
afuera del workflow, y estuvieron rojos o vacuamente verdes sin que nadie se enterara;
`accept-fase2` llevaba semanas. Cada vez lo encontró un humano mirando, y cada vez se arregló
agregando **ese** archivo. Cuatro instancias arregladas de a una es la firma de una clase sin gate,
y es literalmente T28 corrido un escalón: allá el *dueño* de un gate se recordaba en vez de
censarse, acá se recuerda la *corrida*.

**Sección `G4` de `guard-gates.sh`:** todo `scripts/accept-*.sh`, `scripts/guard-*.sh` y
`scripts/*.test.sh` tiene que estar **nombrado en `.github/workflows/ci.yml`**, o declarar
`ci-exento: <motivo>` de 30+ caracteres en sus primeras 40 líneas — mismo idioma que
`web-lint:sin-tenant`, y por la misma razón: la alternativa a una exención escrita no es "sin
exención", es la exención invisible, que es exactamente lo que esas cuatro veces fueron. `_lib.sh`
queda afuera del censo a propósito: es librería, y exigirla en CI sería pedir que se ejecute un
archivo que aborta cuando se lo ejecuta. Cero gates censados o `ci.yml` ausente es **FAIL**, no
PASS. Ocho fixtures en `guard-gates.test.sh`, cuatro de ellos viéndolo encender. Fila **`T30`**.

**El rate limit no entra en `vercel.json`.** El archivo **sí existe desde S6** (2026-08-28) y
declara **una sola cosa: el `crons` que dispara `GET /api/cron/expire-reservations` cada 5 min**.
No puede declarar nada más: el schema oficial tiene `additionalProperties: false` en la raíz, así
que sólo admite `$schema` y las claves que él tipa — una clave de más no se ignora, rompe el deploy.
Y el rate limit no es una de ellas: el schema oficial tipa
`routes[].mitigate.action` como enum cerrado `["challenge","deny"]` con `additionalProperties: false`,
y `rate_limit` aparece **cero veces** (verificado contra `openapi.vercel.sh/vercel.json`, 2026-08-28,
`docs/research/vercel-firewall-as-code.md`). Las reglas viven versionadas en `config/firewall-rules.json`
y se aplican por CLI (`vercel firewall rules add` + `publish`), que **no es parte del build**: un
`vercel deploy` **no** sincroniza el WAF. `scripts/guard-firewall.sh` valida el archivo contra los
límites reales de Pro (`keys ⊆ {ip, ja4}` — `header:` es Enterprise —, `algo = fixed_window`,
ventana 10–600 s) y, sobre todo, **censa `apps/web/app` ENTERO** — no `apps/web/app/api`: todo
`route.ts` está cubierto por una regla o exceptuado con motivo escrito. Una ruta nueva sin decidir
rompe el gate el día que se crea. **El alcance ancho es a propósito y esta línea decía lo contrario
hasta el 2026-08-28** (lo marcó `docs-keeper`, lo verifiqué en `guard-firewall.sh:154-168`): la
primera versión del gate censaba sólo `app/api` y por eso **no veía `/_media/[...key]`**, que vive en
el route group `(app)` y es el que sirve los BYTES de las fotos — o sea el de mayor egress del
producto. Un censo que no ve el endpoint más caro es peor que no tener censo: da tranquilidad.
Y una regla que condicione sólo por `host` está **prohibida**: se facturan los *allowed requests*, así
que le cobraría peaje a cada pageview de vidriera — que es exactamente lo que `ARCHITECTURE.md` dice
que no defendemos. Para abuso masivo del HTML la palanca es Attack Challenge Mode, que es gratis. Por eso `scripts/probes/s2-media-measure.test.ts` vive afuera de `packages/media` aunque
mida a `packages/media`, y por eso un agente que quiere cambiar un techo pide, no edita.

**Tres filas nuevas, LEAD, 2026-08-28, y el motivo del corte.** Las levantó `app-agent`: creó
`apps/web/instrumentation.ts` —el hook de bootstrap de Next, donde se cablea el reporter de
incidentes de `@istock/media`— y **no tenía dueño**, porque la tabla cubría `app/(app)/**` y
`app/api/**` pero no la raíz de `apps/web`. Mismo hueco que `app/layout.tsx`, que se había tapado
escribiéndolo el LEAD sin anotarlo, que es tapar sin cerrar.

El corte no es por jerarquía, es por **qué decide cada archivo**. `instrumentation.ts` cablea
observabilidad del server y lee `_lib/env.ts`, que ya es de `app-agent`: partirlo en dos writers
haría que quien agrega una variable de entorno no pueda usarla. Va a `app-agent`.
`next.config.ts` es otra cosa: decide runtime, cache y build **para las tres caras a la vez** —
marketing, panel y vidriera—, así que un writer de una cara ahí decide por las otras dos. Es config
de plataforma, hermana de `vercel.json` y de `config/**`, y va al LEAD por la misma razón que ellas.
`app/layout.tsx` acompaña a `next.config.ts` por ser el shell común de las tres caras.

Corolario que ya aplica: `instrumentation.ts` **no puede** convertirse en el lugar donde una columna
mete efectos que no le corresponden. Es bootstrap, no un patio trasero.

### `architect` es un rol de FASE 1, y está dormido
`docs/ARCHITECTURE.md` y `docs/DECISIONS.md` son de **`docs-keeper`** desde que cerró FASE 1, como
dice la excepción declarada más abajo. `INDEX.md` decía `architect` y el contrato de `docs-keeper`
decía que las decisiones las escribe el `architect`: eran tres fuentes y dos respuestas. **Manda esta
tabla.** El LEAD sigue ratificando los ADRs nuevos; escribirlos no es lo mismo que decidirlos.

**Generalizado por el LEAD el 2026-08-28, porque `architect` no era el único.** `docs-keeper` no
pudo asignar dueño y lo reportó: `.claude/agents/product-scribe.md` reclamaba `docs/PRODUCT.md` y
`docs/DOMAIN.md`, que esta tabla le da a `docs-keeper`. Mismo patrón, otro archivo. La regla que
cierra la clase entera, en vez de este caso: **un contrato de agente puede acotar lo que su dueño
escribe, nunca ampliarlo.** Si `.claude/agents/*.md` y §4 discrepan sobre quién es dueño de un path,
**gana §4** y el contrato está derogado en esa línea hasta que el LEAD lo edite. El motivo no es de
autoridad: dos archivos que se creen dueños del mismo path producen dos writers, y "un writer por
directorio" es la primitiva de la que cuelga todo lo demás. `product-scribe` queda dormido igual
que `architect`; si el LEAD lo despierta, el encargo nombra el archivo y `docs-keeper` no lo toca
mientras dure.

**Corregido por el LEAD en FASE 2.** La fila anterior daba **todo** `**/*.test.ts` a `qa-agent`, y
eso contradecía el contrato de cada agente de paquete, que exige un test por export público. Regla
vigente: **el test unitario de un paquete es del owner del paquete** — nace y muere con el código
que prueba. `qa-agent` es dueño de lo que **cruza** un límite: e2e, RLS contra Postgres real,
tests de integración. Corolario que ya se está aplicando: **`qa-agent` nunca edita el código bajo
test para poner un test en verde**, y el owner del paquete **nunca edita un test de `qa-agent`
para tapar un fallo**. Si el test de `qa-agent` falla, el defecto es del código hasta que se
demuestre lo contrario.

**Desempate, agregado por el LEAD en FASE 4.** Un test puede cumplir las dos descripciones a la vez:
estar *dentro* de un paquete y ser *RLS cruzado contra Postgres real*. **Gana la segunda**, y el
archivo se muda a `tests/`. El motivo es el mismo que separa un gate de su código: `db-agent`
escribe las **policies**, así que no puede ser también el dueño del test que las audita — sería el
mismo writer en las dos puntas del invariante más caro del producto ("sin RLS no hay merge").
Concreto y vigente: `rls-cross-tenant.test.ts` es de **`qa-agent`**. Su encabezado se declara
`db-agent` citando la mitad de arriba de esta regla; ese comentario está **derogado** y se borra en
la mudanza (fila T3 del board). Un test de RLS que sólo mira su propio tenant sí es del paquete.

**Precisión de ese desempate, LEAD, 2026-08-28 (S4).** Tal como quedó escrito arriba, el desempate
es **demasiado ancho**: "cruza tenants → se muda" arrastraría también al test unitario con el que
`db-agent` prueba su propia migración, y eso contradice la mitad de §4 que le da a cada paquete el
test de su código. El defecto es de la regla, no de quien la aplicó. El criterio real no es *si el
test cruza tenants*, es **quién es la auditoría de referencia**: la afirmación que un gate cita y
que queda parada entre una policy aflojada y un merge. Esa es **siempre de `qa-agent` y vive en
`tests/`**. El owner del paquete puede quedarse con casos cruzados como red de regresión propia,
con tres condiciones: (a) la auditoría de referencia existe en `tests/` y es de `qa-agent`;
(b) **ningún gate cita el test del paquete como evidencia** — si lo citara, el writer estaría
firmando su propio certificado; (c) si los dos divergen, **gana el de `tests/`** y el que se
corrige es el del paquete. Concreto y vigente: `packages/db/src/rls-anon-wa-click.test.ts` **se
queda con `db-agent`**; la auditoría de referencia del beacon son R2b/R6c/R7 de
`tests/rls-cross-tenant.test.ts`, de `qa-agent`. `rls-cross-tenant.test.ts` sigue siendo de
`qa-agent`, sin cambios. La duplicación que queda es deliberada y tiene precio: dos archivos que
tocar cuando cambia la policy. Se paga porque las dos puntas del invariante más caro del producto
no pueden ser del mismo writer.

**Excepción declarada, FASE 1:** la síntesis de `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` y
`docs/COST.md` a partir de `docs/research/**` la escribe el **LEAD**, una sola vez. Decidir el
stack no es delegable. Cerrada la FASE 1, esos tres archivos vuelven a `docs-keeper` /
`cost-auditor` y el LEAD sólo ratifica ADRs nuevos.
