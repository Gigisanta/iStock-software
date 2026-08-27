# R5 - ENACOM: consulta de IMEI en Argentina, URL y flujo real
_Consultado: 2026-08-27 - Agente: researcher_
_Rev. 2 (2026-08-27): correcciones tras review adversarial. Cambios materiales: (a) documentado el cupo de
5 consultas/dia por IP del consultor de ENACOM; (b) retirado un IMEI de prueba que no se pudo re-verificar;
(c) corregida la aritmetica del enum; (d) agregada la columna `imei_check_status_raw` al schema propuesto;
(e) **corregido** el regimen sancionatorio de AAIP (240/2022 y 244/2022 estan DEROGADAS por 126/2024);
(f) corregida y fuenteada la referencia a Mendoza (Ley 9556 + Decreto 492/2025)._

## Pregunta

El panel de iStock tiene que (a) linkear al consultor oficial de IMEI de ENACOM y (b) guardar el
resultado que el dueño obtuvo. Para eso necesitamos, con fuente oficial y fecha:

1. URL exacta y vigente del consultor público de IMEI de ENACOM (verificada, no de memoria).
2. Estados textuales que devuelve la consulta -> define nuestro enum.
3. Si existe API pública o sólo consulta web manual.
4. Canales oficiales para denunciar / consultar un equipo con pedido de secuestro.
5. Obligaciones reales de un reseller de celulares usados en Argentina respecto de IMEI y origen.
6. Verificar la existencia de la "Ley/Resolución CABA 295/26".
7. Riesgo legal de guardar IMEIs de terceros bajo la ley argentina de datos personales.

No nos integramos con ENACOM ni somos registro oficial. Objetivo: no afirmar nada falso en el producto.

## Respuesta corta

- **URL vigente: `https://imei.enacom.gob.ar/`** (HTTP 200 el 2026-08-27, título `Consulta IMEI - Inicio`).
  `https://www.enacom.gob.ar/imei` devuelve **301 permanente** hacia ella. Usar la de `imei.` en el panel.
- **ENACOM devuelve 3 estados textuales**, verificados golpeando el sitio real: `Válido`, `Bloqueado`,
  `IMEI No Válido`. El mensaje `El IMEI debe tener 15 dígitos` **no es un estado**: es validación de
  formato del input, y el de cupo excedido tampoco lo es. Cuenta correcta:
  **3 de ENACOM + 2 nuestros (`not_checked`, `inconclusive`) = 5 valores de enum en DB**
  (`not_checked | valid | blocked | invalid | inconclusive`).
- **NO hay API pública.** `/api`, `/api/imei`, `/api/consulta` -> **404**. El sitio es Laravel+Livewire y
  su único endpoint (`POST /livewire/update`) exige CSRF + snapshot firmado con checksum: es interno del
  framework, sin documentación ni contrato de estabilidad. **No integrar** (ya alineado con CLAUDE.md).
- **Tampoco hay deep-link.** Probado `https://imei.enacom.gob.ar/?imei=358196070307420` -> el campo llega
  **vacío** (`"imei":""` en el snapshot). El panel sólo puede abrir la home; el dueño pega el IMEI a mano.
- **CUPO DURO NO DOCUMENTADO: 5 consultas por día.** A partir de la 6ª, el sitio responde
  `Has excedido el límite de 5 consultas diarias. Intenta nuevamente mañana.` (campo `error`,
  `resultado: null`). Reproducido el 2026-08-27 con **cookie jar nuevo, sesión nueva y User-Agent
  distinto** -> **no es por sesión ni por cookie: es por cliente/IP.** Consecuencia de producto: una
  oficina detrás de un NAT tiene **5 consultas/día para todo el local**. Por eso la consulta a ENACOM
  **no puede ser un paso del alta de unidad** (el gate de CLAUDE.md es "15 equipos en una tarde"):
  va en el flujo de **compra/canje**, que es de pocas unidades por día.
- **ENACOM no informa "pedido de secuestro" judicial.** Sólo dice bloqueado/no bloqueado contra GSMA.
  Denuncia y bloqueo: **`*910` gratuito**, la prestadora móvil, y el formulario ENACOM de Bloqueo/Desbloqueo.
- **La cita "Ley CABA 295/26" está mal etiquetada.** Son **dos decretos** del Ejecutivo porteño publicados
  el **18/08/2026**: **Decreto 296/26** (emergencia de la actividad, **90 días corridos**, confirmado en
  fuente oficial GCBA) y **Decreto 295/26** (reglamentación de la **Ley 6.009**, registro y trazabilidad
  con IMEI; sólo verificado en fuentes profesionales secundarias). **Aplica sólo a CABA** -> nuestro ICP
  (Cipolletti / Neuquén) **no está alcanzado**. Sirve como argumento de venta, no como obligación.
- **Ley 25.326 sigue vigente** (ninguna reforma sancionada al 2026-08-27). El IMEI **no** es dato personal
  por sí solo, pero **sí lo es** cuando se guarda junto al DNI/teléfono del que entregó el equipo en canje.

## Detalle

### 1. URL exacta y vigente del consultor público de IMEI

Verificación hecha hoy con `curl -I -L`:

| URL probada | Resultado 2026-08-27 |
|---|---|
| `https://www.enacom.gob.ar/imei` | `HTTP/1.1 301 Moved Permanently` -> `Location: https://imei.enacom.gob.ar/` |
| `https://imei.enacom.gob.ar/` | `HTTP/2 200`, 23.045 bytes, `<title>Consulta IMEI - Inicio</title>` |

**Canónica a usar en el panel: `https://imei.enacom.gob.ar/`**

La URL vieja que todavía circula en buscadores y notas de prensa
(`enacom.gob.ar/imei?g-recaptcha-response=&imei=XXXXXXXXXXXXXXX`, con reCAPTCHA y el IMEI por query string)
**ya no funciona así**: hoy es una app Livewire que ignora los parámetros GET. Si alguien la copió a una
spec vieja, está desactualizada.

Textos literales de la página (transcritos del HTML):

- `Consulta de IMEI` / `Verificá el estado de tu dispositivo móvil.`
- `Ingresá el número IMEI (15 dígitos)` (`maxlength="15"`)
- `Podés encontrar el IMEI marcando *#06# en tu teléfono`
- `El bloqueo o desbloqueo del IMEI es realizado solo por las compañías móviles, según lo indica la Resolución ENACOM Nº 2459/16.`
- `Si querés comprar un celular nuevo, solicitá al vendedor o vendedora chequear el IMEI para saber si puede ser usado o no. Si figura como robado o extraviado, al ponerle el chip no lo podrás usar. Si es válido, antes de comprar, pedí que la factura incluya el número de IMEI verificado.`
- Pie: `Enacom - Sitio sólo disponible para la República Argentina`

Casos de bloqueo que enumera el propio sitio: denuncia del dueño al `*910` o a la prestadora; robo de
cargamento/centro logístico denunciado por la empresa; IMEI adulterado (duplicado/multiplicado o
reinscripto con número inválido); IMEI no homologado internacionalmente por GSMA.

### 2. Estados posibles del resultado (define el enum)

Verificado **ejecutando consultas reales** contra el sitio el 2026-08-27. **Atención: el cupo de 5
consultas diarias por IP limita cuánto se puede verificar (y re-verificar) por día** — ver §3 y §8.
Al 2026-08-27, dentro del cupo del día sólo pude re-confirmar el caso `Válido`; los casos `Bloqueado` e
`IMEI No Válido` vienen de consultas de una sesión anterior del mismo día y **quedaron sin re-ejecutar**.
El componente
Livewire expone un objeto `resultado` con los campos `bloqueado`, `status`, `status_class`, `mensaje`,
`gsmaStatus`, `codigo_error`, `mostrar_datos_imei`.

| # | Caso probado (IMEI) | `status` | `bloqueado` | `codigo_error` | Texto que ve el usuario |
|---|---|---|---|---|---|
| 1 | `358196070307420` | `Válido` (`status_class: success`) | `NO` | *(vacío)* | `Estado: Válido` + `El dispositivo no figura denunciado por robo, hurto o extravío` |
| 2 | `490154203237518` | `Bloqueado` (`status_class: danger`) | `SI` | `GSMA01` | `Estado: Bloqueado` + `El dispositivo figura denunciado por robo, hurto o extravío` + `El IMEI está bloqueado en la base internacional (GSMA).` |
| 3 | `111111111111111` | *(sin `status`)*, `mostrar_datos_imei: false` | `NO` | `Arch03` | `IMEI No Válido` + `IMEI inválido en la base internacional (GSMA).` |
| 4 | `12345` | *(no llega a consultar)* | — | — | `El IMEI debe tener 15 dígitos` (validación de formato, client/server-side) |
| 5 | cualquiera, **6ª consulta del día** | *(no consulta)*, `resultado: null` | — | — | `Has excedido el límite de 5 consultas diarias. Intenta nuevamente mañana.` |

> El IMEI `353811110018472`, que una versión anterior de este doc listaba como `Válido`, **fue retirado**:
> **falla el check digit de Luhn** (suma 39, `39 % 10 != 0`) y **no pude re-consultarlo** el 2026-08-27
> porque el cupo diario ya estaba agotado. No lo afirmo ni lo niego -> §UNVERIFIED.
> Los tres IMEIs que sí quedan en la tabla son consistentes con Luhn: `358196070307420` (suma 50, pasa) y
> `490154203237518` (suma 60, pasa) devolvieron estado real; `111111111111111` (suma 22, **falla**) devolvió
> `Arch03` / `IMEI No Válido`.

**Interpretación de cada estado, para el copy del panel:**

- **`Válido`** = el IMEI existe en la base GSMA y **no figura denunciado** por robo, hurto o extravío
  **al momento de la consulta**. No dice que el equipo sea legítimo, ni que tenga factura, ni que no
  vaya a ser denunciado mañana. Es una foto, no un certificado.
- **`Bloqueado`** = el IMEI **figura denunciado** en la base internacional GSMA. Con un chip local no va a
  poder cursar tráfico. Para nosotros = **no comprar / no publicar**.
- **`IMEI No Válido`** = el número no está homologado por GSMA (`Arch03`). Típicamente IMEI adulterado,
  clonado, mal tipeado, o de equipo no homologado. Riesgo **igual o mayor** que `Bloqueado`.
- **Error de formato** = el input no tiene 15 dígitos. No es un resultado, es validación.
- **Cupo excedido** = tampoco es un resultado. Es **el sitio negándose a atender**. En iStock mapea a
  `inconclusive` (nunca a `invalid`, que significaría acusar al equipo de algo).

**Enum recomendado para iStock — 3 estados de ENACOM + 2 nuestros = 5 valores:**

```
not_checked   -- el dueño todavía no consultó (default)
valid         -- ENACOM: "Válido"
blocked       -- ENACOM: "Bloqueado"
invalid       -- ENACOM: "IMEI No Válido"
inconclusive  -- el sitio no respondió / el dueño no pudo completar
```

`inconclusive` no es un estado de ENACOM: lo agregamos nosotros porque el sitio se cae o cambia y
necesitamos un valor honesto distinto de `not_checked`.

**No mapear `Válido` a un badge tipo "Verificado ENACOM" en la vidriera.** Primero porque el IMEI y todo
lo derivado no salen del panel (CLAUDE.md §8), y segundo porque afirmaría algo que no podemos sostener.

### 3. ¿API pública? No.

- Probé rutas típicas: `GET /api` -> **404**, `GET /api/imei` -> **404**, `GET /api/consulta` -> **404**.
- El único endpoint que responde es **`POST /livewire/update`**, endpoint interno de
  [Livewire](https://livewire.laravel.com) (Laravel). Requiere `_token` CSRF de la sesión, el `snapshot`
  serializado del componente y un `checksum` HMAC del servidor. **No es una API**: no está documentada,
  no tiene versionado, no tiene contrato de estabilidad y se rompe con cualquier deploy.
- **Rate limit no publicado: 5 consultas/día por cliente-IP.** Respuesta literal del servidor el
  2026-08-27: `{"imei":"...","resultado":null,"error":"Has excedido el límite de 5 consultas diarias.
  Intenta nuevamente mañana.","showResult":false}`. Persiste con cookie jar nuevo, sesión nueva y otro
  User-Agent. **ENACOM no publica este límite en ninguna página**: se descubre golpeando. Un scraper
  nuestro moriría en la sexta unidad -> razón dura adicional para **no integrar**.
- `robots.txt` es `User-agent: * / Disallow:` (permite crawlear), pero eso **no** es una licencia de uso
  automatizado ni unos términos de servicio. No encontré ToS de uso de API publicados por ENACOM.
- **No existe deep-link**: `https://imei.enacom.gob.ar/?imei=358196070307420` renderiza el componente con
  `"imei":""`. No podemos pre-cargar el IMEI desde el panel.
- La base subyacente es la de **GSMA**. El acceso programático a GSMA (Device Check / Device Database) es
  **comercial y por terceros autorizados** (ej. CheckMEND), no gratuito ni abierto.

**Conclusión operativa:** el flujo es **manual y humano**. El panel abre el sitio en pestaña nueva, el
dueño consulta, vuelve y selecciona el resultado. Cero integración y **cero costo en USD**, pero **no**
"cero dependencia": dependemos de un servicio de terceros que **raciona 5 consultas por día y por IP**,
no publica ese límite y puede cambiarlo sin avisar. El diseño tiene que asumir que **el dueño puede no
poder consultar hoy** -> `not_checked` e `inconclusive` son estados de primera clase, no excepciones.

### 4. Canales oficiales para denunciar / consultar un equipo comprometido

| Necesidad | Canal oficial | Detalle verificado |
|---|---|---|
| Denunciar robo, hurto o extravío y **bloquear** el equipo | **`*910`** | `Si te robaron o perdiste tu celular, llamá al *910 desde cualquier teléfono para que tu equipo sea bloqueado y nadie más lo pueda usar.` Gratuito. Al bloquear el equipo, **la línea queda suspendida** hasta pedir chip nuevo. |
| Ejecutar el bloqueo/desbloqueo | **La prestadora móvil** | `El bloqueo o desbloqueo del IMEI es realizado solamente por las empresas prestadoras.` (Res. ENACOM 2459/16). ENACOM **no** bloquea. |
| Si la prestadora no bloquea/desbloquea | **Formulario ENACOM Bloqueo/Desbloqueo** — `https://www.enacom.gob.ar/imei/bloqueo-desbloqueo` | Pide: tipo de reclamo, **número de reclamo previo**, número de IMEI, imagen de la pantalla con `*#06#`, imagen del IMEI en la carcasa o caja. Es un canal de **asesoramiento**, no de bloqueo directo. |
| Reclamos generales | ENACOM Reclamos y Denuncias — `https://www.enacom.gob.ar/reclamos-y-denuncias_p1000` | Requiere reclamo previo ante la empresa. |
| Delito (equipo de origen ilícito) | **Policía / Ministerio Público Fiscal de la jurisdicción** | Denuncia penal. **No** es competencia de ENACOM. |
| Equipos **secuestrados** en operativos (sólo CABA) | AGC - "Listado de celulares secuestrados": `https://atencionvirtual.agcontrol.gob.ar/` (sección *Devolución de celulares*) y `https://recuperos.policiadelaciudad.gob.ar/` | Marco: Ley 6.009 + Ley 6.567 + Res. 592/AGC/2018. Búsqueda por marca/modelo/color (obligatorio) e IMEI cuando está disponible. Plazo de resguardo: **60 días** desde la publicación en BOCBA. |

**Importante para el copy del producto:** no encontré ningún **buscador público nacional de "pedidos de
secuestro" de celulares**. El consultor de ENACOM **no** responde esa pregunta: sólo dice si el IMEI está
en la lista negra GSMA. Si el producto sugiere lo contrario, estaría afirmando algo falso.

### 5. Obligaciones reales de un reseller respecto de IMEI y origen

**Nivel nacional.** La Resolución ENACOM **2459/16** pone la obligación en las **prestadoras** (bloquear
los IMEI denunciados e irregulares), no en el comercio. **No encontré una norma federal que obligue al
reseller a consultar el IMEI antes de comprar/vender un usado.** La recomendación de ENACOM
(`solicitá al vendedor o vendedora chequear el IMEI` / `pedí que la factura incluya el número de IMEI
verificado`) es **recomendación, no obligación**. Marcado como no encontrado, no como inexistente.

**La obligación real es provincial/municipal**, y es de dos tipos:

1. **Documentación de origen.** Poder acreditar la legítima adquisición o tenencia de cada equipo
   (factura, remito, acta de canje firmada con datos del que entregó). Este es el punto que se fiscaliza.
2. **Libro / registro de operaciones.** Consignar cada compra y venta, con identificación del equipo
   (IMEI) y de la persona que lo entregó.

**CABA** (ver §6): Ley 6.009 (sancionada 13/09/2018, promulgada 03/10/2018, publicada 08/10/2018) +
Ley 6.567 modificatoria. Obliga a comercios de compraventa y/o reparación de celulares usados a registrar
las operaciones y a `resguardar la documentación respaldatoria de la titularidad y/o tenencia`. Sanciones
de la propia ley: multa **1.000-4.000 unidades fijas** por falta de registro, **1.500-4.500 UF** por no
acreditar la legítima adquisición, **2.000-5.000 UF** por información falsa, más decomiso y clausura.

**Río Negro** (jurisdicción de Cipolletti, nuestro ICP): existe normativa provincial que obliga a
`llevar un libro debidamente foliado y rubricado en donde se consignen todas las operaciones de compraventa
de aparatos y equipos de telefonía celular o móvil`, alcanzando tanto a compraventa como a reparación.
El sitio de la Legislatura de Río Negro sirve ese texto bajo el rótulo **"LEY Nº 2420"**, pero el PDF no
se pudo transcribir de forma confiable y una de las páginas relacionadas corresponde a un **proyecto de
ley de 2013**. **Número, fecha y vigencia quedan UNVERIFIED** (ver §UNVERIFIED). No afirmar en producto.

**Mendoza** (referencia, no aplica a nuestro ICP) — **dato corregido y fuenteado**. La versión anterior de
este doc citaba un "Sistema Provincial de Control y Registro de Compra y Venta de Bienes Muebles Usados,
reglamentado por Decreto Nº 492" **sin ninguna URL**. Lo real:
- **Ley 9556 (Mendoza)**, "Creación del Registro de Bienes Muebles Usados que tendrá carácter público",
  sancionada **25/06/2024**, publicada **10/07/2024**, **vigente y de alcance general**. Fuente oficial:
  [argentina.gob.ar/normativa provincial - Ley 9556](https://www.argentina.gob.ar/normativa/provincial/ley-9556-123456789-0abc-defg-655-9000mvorpyel/actualizacion) (consultado 2026-08-27).
- Su reglamentación es el **Decreto 492/2025** (Mendoza, BO marzo 2025), que implementa el *Sistema
  Provincial, Preventivo, de Control, Registro y Sanción para la Compra y Venta de Bienes Muebles Usados* y,
  **para teléfonos móviles y smartphones, registra el código IMEI**.
- **El texto oficial del Decreto 492/2025 no lo obtuve.** El nombre del sistema, el año del decreto y el
  detalle del IMEI salen de prensa provincial concordante (Los Andes 13/03/2025, El Sol), **no** del Boletín
  Oficial de Mendoza -> §UNVERIFIED. No usar en producto ni en marketing.

**Nivel fiscal nacional:** existe un "Registro de Comercializadores de Bienes Usados no Registrables" de
AFIP/ARCA que alcanza equipos de telefonía móvil. La página ABC oficial devolvió
`No hay resultados que coincidan con tu búsqueda` al consultarla hoy -> **vigencia y número de RG
UNVERIFIED**. Si el reseller factura, esto lo resuelve su contador; **no es alcance de iStock Capa 1**
(CLAUDE.md §6 prohíbe ARCA/AFIP en Capa 1).

**Lo que sí conviene modelar en iStock (y ya está en el plan):** `imei` + `origen/procedencia` +
`resultado de consulta ENACOM` + `documentación respaldatoria` por unidad, en el panel. Eso cubre las dos
obligaciones reales (origen + registro) sin prometer cumplimiento normativo de ninguna jurisdicción.

### 6. "Ley/Resolución CABA 295/26": existe, pero la cita está mal

**La norma existe. El identificador está mal etiquetado.** No es una *ley* ni una *resolución*: es un
**Decreto del Poder Ejecutivo de la Ciudad**. Y en realidad son **dos decretos publicados el mismo día,
18/08/2026**, que la prensa y los resúmenes mezclan:

| Norma | Qué hace | Nivel de verificación |
|---|---|---|
| **Decreto 296/26** (BOCBA 18/08/2026) | Declara la **emergencia** de la actividad de comercialización y reparación de aparatos electrónicos usados de telefonía celular, sus partes y repuestos en CABA, por **90 días corridos**. Suspende inicio/tramitación de nuevas habilitaciones y transferencias en 4 **Zonas de Alta Criticidad**: Retiro-Microcentro, Balvanera-Once, Chacarita-Villa Crespo, Liniers-Límite Oeste. Faculta a la AGC a clausurar de inmediato los locales que no acrediten origen legítimo. | **ALTA** - confirmado en `buenosaires.gob.ar` (sitio oficial GCBA), que lo cita textualmente como "Decreto 296/26, publicado el 18 de agosto de 2026" y publica la *Declaración Jurada - Actividad Excluida de los términos del Decreto N.º 296/26*. |
| **Decreto 295/26** (BOCBA 18/08/2026, sanción 14/08/2026) | Aprueba la **reglamentación de la Ley 6.009**: crea el *Registro de Actividades de Comercialización y Reparación de Aparatos Electrónicos Usados de Telefonía Celular* y el régimen de **trazabilidad**. | **MEDIA** - dos fuentes profesionales independientes y concordantes (aconpy, contadoresenred). **No pude obtener el texto en BOCBA**: el buscador `boletinoficial.buenosaires.gob.ar/buscar` devuelve **HTTP 500** y `/normativaba/busqueda` **404** el 2026-08-27. |

**Contenido del Decreto 295/26 según las fuentes secundarias concordantes:**

- **A quién aplica:** personas humanas o jurídicas que, como actividad **principal, secundaria o accesoria**,
  comercialicen (incluida **intermediación**) o reparen estos bienes mediante locales, talleres, depósitos
  u otros establecimientos **en CABA**.
- **Qué se registra (Anexo I, art. 20):** `IMEI, número de serie y demás identificadores técnicos
  disponibles`, marca, modelo, características, estado, origen/modalidad/fecha de adquisición, tipo de
  operación, identificación de las personas intervinientes y documentación respaldatoria.
- **Cuándo (art. 21):** la carga es **previa** a la recepción para reparación o a la incorporación al stock;
  los **egresos** se asientan **de manera inmediata**.
- **Inscripción:** vigencia de **1 año** desde el alta (art. 14), renovable; la falta de renovación por
  **30 días corridos** habilita la baja. Plazo para inscribirse: **30 días corridos** desde la entrada en
  vigencia de las normas operativas (art. 6).
- **Autoridad de aplicación:** Agencia Gubernamental de Control (AGC).
- **Sanciones (art. 44):** remite al punto **4.1.29 del Régimen de Faltas** (Ley 451): multa, decomiso,
  clausura e inhabilitación.
- **Desde cuándo:** **no hay fecha cierta**. La operatividad depende del dictado de las normas operativas
  por la autoridad de aplicación, que al 2026-08-27 **no verifiqué publicadas**.

**Discrepancia y cómo la resolvemos.** Un resumen atribuye a "295/26" la declaración de emergencia y otro
le atribuye la reglamentación de la Ley 6.009. **Pesa más la fuente oficial de GCBA**, que es primaria y
adjunta un formulario que nombra explícitamente al **296/26** como el decreto de emergencia. Por lo tanto:
**296/26 = emergencia, 295/26 = reglamentación**. Hasta ver el BOCBA, el 295/26 va con confianza media.

**Qué significa para iStock:** aplica **sólo a establecimientos en CABA**. Nuestro ICP declarado (reseller
del Alto Valle: Cipolletti / Neuquén) **no está alcanzado**. Coincide con CLAUDE.md §Compliance:
"CABA 295/26 es argumento de venta, no integración". Recomendación de copy: hablar de **"registro de IMEI
y origen por unidad"** como buena práctica y como preparación ante normativa provincial, **sin** decir
"cumplís con el Decreto 295/26" — eso sería una afirmación de compliance que no podemos sostener, y
además la norma ni siquiera es exigible todavía con fecha cierta.

### 7. Guardar IMEIs de terceros: qué aplica en datos personales

**Norma vigente:** **Ley 25.326** de Protección de Datos Personales, aplicada por la **AAIP**. Al
2026-08-27 **sigue plenamente vigente**: hay un anteproyecto de la AAIP y dos proyectos de reforma
ingresados al Congreso inspirados en el RGPD/LGPD, pero **ninguno sancionado**. No planificar contra un
texto que no existe.

**¿El IMEI es dato personal?** Por sí solo es un identificador de **equipo**, no de persona. Se convierte
en **dato personal** cuando queda asociado a una persona identificada o identificable. En iStock eso pasa
**sí o sí en el canje**: `IMEI del equipo + nombre/DNI/teléfono de quien lo entregó` = base de datos
personales. El registro que exige la normativa de trazabilidad (`identificación de las personas
intervinientes`) empuja exactamente en esa dirección.

**Precauciones concretas que aplican:**

1. **Finalidad y minimización.** Guardar el IMEI para trazabilidad de stock y acreditación de origen.
   Nada más. No usarlo para marketing, scoring ni enriquecimiento.
2. **Consentimiento / base legítima en el canje.** Si guardamos datos del que entrega el equipo, tiene que
   haber un texto claro en el acta de canje diciendo qué se guarda, para qué y por cuánto tiempo.
3. **Confidencialidad y seguridad (arts. 9 y 10).** En iStock esto ya es regla dura: `tenant_id` + **RLS**,
   filtro de tenant explícito además de RLS, y **IMEI nunca** en vidriera, logs ni contexto del chatbot
   (CLAUDE.md §2 y §8). El `publicListingDTO` debe stripear `imei` con test que lo pruebe.
4. **Derechos del titular.** Acceso, rectificación y supresión. Necesitamos poder borrar/anonimizar el
   bloque de datos personales del canje sin romper el histórico de la unidad.
5. **Retención.** Definir un plazo (ej. el que exija la norma provincial aplicable + margen) y no guardar
   indefinidamente los datos del vendedor particular.
6. **Registro Nacional de Bases de Datos Personales (AAIP).** Los archivos/bases que permitan obtener
   información sobre personas deben estar inscriptos. **Ojo:** el obligado a inscribir es el **responsable
   de la base**. Como SaaS multi-tenant, hay que definir en los ToS quién es **responsable** (el reseller)
   y quién **encargado del tratamiento** (MaatWork). Esto es una **decisión de producto/legal pendiente**,
   no técnica.
7. **Sanciones — DATO CORREGIDO, era el peor error del doc.** La versión anterior afirmaba que el régimen
   vigente eran las **Resoluciones AAIP 240/2022 y 244/2022** con topes de
   **$3.000.000 / $10.000.000 / $15.000.000**. Esas dos resoluciones **existen** (avisos del BO nacional
   citados en §Fuentes y en §Refutaciones) **pero están DEROGADAS**: el **art. 8 de la Resolución AAIP
   126/2024** (dictada 22/05/2024, BO 24/05/2024, **vigente desde el 01/06/2024**) derogó la Disp. DNPDP
   7/05, la Res. AAIP 12/18, la **240/22**, la 243/19 y la **244/22**, y aprobó una nueva *Clasificación de
   infracciones* y un nuevo *Régimen de graduación de sanciones*. La 126/2024 fue a su vez modificada por la
   **Res. AAIP 179/2025** (BO 30/09/2025, art. 5 inc. b, funciones del registro de infractores).
   **Régimen vigente al 2026-08-27** (Infoleg, texto oficial):
   - Multa **por infracción**: leves **$1.000 – $80.000** · graves **$80.001 – $90.000** ·
     muy graves **$90.001 – $100.000**.
   - **Acumulación** de sanciones pecuniarias por idéntica conducta: tope total = máximo de la escala
     **× 500** -> **hasta $50.000.000** en muy graves.
   - **Pago voluntario** dentro de **20 días hábiles** de notificada: **50% de reducción**.
   - **Reincidencia**: nueva conducta sancionable dentro de **3 años** de notificada la primera sanción.
   Los montos están en pesos nominales de 2024 y **no** tienen mecanismo de indexación en el texto: para
   MaatWork el riesgo económico directo es bajo; el riesgo reputacional de una filtración, no.

**Riesgo real, ordenado:** el riesgo grande **no** es guardar el IMEI; es **filtrarlo** (vidriera, logs,
payload de API, prompt del chatbot, screenshot en soporte) o cruzarlo con datos del vendedor sin base
legítima. Las tres reglas duras de CLAUDE.md (RLS, IMEI fuera de la vidriera, seller no ve costo) ya
cubren la mayor parte.

### 8. Cómo re-verificar este research (nota de ACCEPTANCE)

`CLAUDE.md` §Reglas duras 2 exige un comando que el LEAD re-ejecute. Acá **no todo es igual de
re-ejecutable**, y esto hay que decirlo antes de que alguien "verifique" y crea que el doc miente:

| Qué se verifica | Comando | ¿Re-ejecutable? |
|---|---|---|
| URL canónica, redirect 301 y peso | `curl -sL -o /dev/null -w "%{http_code} %{size_download}\n" https://www.enacom.gob.ar/imei` | **Sí, ilimitado.** No consume cupo. Esperado: `200 23045`. (Ojo: con `-I` el `size_download` da `0` porque es HEAD.) |
| Ausencia de API | `curl -s -o /dev/null -w "%{http_code}\n" https://imei.enacom.gob.ar/api` (ídem `/api/imei`, `/api/consulta`) | **Sí, ilimitado.** Esperado: `404`. |
| Los 3 estados textuales, `GSMA01`, `Arch03` | `POST /livewire/update` con `_token` + `snapshot` + `checksum` tomados de la home | **NO de forma libre.** **Cada intento gasta 1 de las 5 consultas diarias por IP.** Verificar los 3 estados el mismo día requiere **3 IPs limpias**, o 3 días desde una sola IP. |
| El cupo mismo | 6 POST seguidos desde la misma IP | **Sí, una vez por día.** Es destructivo: deja la IP sin cupo hasta mañana. |

**Comando de aceptación recomendado:** los dos primeros (baratos, deterministas, no consumen nada).
El tercero es **verificación destructiva de cupo**: si el LEAD lo corre desde la misma máquina que ya
consultó hoy, va a recibir `Has excedido el límite de 5 consultas diarias`, que **no** es una refutación
de este research sino su confirmación.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| URL canónica del consultor | `https://imei.enacom.gob.ar/` | URL | verificación `curl` 2026-08-27 (HTTP 200) |
| Redirect desde URL vieja | 301 permanente | HTTP status | `curl -I -L https://www.enacom.gob.ar/imei`, 2026-08-27 |
| Peso de la home del consultor | 23.045 | bytes | `curl -w size_download`, 2026-08-27 |
| Estados textuales de ENACOM | 3 (`Válido`, `Bloqueado`, `IMEI No Válido`) | estados | consultas reales al sitio, 2026-08-27 |
| Valores del enum en iStock | 5 (`not_checked`,`valid`,`blocked`,`invalid`,`inconclusive`) | valores | decisión de este research |
| Longitud del IMEI | 15 | dígitos | `maxlength="15"` + `El IMEI debe tener 15 dígitos`, imei.enacom.gob.ar 2026-08-27 |
| Código de bloqueo GSMA | `GSMA01` | código | respuesta real, IMEI `490154203237518`, 2026-08-27 (**no re-verificable el mismo día: cupo agotado**) |
| Código de IMEI inválido | `Arch03` | código | respuesta real, IMEI `111111111111111`, 2026-08-27 (**no re-verificable el mismo día: cupo agotado**) |
| **Cupo del consultor de ENACOM** | **5** | **consultas/día por cliente-IP** | respuesta real de `POST /livewire/update`, 2026-08-27 (`Has excedido el límite de 5 consultas diarias`) |
| Consultas disponibles para una oficina detrás de NAT | 5 | consultas/día **para todo el local** | derivado del cupo por IP, 2026-08-27 |
| Unidades chequeables en el gate "15 equipos en una tarde" | 5 de 15 | unidades/día/IP | derivado del cupo, 2026-08-27 |
| Dígito de control del IMEI | el 15º, algoritmo de Luhn | dígito | 3GPP TS 23.003 (PDF ARIB), 2026-08-27 |
| Endpoints `/api*` públicos | 0 (todos 404) | endpoints | `curl` a `/api`, `/api/imei`, `/api/consulta`, 2026-08-27 |
| Costo de integración ENACOM | 0 | USD/mes | no hay integración: link externo |
| Línea de denuncia | `*910` | número corto, gratuito | enacom.gob.ar/denuncia-al-910_p4034, 2026-08-27 |
| Emergencia CABA (Dec. 296/26) | 90 | días corridos | buenosaires.gob.ar (AGC), 2026-08-27 |
| Zonas de alta criticidad CABA | 4 | zonas | buenosaires.gob.ar (AGC), 2026-08-27 |
| Vigencia de la inscripción (Dec. 295/26 art. 14) | 1 | año | contadoresenred / aconpy, 2026-08-27 (secundaria) |
| Plazo para inscribirse (art. 6) | 30 | días corridos desde normas operativas | contadoresenred, 2026-08-27 (secundaria) |
| Multa Ley 6.009 por falta de registro | 1.000-4.000 | unidades fijas | cedom.gob.ar, Ley 6009, 2026-08-27 |
| Multa Ley 6.009 por no acreditar adquisición | 1.500-4.500 | unidades fijas | cedom.gob.ar, Ley 6009, 2026-08-27 |
| Plazo de resguardo de celulares secuestrados (CABA) | 60 | días desde publicación BOCBA | buenosaires.gob.ar/agc, 2026-08-27 |
| Ley de datos personales vigente | 25.326 | ley nacional | argentina.gob.ar/aaip/datospersonales, 2026-08-27 |
| Régimen sancionatorio AAIP vigente | Res. AAIP **126/2024** (deroga 240/22 y 244/22) | resolución | Infoleg + argentina.gob.ar/normativa, 2026-08-27 |
| Entrada en vigencia del régimen 126/2024 | 01/06/2024 | fecha | Infoleg, 2026-08-27 |
| Multa AAIP por infracción leve | 1.000 – 80.000 | ARS | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Multa AAIP por infracción grave | 80.001 – 90.000 | ARS | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Multa AAIP por infracción muy grave | 90.001 – 100.000 | ARS | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Tope AAIP por acumulación (muy graves) | 50.000.000 | ARS (100.000 × 500) | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Reducción por pago voluntario (AAIP) | 50 | % dentro de 20 días hábiles | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Plazo de reincidencia (AAIP) | 3 | años | Res. AAIP 126/2024, Infoleg, 2026-08-27 |
| Ley de bienes muebles usados de Mendoza | 9556 (regl. Decreto 492/2025) | ley provincial vigente | argentina.gob.ar/normativa provincial, 2026-08-27 |

## Fuentes

**Primarias (oficiales), verificadas hoy:**

- [Consulta IMEI - ENACOM](https://imei.enacom.gob.ar/) — consultado 2026-08-27 (HTTP 200; textos y estados transcritos del HTML y de respuestas reales)
- [ENACOM - IMEI (URL vieja, redirige 301)](https://www.enacom.gob.ar/imei) — consultado 2026-08-27
- [ENACOM - Denunciá al *910](https://www.enacom.gob.ar/denuncia-al-910_p4034) — consultado 2026-08-27
- [ENACOM - Bloqueo y Desbloqueo de IMEI (formulario)](https://www.enacom.gob.ar/imei/bloqueo-desbloqueo) — consultado 2026-08-27
- [ENACOM - Reclamos y denuncias](https://www.enacom.gob.ar/reclamos-y-denuncias_p1000) — consultado 2026-08-27
- [GCBA - Decreto de Jorge Macri: la Ciudad refuerza el control (Decreto 296/26)](https://buenosaires.gob.ar/gcaba_historico/noticias/decreto-de-jorge-macri-la-ciudad-refuerza-el-control-para-atacar-la-mafia) — consultado 2026-08-27
- [GCBA - Comercialización y reparación de celulares usados (guía comercial, cita Decreto 296/26)](https://buenosaires.gob.ar/gcaba_historico/guia-para-administrar-tu-local-comercial/comercializacion-y-reparacion-de-celulares) — consultado 2026-08-27
- [GCBA/AGC - Listado de celulares secuestrados](https://buenosaires.gob.ar/agc/listado-de-celulares-secuestrados-nueva-ley) — consultado 2026-08-27
- [CEDOM - Ley 6009 CABA (texto)](https://www.cedom.gob.ar/legislacion/normas/leyes/RepoLeyes/ley6009.html) — consultado 2026-08-27
- [BOCBA - Resolución 1/AGC/2018 (procedimiento provisorio Ley 6009)](https://boletinoficial.buenosaires.gob.ar/normativaba/norma/439525) — consultado 2026-08-27
- [AAIP - Protección de datos personales](https://www.argentina.gob.ar/aaip/datospersonales) — consultado 2026-08-27
- [AAIP - Trámites ante el Registro Nacional de Bases de Datos Personales](https://www.argentina.gob.ar/aaip/datospersonales/tramites) — consultado 2026-08-27
- [Infoleg - Resolución AAIP 126/2024 (texto oficial: clasificación de infracciones y graduación de sanciones; art. 8 deroga 240/22 y 244/22)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/395000-399999/399750/norma.htm) — consultado 2026-08-27
- [argentina.gob.ar/normativa - Res. AAIP 126/2024, texto actualizado y normas modificatorias (Res. 179/2025)](https://www.argentina.gob.ar/normativa/nacional/norma-399750/actualizacion) — consultado 2026-08-27
- [Boletín Oficial - Resolución AAIP 240/2022 (BO 05/12/2022, **derogada**)](https://www.boletinoficial.gob.ar/detalleAviso/primera/277165/20221205) — consultado 2026-08-27
- [Boletín Oficial - Resolución AAIP 244/2022 (BO 06/12/2022, art. 2 topes $3M/$10M/$15M, **derogada**)](https://www.boletinoficial.gob.ar/detalleAviso/primera/277300/20221206) — consultado 2026-08-27
- [argentina.gob.ar/normativa provincial - Ley 9556 (Mendoza), texto actualizado y vigencia](https://www.argentina.gob.ar/normativa/provincial/ley-9556-123456789-0abc-defg-655-9000mvorpyel/actualizacion) — consultado 2026-08-27
- [3GPP TS 23.003 (PDF alojado por ARIB) - el 15º dígito del IMEI es el Check Digit calculado con la fórmula de Luhn](https://www.arib.or.jp/english/html/overview/doc/STD-T63V9_21/5_Appendix/Rel5/23/23003-5b0.pdf) — consultado 2026-08-27 (release antigua; el criterio del check digit no cambió)
- [Legislatura de Río Negro - documento rotulado "LEY Nº 2420"](https://web.legisrn.gov.ar/legislativa/legislacion/documento?id=2421) — consultado 2026-08-27 (PDF no transcribible con confianza)

**Secundarias (usadas sólo donde no hubo primaria, y marcadas como tales):**

- [Nuevo régimen de trazabilidad de celulares usados (Decreto 295/26)](https://blog.aconpy.com/2026/08/19/nuevo-regimen-de-trazabilidad-de-celulares-usados-que-contribuyentes-quedaran-obligados/) — consultado 2026-08-27
- [Contadores en Red - Nuevo régimen de trazabilidad de celulares usados](https://contadoresenred.com/nuevo-regimen-de-trazabilidad-de-celulares-usados-que-contribuyentes-quedan-obligados/) — consultado 2026-08-27
- [Infobae - El gobierno porteño declaró la emergencia por el robo de celulares](https://www.infobae.com/politica/2026/08/18/el-gobierno-porteno-declaro-la-emergencia-por-el-robo-de-celulares-y-endurece-los-controles-en-la-venta-de-equipos-usados/) — consultado 2026-08-27
- [GSMA - IMEI Database / Terminal Steering Group](https://www.gsma.com/get-involved/working-groups/terminal-steering-group/imei-database/) — consultado 2026-08-27
- [Diario Judicial - ¿Sigue siendo suficiente la Ley 25.326 en 2026?](https://www.diariojudicial.com/news-103126-proteccion-de-datos-personales-sigue-siendo-suficiente-la-ley-25326-en-2026) — consultado 2026-08-27
- [Los Andes (13/03/2025) - Reglamentaron el Registro de Bienes Muebles Usados (Decreto 492/2025 de Mendoza; IMEI para celulares)](https://www.losandes.com.ar/politica/reglamentaron-el-registro-bienes-muebles-usados-combatir-el-mercado-negro-celulares-tvs-y-bicicletas-n5941364) — consultado 2026-08-27
- [El Sol - Entró en vigencia la ley que controla la compraventa de bienes usados (Mendoza, Ley 9556)](https://www.elsol.com.ar/mendoza/entro-en-vigencia-la-ley-que-controla-de-la-compraventa-de-bienes-usados/) — consultado 2026-08-27
- [TÜV SÜD - IMEI Number Structure (check digit por Luhn)](https://www.tuvsud.com/en-gb/services/product-certification/imei-numbers/number-structure) — consultado 2026-08-27

## Impacto en iStock

**ARCHITECTURE**

- **Sin integración externa.** No hay cliente HTTP a ENACOM, no hay job, no hay cache, no hay retry, no hay
  secreto. El panel sólo renderiza un `<a href="https://imei.enacom.gob.ar/" target="_blank" rel="noopener">`.
  Confirma y refuerza CLAUDE.md §Compliance ("link + enum", no integración).
- **`packages/db` (db-agent):** en la tabla de unidades, o en una tabla satélite `unit_imei_checks`:
  - `imei_check_status` enum: `not_checked | valid | blocked | invalid | inconclusive` (default `not_checked`)
  - **`imei_check_status_raw text null`** — **el texto crudo que mostró ENACOM** (`Válido`, `Bloqueado`,
    `IMEI No Válido`, o el mensaje de cupo excedido), tal cual, sin normalizar. **No es opcional ni
    "nice to have":** es la única mitigación real de "ENACOM cambia los textos". Sin esta columna, el día
    que cambien el copy no hay forma de re-mapear el histórico. (Se agregó por finding del review: la
    §Confianza afirmaba esta mitigación y el schema no la tenía.)
  - `imei_checked_at timestamptz null`
  - `imei_checked_by uuid null` (usuario del tenant que declaró el resultado)
  - `imei_check_source text` fijo `'enacom_web_manual'` (deja lugar a otra fuente sin migrar el enum)
  - `imei_check_note text null` (máx corto; para `inconclusive` o aclaraciones)
  - `tenant_id` + FK + índice + **política RLS** obligatorios (CLAUDE.md §7).
- **`packages/domain` (domain-agent):** el `publicListingDTO` debe stripear `imei` **y** todo el bloque
  `imei_check_*`. Aunque `valid` parezca inofensivo, publicarlo es afirmar un estado oficial que no
  controlamos y que cambia con el tiempo. Test explícito que lo pruebe.
- **`packages/ai` (ai-agent):** el bloque `imei_check_*` **no entra** al contexto del chatbot. Ni el IMEI ni
  el resultado.
- **Validación (corregido por el review):** el IMEI se valida con **15 dígitos numéricos** en Zod, y eso sí
  es **bloqueante** (lo exige el propio formulario de ENACOM). El **check digit de Luhn** (15º dígito,
  3GPP TS 23.003) se calcula en `packages/domain` (TS puro, sin I/O) **como warning NO bloqueante**:
  muestra *"revisá el IMEI: el dígito verificador no cierra"* y **deja guardar igual**.
  **Prohibido** un `.refine(luhn)` que impida el alta. Motivos: (a) no tengo evidencia re-verificable de
  cómo responde ENACOM ante un IMEI que falla Luhn — el único caso que apuntaba en esa dirección se retiró
  de §2 por no ser reproducible; (b) equipos con IMEI mal grabado existen y el dueño igual necesita
  cargarlos para poder marcarlos `blocked`/`invalid` y no venderlos. Un gate de alta que rechaza stock es
  peor que un warning que el dueño ignora.
- **UX del panel — REDISEÑADO por el cupo de 5/día (finding del review):** la versión anterior proponía un
  botón "Consultar en ENACOM" **por unidad** en el alta. Eso es inejecutable: con 5 consultas/día por IP,
  el dueño que carga 15 equipos en una tarde ve `Intenta nuevamente mañana` en el equipo N° 6. Diseño nuevo:
  - **El alta de unidad NO consulta ENACOM.** Guarda `not_checked` y no interrumpe la carga masiva.
  - El botón "Consultar en ENACOM" (abre pestaña, `target="_blank" rel="noopener"`) vive en el flujo de
    **compra / canje / ingreso de mercadería** y en la vista de detalle de la unidad — flujos de pocas
    unidades por día, compatibles con el cupo.
  - Copy fijo debajo del botón: *"ENACOM permite 5 consultas por día por conexión. Si te dice que
    excediste el límite, marcá 'No pude consultar' y reintentá mañana."* -> eso es `inconclusive`.
  - Selector con los **3 estados textuales** de ENACOM redactados igual que en el sitio + `inconclusive`.
  - Vista de panel "**unidades sin chequear**" ordenada por antigüedad, para que el dueño gaste sus 5
    consultas diarias en las que importan (mayor valor / procedencia dudosa) en vez de en orden de carga.
  - **No** podemos pre-cargar el IMEI en el link: mostrar el IMEI copiable al lado del botón.

**DECISIONS (ADRs sugeridos al `architect`)**

- **ADR: consulta de IMEI manual, sin integración, y RACIONADA.** No hay API pública de ENACOM (404 en
  `/api*`); el único endpoint es el interno de Livewire, sin contrato de estabilidad; **y encima corta a
  las 5 consultas diarias por IP**. Ese cupo mata dos cosas de una: la integración automática (un scraper
  nuestro muere en la sexta unidad) y la consulta por unidad en el alta. Decisión: **atestación manual del
  dueño, con fecha y autor, disparada desde el flujo de compra/canje — nunca desde el alta masiva**.
  `not_checked` es un estado **normal y mayoritario**, no una deuda. Revisar sólo si ENACOM publica una API
  o un cupo mayor.
- **ADR: iStock no certifica nada.** El campo guarda **lo que el dueño declaró haber consultado**, no un
  hecho verificado por nosotros. Copy obligatorio junto al campo, algo como:
  *"Resultado declarado por el dueño el {fecha}. iStock no es un registro oficial ni consulta a ENACOM."*
- **ADR: CABA 295/26 no genera trabajo de producto.** Aplica a establecimientos en CABA; nuestro ICP es el
  Alto Valle. Se usa como **argumento de venta** ("tené el IMEI y el origen registrado por unidad"),
  **nunca** como promesa de cumplimiento normativo. Prohibido el copy "cumplís con el Decreto 295/26".
- **ADR: modelo de responsabilidad de datos.** En los ToS, el **reseller** es responsable de la base de
  datos personales y **MaatWork** es encargado del tratamiento. Pendiente de redacción legal — es
  **blocker de marketing/legal, no de ingeniería**.

**COST**

- **COST_DELTA = 0.** Un `<a>` externo. Cero egress, cero filas extra por request, cero tokens, cero CPU-ms.
- Las columnas agregadas son 1 enum + 1 timestamp + 1 uuid + **3 text cortos** por unidad (se sumó
  `imei_check_status_raw`, ~15 bytes reales por fila): irrelevante frente
  al presupuesto de Postgres. No toca la vidriera (que sirve el DTO público sin estos campos) ni el
  objetivo de "95% de los hits no tocan Postgres".
- El único costo evitado y **grande** es el que NO estamos pagando: integrarnos a un endpoint interno de
  Livewire habría significado scraping frágil, retries, y romperse en cada deploy de ENACOM.

## Confianza

**Media** (bajó de "media-alta" tras el review). Desagregada por punto, porque no todos valen lo mismo:

- **Punto 1 (URL): ALTA.** `curl -I -L` es reproducible desde cualquier IP, cuantas veces se quiera, y
  **no consume cupo**.
- **Punto 2 (estados): MEDIA — bajó de ALTA.** Motivo: el **cupo de 5 consultas diarias por IP** hace que
  la tabla de §2 no sea re-ejecutable de una sentada. El 2026-08-27 sólo el caso `Válido`
  (`358196070307420`) quedó confirmado dentro del cupo; `Bloqueado`/`GSMA01` (`490154203237518`) y
  `IMEI No Válido`/`Arch03` (`111111111111111`) vienen de consultas previas del mismo día y **no pude
  re-ejecutarlas**. Además **retiré** el IMEI `353811110018472` de la fila `Válido` porque falla Luhn y no
  es re-verificable. Subiría a ALTA re-corriendo las 3 consultas desde 3 IPs limpias el mismo día.
- **Punto 3 (ausencia de API): ALTA para "no hay API pública"; MEDIA para el mecanismo del cupo.** Los 404
  de `/api*` y la existencia del límite de 5/día son hechos observados hoy. Lo que **no** verifiqué es el
  criterio exacto: si es por IP exacta, por rango, o por algún fingerprint adicional (no tengo una segunda
  IP para probar). Lo que sí está probado: **no es por sesión, ni por cookie, ni por User-Agent** — el
  límite persiste con los tres nuevos. Tampoco verifiqué si el reset es a medianoche ART o rolling 24 h.
  **Retiro la frase "cero dependencia"** de la versión anterior: es falsa.
- **Punto 4 (canales): ALTA** para `*910`, prestadora y formulario ENACOM (fuente oficial directa).
  **MEDIA** para la afirmación negativa "no existe buscador nacional de pedidos de secuestro": es una
  ausencia de evidencia, no evidencia de ausencia.
- **Punto 5 (obligaciones del reseller): MEDIA.** ALTA para CABA (texto de la Ley 6.009 en CEDOM) y para la
  **existencia, fechas y vigencia de la Ley 9556 de Mendoza** (argentina.gob.ar/normativa, oficial).
  **MEDIA** para el contenido del **Decreto 492/2025** de Mendoza (prensa provincial concordante, sin BO).
  **BAJA para Río Negro**, que es justo la jurisdicción de nuestro ICP. Subiría muchísimo con el texto de
  la norma rionegrina en el Boletín Oficial provincial.
- **Punto 6 (295/26 vs 296/26): MEDIA-ALTA.** El 296/26 está confirmado en fuente oficial GCBA. El 295/26
  descansa en dos fuentes profesionales concordantes porque el buscador de BOCBA devolvió **HTTP 500** en
  todos los intentos. Subiría a alta con el texto en `boletinoficial.buenosaires.gob.ar`.
- **Punto 7 (datos personales): ALTA — subió.** "Ley 25.326 vigente, sin reforma sancionada" está en fuente
  oficial (AAIP), y el régimen sancionatorio **quedó verificado contra Infoleg**: Res. AAIP **126/2024**
  (vigente desde 01/06/2024), que **derogó** las 240/2022 y 244/2022 que este doc citaba como vigentes.
  Escalas, tope ×500, descuento por pago voluntario y plazo de reincidencia **ya no son UNVERIFIED**.

**Qué subiría la confianza global:** (a) el PDF del Decreto 295/26 en BOCBA; (b) el texto oficial de la
norma de Río Negro; (c) re-ejecutar las 3 consultas de estado desde IPs limpias el mismo día; (d) el texto
del Decreto 492/2025 de Mendoza en su Boletín Oficial provincial.

**Qué la bajaría:** que ENACOM cambie los textos de resultado, baje el cupo o le agregue captcha. Mitigado
por dos decisiones que **sí** están en el schema y en el UX de este doc: guardar `imei_check_status_raw`
(columna ahora presente en §Impacto) y tratar `inconclusive` como estado normal, no como error.

## Refutaciones al review

Una sola, y parcial. El review (finding 5 / afirmación sin fuente 2) dice que las **Resoluciones AAIP
240/2022 y 244/2022** se afirmaban sin fuente y deja abierta la duda de si existen. **Existen**, y acá
están sus avisos en el Boletín Oficial nacional, consultados el 2026-08-27:

- Res. AAIP **240/2022** (BO 05/12/2022): https://www.boletinoficial.gob.ar/detalleAviso/primera/277165/20221205
- Res. AAIP **244/2022** (BO 06/12/2022), art. 2, topes textuales
  `PESOS TRES MILLONES ($ 3.000.000.-)` / `PESOS DIEZ MILLONES ($ 10.000.000.-)` /
  `PESOS QUINCE MILLONES ($ 15.000.000.-)`: https://www.boletinoficial.gob.ar/detalleAviso/primera/277300/20221206

O sea: los números de resolución y los montos que el doc citaba eran **correctos**. Pero el review tenía
razón en el fondo y encontró menos de lo que había: **el error real era peor**. Ese régimen está
**derogado desde el 01/06/2024** por el art. 8 de la Res. AAIP 126/2024, y el doc lo presentaba como
vigente en 2026. Corregido en §7, §Números y §Fuentes. **Los otros 5 findings se aceptan sin defensa**;
en particular el del cupo de 5 consultas diarias, que reproduje yo mismo y que invalidaba el UX propuesto.

## UNVERIFIED

- **Resultado `Válido` para el IMEI `353811110018472`. RETIRADO del cuerpo del doc.** La versión anterior
  lo listaba en §2 como consulta real con resultado `Válido`. **No lo puedo sostener:** el número **falla
  el check digit de Luhn** (suma 39) y **no pude re-consultarlo** el 2026-08-27 porque el cupo de 5
  consultas diarias por IP ya estaba agotado (probado: la request devolvió el mensaje de cupo). No afirmo
  que el dato sea inventado ni que sea real: afirmo que **no está sostenido**, y por eso salió de la tabla.
  Ninguna afirmación del doc depende ya de él (la recomendación de Luhn se reescribió como warning no
  bloqueante, ver §Impacto). Re-verificar desde una IP limpia.
- **Criterio exacto del cupo de ENACOM.** Verificado: **5 consultas/día**, y que **no** es por sesión,
  cookie ni User-Agent. **No verificado:** si la clave es la IP exacta, un rango/ASN, o un fingerprint
  adicional; ni si el reset es a medianoche ART o rolling 24 h; ni si ENACOM aplica un cupo distinto a
  IPs corporativas. Requiere probar desde una segunda IP, que no tengo.
- **Re-verificación de `Bloqueado`/`GSMA01` y `IMEI No Válido`/`Arch03`.** Los valores de §2 provienen de
  consultas reales del 2026-08-27, pero **no fueron re-ejecutables el mismo día** por el cupo. Confianza
  media, no alta (ver §Confianza punto 2).
- **Texto oficial del Decreto 492/2025 de Mendoza** (reglamentario de la Ley 9556). La **Ley 9556 sí está
  verificada** en fuente oficial (argentina.gob.ar/normativa provincial: sancionada 25/06/2024, publicada
  10/07/2024, vigente). El **número y año del decreto, el nombre del sistema y el registro del IMEI para
  celulares** salen de prensa provincial concordante (Los Andes 13/03/2025, El Sol), no del Boletín Oficial
  de Mendoza. No usar en producto ni en marketing.
- **Texto oficial del Decreto 295/26 en BOCBA.** El buscador `boletinoficial.buenosaires.gob.ar/buscar`
  devolvió **HTTP 500** y `/normativaba/busqueda` **404** en todos los intentos del 2026-08-27. Números de
  artículo (6, 14, 20, 21, 44), fecha de sanción (14/08/2026) y remisión al punto 4.1.29 del Régimen de
  Faltas provienen de **fuentes secundarias profesionales concordantes**, no del boletín.
- **Fecha de entrada en vigencia efectiva del régimen de trazabilidad de CABA.** Depende de normas
  operativas de la AGC que **no verifiqué publicadas** al 2026-08-27.
- **Norma de Río Negro sobre libro foliado/rubricado para compraventa de celulares.** El sitio de la
  Legislatura la rotula "LEY Nº 2420", pero el PDF no se pudo transcribir y una página relacionada del
  mismo sitio corresponde a un **proyecto de ley de 2013**. **Número, fecha de sanción y vigencia sin
  confirmar.** No usar en producto ni en marketing hasta verificar en el Boletín Oficial de Río Negro.
- **Provincia del Neuquén:** no encontré normativa provincial específica sobre registro de compraventa de
  celulares usados / IMEI. **No verificado que no exista.**
- **Registro de Comercializadores de Bienes Usados no Registrables (AFIP/ARCA):** aparece en el índice de
  ARCA pero la página ABC devolvió `No hay resultados que coincidan con tu búsqueda`. Número de RG,
  alcance y vigencia 2026 **sin confirmar**.
- ~~**Montos de multa AAIP** (topes $3M/$10M/$15M de las Res. 240/2022 y 244/2022)~~ — **RESUELTO y
  CORREGIDO.** Ya no es UNVERIFIED: se verificó el texto oficial en Infoleg y en el BO. Esas resoluciones
  **están derogadas** desde el 01/06/2024; el régimen vigente es la **Res. AAIP 126/2024** (modificada por
  la 179/2025), con escalas $1.000–$80.000 / $80.001–$90.000 / $90.001–$100.000 por infracción y tope por
  acumulación de máximo de escala × 500. Ver §7 y §Números.
- **Existencia de un buscador público nacional de "pedidos de secuestro" de celulares:** no encontré
  ninguno. Es una **afirmación negativa**, no una verificación.
- **Términos de uso del consultor de ENACOM para consultas automatizadas:** no encontré ToS publicados.
  `robots.txt` permite crawling, pero eso no es una licencia. Irrelevante mientras no integremos.
- **Norma federal que obligue al reseller a consultar el IMEI antes de comprar/vender un usado:** no
  encontrada. ENACOM lo **recomienda**, no lo exige. No verificado que no exista.
- **Comportamiento del consultor ante IMEI con pedido de secuestro judicial pero sin denuncia GSMA:** no
  probado (no tengo un caso de prueba). Presumiblemente devolvería `Válido`, lo cual **refuerza** que no
  presentemos `valid` como garantía de nada.
