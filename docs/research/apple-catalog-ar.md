# R6 — Catálogo Apple que se vende hoy en el mercado argentino de reventa
_Consultado: 2026-08-27 · Agente: researcher_

## Pregunta

¿Con qué datos poblamos `catalog_models` para que un reseller del Alto Valle (Neuquén /
Cipolletti) cargue stock sin pelearse con el autocomplete? Concretamente: qué líneas de iPhone
circulan hoy en la reventa argentina, qué capacidades y colores **existieron de fábrica** (con el
nombre en español que usa el mercado), cuál es el orden de frecuencia real, qué iPad / Watch / Mac
aparecen de verdad en el stock, qué accesorios se venden por lote, qué significan exactamente los
términos de condición locales, y qué mira un comprador antes de escribir por WhatsApp.

## Respuesta corta

- **32 líneas de iPhone verificadas contra Apple** (iPhone XR → iPhone 17e), que expanden a
  **101 combinaciones línea×capacidad** y **453 combinaciones línea×capacidad×color**. Ese es el
  tamaño real del seed, no más. Fuente: fichas técnicas `support.apple.com/…?locale=es_LAMR`.
- **Las trampas de capacidad son reales y hay que codificarlas como validación, no como texto:**
  `iPhone 15 Pro Max` y `iPhone 16 Pro Max` **nunca** tuvieron 128 GB (arrancan en 256);
  toda la línea `iPhone 17` arranca en **256 GB** (no hay 128); `iPhone 17 Pro Max` es el **único**
  con **2 TB**; **64 GB murió con el iPhone 12 / SE 3ª gen** (ningún 13 en adelante lo tuvo).
  Un `iPhone 14 Pro 64GB` tiene que ser **imposible de guardar**, no un warning.
- **Colores en español = los de Apple es-LAMR**, que es exactamente lo que copia el mercado:
  `Grafito`, `Azul Sierra`, `Verde alpino`, `Negro espacial`, `Morado oscuro`, `Blanco estelar`,
  `Medianoche`, `Azul pacífico`, `Titanio natural`, `Titanio del desierto`, `Naranja cósmico`,
  `Azul profundo`, `Verde azulado`, `Ultramarino`, `Azul neblina`, `Salvia`, `Lavanda`.
- **Orden del autocomplete (top 10 por frecuencia observada en catálogos AR):** 13 · 14 · 15 ·
  14 Pro/Pro Max · 12 · 11 · 13 Pro/Pro Max · 15 Pro/Pro Max · 16 Pro/Pro Max · 17/17 Pro Max.
  Es **triangulación de catálogos reales**, no un ranking oficial — ver Confianza.
- **iPad/Watch/Mac son cola larga: ~10–16 SKUs, no un catálogo.** Lo que tiene **stock real hoy**
  (Store API de omnitech.ar, `is_in_stock=true`, 2026-08-27): iPad 11ª gen 10.9" 128 GB, iPad 11
  A16 10.9" 256 GB, iPad Air M4 11", iPad Air M4 13" 128 GB, iPad Pro M5 11"/13" 256 GB ·
  MacBook Air M1 13" 256 GB, MacBook Air 13.3" 2020 i7 16/512, MacBook Pro 14" M1 Pro 16/512.
  Sumado al reseller de Neuquén: Watch SE 3, Series 11 (42/46 mm), Ultra 3 49 mm, **MacBook Neo
  13"** y Mac mini M2. **`iPad mini 7` y `MacBook Air M2` figuran en catálogo pero con
  `is_in_stock=false` → NO sembrarlos** (coherente con §UNVERIFIED). Catálogo aparte, **cero** UI
  dedicada.
- **El vocabulario de condición del CLAUDE.md ya está bien**, pero `tester_a_plus` tiene una
  definición operativa concreta y verificable: **batería >85 %, pantalla original, Face ID
  funcional, estética impecable, garantía típica 30 días**. `used_excellent` en el mercado se
  publica como **"USADO PREMIUM", garantía 90 días, batería 80–100 % declarada en el título**.
- **La ficha pública mínima del CLAUDE.md está confirmada por evidencia de avisos reales**
  (batería %, pantalla original, iCloud/libre, procedencia, garantía). Falta **una** cosa que los
  avisos AR sí traen y nosotros no listamos: **si incluye caja + cargador + funda** y **medios de
  pago concretos (USD / ARS / transferencia / USDT / cuotas)**.

---

## Detalle

### 1. Líneas de iPhone que circulan hoy, con capacidades y colores de fábrica

Todo lo de esta tabla sale de la ficha técnica oficial de Apple en español latinoamericano
(`support.apple.com/kb/SP###?locale=es_LAMR` o `support.apple.com/es-lamr/######`), consultada el
2026-08-27. Los nombres de color están **tal cual los escribe Apple es-LAMR**, que es la forma que
el mercado argentino copia en los avisos.

| Línea | Capacidades de fábrica | Colores (es-LAMR) |
|---|---|---|
| iPhone XR (2018) | 64 / 128 / 256 GB | Negro, Blanco, Azul, Amarillo, Coral, (PRODUCT)RED |
| iPhone SE 2ª gen (2020) | 64 / 128 / 256 GB | Negro, Blanco, (PRODUCT)RED |
| iPhone 11 | 64 / 128 / 256 GB | Negro, Blanco, Verde, Amarillo, Morado, (PRODUCT)RED |
| iPhone 11 Pro | 64 / 256 / 512 GB | Gris espacial, Plata, Oro, Verde medianoche |
| iPhone 11 Pro Max | 64 / 256 / 512 GB | Gris espacial, Plata, Oro, Verde medianoche |
| iPhone 12 mini | 64 / 128 / 256 GB | Negro, Blanco, Verde, Azul, Morado, (PRODUCT)RED |
| iPhone 12 | 64 / 128 / 256 GB | Negro, Blanco, Verde, Azul, Morado, (PRODUCT)RED |
| iPhone 12 Pro | 128 / 256 / 512 GB | Plata, **Grafito**, Oro, **Azul pacífico** |
| iPhone 12 Pro Max | 128 / 256 / 512 GB | Plata, **Grafito**, Oro, **Azul pacífico** |
| iPhone 13 mini | 128 / 256 / 512 GB | Medianoche, Blanco estelar, Azul, Rosa, Verde, (PRODUCT)RED |
| iPhone 13 | 128 / 256 / 512 GB | Medianoche, Blanco estelar, Azul, Rosa, Verde, (PRODUCT)RED |
| iPhone 13 Pro | 128 / 256 / 512 GB / 1 TB | **Grafito**, Oro, Plata, **Azul Sierra**, **Verde alpino** |
| iPhone 13 Pro Max | 128 / 256 / 512 GB / 1 TB | **Grafito**, Oro, Plata, **Azul Sierra**, **Verde alpino** |
| iPhone SE 3ª gen (2022) | 64 / 128 / 256 GB | Medianoche, Blanco estelar, (PRODUCT)RED |
| iPhone 14 | 128 / 256 / 512 GB | Medianoche, Morado, Blanco estelar, Azul, Amarillo, (PRODUCT)RED |
| iPhone 14 Plus | 128 / 256 / 512 GB | Medianoche, Morado, Blanco estelar, Azul, Amarillo, (PRODUCT)RED |
| iPhone 14 Pro | 128 / 256 / 512 GB / 1 TB | **Negro espacial**, Plata, Oro, **Morado oscuro** |
| iPhone 14 Pro Max | 128 / 256 / 512 GB / 1 TB | **Negro espacial**, Plata, Oro, **Morado oscuro** |
| iPhone 15 | 128 / 256 / 512 GB | Negro, Azul, Verde, Amarillo, Rosa |
| iPhone 15 Plus | 128 / 256 / 512 GB | Negro, Azul, Verde, Amarillo, Rosa |
| iPhone 15 Pro | 128 / 256 / 512 GB / 1 TB | Titanio negro, Titanio blanco, Titanio azul, **Titanio natural** |
| iPhone 15 Pro Max | **256 / 512 GB / 1 TB** ⚠ sin 128 | Titanio negro, Titanio blanco, Titanio azul, **Titanio natural** |
| iPhone 16 | 128 / 256 / 512 GB | Negro, Blanco, Rosa, **Verde azulado**, **Ultramarino** |
| iPhone 16 Plus | 128 / 256 / 512 GB | Negro, Blanco, Rosa, **Verde azulado**, **Ultramarino** |
| iPhone 16e (2025) | 128 / 256 / 512 GB | Negro, Blanco |
| iPhone 16 Pro | 128 / 256 / 512 GB / 1 TB | Titanio negro, Titanio blanco, **Titanio natural**, **Titanio del desierto** |
| iPhone 16 Pro Max | **256 / 512 GB / 1 TB** ⚠ sin 128 | Titanio negro, Titanio blanco, **Titanio natural**, **Titanio del desierto** |
| iPhone 17 | **256 / 512 GB** ⚠ sin 128 | Negro, Blanco, **Azul neblina**, **Salvia**, **Lavanda** |
| iPhone Air | 256 / 512 GB / 1 TB | **Negro espacial**, **Blanco nube**, **Oro claro**, **Azul cielo** |
| iPhone 17 Pro | 256 / 512 GB / 1 TB | Plata, **Naranja cósmico**, **Azul profundo** |
| iPhone 17 Pro Max | 256 / 512 GB / 1 TB / **2 TB** | Plata, **Naranja cósmico**, **Azul profundo** |
| iPhone 17e (2026) | 256 / 512 GB | Negro, Blanco, **Rosa pálido** |

**Reglas duras que salen de la tabla (candidatas a test en `packages/domain`):**

- 64 GB existe **sólo** en XR, SE 2ª, SE 3ª, 11, 11 Pro, 11 Pro Max, 12 mini, 12. De iPhone 13 en
  adelante **no hay 64 GB**.
- 1 TB existe **sólo** en las Pro/Pro Max de 13, 14, 15, 16, en iPhone Air y en 17 Pro/Pro Max.
- 2 TB: **exclusivo de iPhone 17 Pro Max**.
- 128 GB **no existe** en 15 Pro Max, 16 Pro Max, 17, 17 Pro, 17 Pro Max, iPhone Air, 17e.
- `(PRODUCT)RED` es un color real de fábrica hasta el iPhone 14 / 14 Plus / SE 3ª. En el mercado se
  publica como **"Rojo"** o **"Product Red"** — conviene guardar el canónico y aceptar alias.
- Todavía se ven avisos de **iPhone 8, X, XS, XS Max, 7, 6s** en clasificados argentinos
  (Tienda Celular / OLX), pero a precios de $17.000–$82.000 ARS: es chatarra de reventa, no stock
  de reseller. No lo verifiqué contra Apple → ver UNVERIFIED. Lo dejaría fuera del seed inicial y
  lo habilitaría sólo si un tenant lo pide.

### 2. Las 10 líneas más vendidas en reventa argentina — orden del autocomplete

**No existe un ranking oficial de "reventa de iPhone en Argentina".** Lo que hice fue triangular
cuatro fuentes con datos duros de 2026:

1. **Catálogo "iPhone Tester" de OMNITECH (AR)**, **29 SKUs**, contados contra la Store API de la
   propia tienda (`omnitech.ar/wp-json/wc/store/v1/products?category=84&per_page=100` → `n=29`,
   consultada 2026-08-27). Composición por familia: iPhone 15/15 Pro/15 Pro Max = **8** ·
   iPhone 13/13 Pro/13 Pro Max = **6** · iPhone 14/14 Pro/14 Pro Max = **6** ·
   iPhone 12/12 Pro = **4** · iPhone 11 = **2** · iPhone 16 Pro/16 Pro Max/16e = **3**.
   `8+6+6+4+2+3 = 29` ✅. **13 y 14 empatan** en este catálogo: el desempate para el `sort_rank`
   sale de las otras fuentes, no de acá. (Una versión anterior de este doc decía "13 = 7", que
   sumaba 30 ≠ 29. Corregido.)
2. **Hey! Shop (AR, "usados premium")**, listado consultado 2026-08-27: de los **12 títulos de
   producto** que devuelve la página, **7 son familia iPhone 13** (6 × iPhone 13 128 GB +
   1 × 13 mini 128 GB), **4 son familia 14** (14 × 2, 14 Plus, 14 Pro) y 1 es SE 128 GB. Todos
   con el **% de batería en el título** (80, 82, 83, 85, 89, 100 %). Es la señal más fuerte a
   favor del iPhone 13 en el puesto #1.
3. **Ventaconcretada (AR, "iPhone usados")**, **7** ítems marcados `MÁS VENDIDO` (verificado hoy:
   `grep -o 'MÁS VENDIDO' | wc -l` → 7): 14 Pro 256 ($687.000) · 14 Pro Max 256 ($747.000) ·
   14 Pro Max 512 ($827.000) · 15 128 ($747.000) · 16 256 ($1.047.000) · 17 256 ($1.287.000) ·
   16 Pro Max 512 ($1.467.000). El `iPhone 16 Pro 128GB USADO` existe en el catálogo pero **sin**
   ese tag: lo sacé de la lista. Catálogo vivo → puede rotar.
4. **Ámbito (20/04/2026)** sobre reacondicionados: gama de entrada = **SE 3ª gen / iPhone 11**
   ($200.000–$300.000 ARS); gama media = **iPhone 13 128 GB** ($570.000–$660.000) e **iPhone 14**
   (~$630.000); tope = **iPhone 17 Pro Max** ($2.280.000).
5. **MercadoLibre AR, vía Cultura Geek (publicado 06/06/2026, `datePublished` verificado)**: el
   iPhone más vendido de la plataforma es el **iPhone 17 de 256 GB** ($2.199.999, 12 cuotas sin
   interés). Cita textual de la nota: *"Otros de los modelos de Apple que están dentro de los más
   vendidos son el iPhone 13 (considerado uno de los mejores de los últimos años), el iPhone 14 y
   el 17 Pro Max"*. **La nota NO publica un ranking general numerado de iPhone**: el único "puesto"
   que menciona es *"el primer puesto en general… es el Moto G15 SE"*. Una versión anterior de este
   doc afirmaba "iPhone 13 en el puesto 11 del ranking general" — **esa cifra no está en ninguna de
   las fuentes citadas y quedó borrada** (ver §UNVERIFIED).

**Orden propuesto para `sort_rank` del autocomplete:**

| # | Línea | Por qué |
|---|---|---|
| 1 | iPhone 13 | **7 de 12** ítems del usado premium de Hey! Shop; referencia de gama media en Ámbito ($570.000–660.000); nombrado primero entre los "otros más vendidos" de Apple en ML |
| 2 | iPhone 14 | empata al 13 en el tester de OMNITECH (6 SKUs) y suma 3 de los 7 `MÁS VENDIDO` de Ventaconcretada; escalón de precio inmediato arriba |
| 3 | iPhone 15 | familia con más SKUs en el catálogo tester AR (**8 de 29**) |
| 4 | iPhone 14 Pro / 14 Pro Max | el Pro usado más rotado (Negro espacial / Grafito) |
| 5 | iPhone 12 | piso de "iPhone moderno" barato, mucho canje |
| 6 | iPhone 11 | gama de entrada según Ámbito; sigue vivo |
| 7 | iPhone 13 Pro / 13 Pro Max | tester a USD 560 en AR, muy líquido |
| 8 | iPhone 15 Pro / 15 Pro Max | Pro reciente, precio de canje alto |
| 9 | iPhone 16 / 16 Pro / 16 Pro Max | equipo nuevo/CPO, no usado todavía |
| 10 | iPhone 17 / 17 Pro Max | sellado; el 17 256 GB es el iPhone #1 en ML AR |

Debajo de eso: SE 3ª, 16e, 14 Plus, 12 Pro/Pro Max, 13 mini, XR, iPhone Air, 17e.

**Recomendación de producto:** el orden fijo es sólo el *cold start*. El `sort_rank` global tiene
que ser un default, y el orden real debe reordenarse por **frecuencia de uso del propio tenant**
(un reseller que vive del 11 y el 12 no quiere ver el 17 Pro Max primero). Eso es una columna de
contador por tenant, no un modelo de ML.

### 3. iPad, Apple Watch y Mac en el stock de un reseller de celulares

Volumen bajo y muy concentrado. Evidencia de dos comercios AR (OMNITECH y un reseller de
**Neuquén Capital**, que es literalmente el ICP):

**iPad** — reseller de Neuquén: un solo SKU publicado (`iPad (A16) Wi-Fi 128 GB`, USD 500).
OMNITECH lista 16 SKUs pero con sólo 6 en stock: iPad 11ª gen 10.9" 128 GB Wi-Fi (USD 590),
iPad 11 A16 10.9" 256 GB (USD 680), iPad Air M4 11" (USD 870), iPad Air M4 13" 128 GB (USD 1.050),
iPad Pro M5 11" 256 GB (USD 1.350), iPad Pro M5 13" 256 GB (USD 1.480). El iPad mini 7ª gen y el
iPad 10ª gen figuran sin stock. Familias vivas en apple.com/la: iPad Pro, iPad Air, iPad, iPad mini.

**Apple Watch** — la categoría con más rotación después del iPhone. Reseller de Neuquén: Watch SE 3
40 mm (USD 360), Series 11 42 mm (USD 470–500), Series 11 46 mm (USD 500–600), Series 9 41 mm
Cellular (USD 490), Watch SE 2ª gen 40 mm Cellular seminuevo (USD 390), Ultra 3 49 mm Titanio negro
(USD 890). OMNITECH: SE 3 (USD 365), Series 11 42 mm (USD 485), Series 11 46 mm (USD 515), Ultra 3
49 mm + Cell (USD 840). Familias vivas en apple.com/la/watch: **Series 11, SE 3, Ultra 3** (+ Nike).
**El eje que importa es `mm` (40/41/42/44/45/46/49) + `GPS vs Cellular`**, no la capacidad.

**Mac** — cola larga real. Reseller de Neuquén: `MacBook Neo 13"` 256 GB (USD 980), 512 GB
(USD 1.000), 256 GB seminuevo (USD 950), `Mac mini M2 512 GB / 8 GB` (USD 960). OMNITECH "Macs
Openbox": **44 SKUs** (Store API `category=89`, 2026-08-27) pero **3 en stock** — MacBook Air 13.3" 2020 i7 16/512 (USD 550), MacBook Air M1
13" 256 GB (USD 650), MacBook Pro M1 Pro 14" 16/512 (USD 1.050). **`MacBook Neo` es un producto
Apple real y vigente**, listado en apple.com/la/mac como la Mac de entrada ("Toda la magia de la
Mac a un precio sorprendente").

**Conclusión de modelado:** iPad/Watch/Mac son **~10–16 SKUs por tenant**, con ejes distintos al
iPhone (chip + pulgadas para Mac/iPad; mm + GPS/Cellular para Watch). No merecen el mismo
autocomplete rico. Una tabla `catalog_models` con `family` (`iphone` / `ipad` / `watch` / `mac` /
`airpods` / `accessory`) y `attributes jsonb` alcanza; lo caro sería hacer 4 UIs distintas.

### 4. Accesorios que se venden por lote — mix típico

Hay **dos canastas distintas** y conviene no mezclarlas:

**A. Accesorio Apple original / OEM (alto ticket, se vende junto al equipo).** Del catálogo de dos
resellers AR: AirPods 4 (USD 210–250), AirPods Pro 3 (USD 320–350), AirPods Max (USD 590–650),
cargador Apple 20W USB-C OEM, cargador MacBook 87W USB-C OEM (USD 85), MagSafe Charger (USD 20),
cable USB-C a USB-C (USD 50), Apple Pencil Pro (USD 190). **Los AirPods son, lejos, el accesorio de
mayor rotación** — son el único "accesorio" que aparece en los tres catálogos que revisé.

**B. Accesorio genérico de mayorista (bajo ticket, se compra por lote de 10/50/100).** Las
subcategorías de un mayorista AR de accesorios son **9** (verificado hoy sobre los slugs del nav de
`distriland.com.ar/accesorios-para-celulares/`): auriculares manos libres, **baterías externas
(power banks)**, cables de datos USB, cargadores para auto y pared, films protectores de pantalla,
fundas y estuches, memorias, parlantes, soportes. Una versión anterior de este doc decía
"exactamente 8" y se comía **baterías externas**, que es de las de mayor rotación en lote. Los productos destacados son **vidrios templados, cables USB,
cargadores de pared y fundas TPU**.

**Patrón comercial confirmado (importa para el DTO público):** el reseller **regala el kit con el
equipo**. Un comercio de Neuquén publica que cada unidad —nueva o usada— sale con **cargador 20W +
cable + funda**; otro de Cipolletti/Neuquén incluye "cargador completo y funda con cada compra, sea
usado o nuevo". Es decir: el accesorio no es sólo SKU, es **argumento de venta del equipo**.

Implicancia para `unidad vs lote`: el iPhone se vende **por unidad con serie/IMEI**; el accesorio
genérico se vende **por lote sin serie** (cantidad + precio unitario). Los AirPods están en el
medio: tienen número de serie y garantía, pero se cargan como stock fungible por color.

### 5. Vocabulario de condición del mercado argentino

| Término AR | Qué significa en la práctica | Batería | Garantía típica | Enum iStock |
|---|---|---|---|---|
| **Sellado** | Caja de fábrica cerrada, blister intacto, nunca activado. Si es nacional/homologado, garantía Apple 12 meses. | 100 % | 12 meses (oficial) | `sealed` |
| **Open box** / "caja abierta" | Definición textual de iProfesional (17/09/2025) sobre la etiqueta de ML AR: *"celulares que fueron vendidos en algún momento, exhibidos en tiendas, o devueltos por un comprador, pero que no fueron usados de forma prolongada ni presentan daños funcionales o estéticos significativos"*. **Ahorro observado en esa nota: 15–53 %** (Samsung A24 15 %, Samsung A15 32 %, Tecno Spark 32 %, TCL 501 53 % — **la muestra no incluye iPhone**). | *"batería en condiciones óptimas"* (la fuente **no** da un %) | *"en muchos casos… conservan la garantía oficial del fabricante vigente"*; si no, la del comercio. **Sin número de días verificado** | `open_box` |
| **Tester A+** | Equipo de exhibición / trade-in de tienda oficial, **testeado punta a punta** y clasificado A+. Definición operativa que publican los mayoristas AR: **batería > 85 %, pantalla original, Face ID funcional, estéticamente impecable**, listo para reventa directa. | > 85 % | **30 días** | `tester_a_plus` |
| **Usado excelente** / "usado premium" / "impecable" / "sin detalles" | Usado real, funcionando 100 %, sin marcas visibles. En el aviso se publica el **% de batería en el título**. Rango observado 80–100 %. | 80–100 % declarada | **90 días** | `used_excellent` |
| **Usado con detalle** | Funciona 100 % pero tiene **"detalle estético"**: rayón, golpe en marco, mancha en pantalla. Es el término que usa el vendedor para bajar el precio sin decir "roto". Equivale a Grado B/C. | variable, se declara | **sin dato verificado** (el rango "30–90 días" de la versión anterior no tenía fuente → §UNVERIFIED) | `used_with_detail` |

**Otros términos frecuentes que conviene aceptar como sinónimos en el buscador/chatbot:**

- **Seminuevo** — usado en buen estado; lo usa el reseller de Neuquén como su única etiqueta de
  usado ("Seminuevo" vs "Nuevo").
- **CPO** (Certified Pre-Owned) — usado certificado; convive con "Tester" en el mismo catálogo AR.
- **Reacondicionado / refurbished** con **grados A / B / C** por desgaste estético: A = como nuevo,
  B = marcas leves, C = marcas visibles pero 100 % funcional.
- **ASIS / "as-is nuevo en caja"** — se vende sin garantía, tal cual está.
- **Libre** — desbloqueado de operador. En AR es casi siempre implícito, pero se escribe igual.
- **Nacional** vs **importado** — ver punto 6.
- **Con caja y accesorios** / **sin caja**.

⚠ **Contradicción de fuentes, y cuál pesa más.** Buscando "iPhone tester" aparecen dos
definiciones incompatibles: (a) una unidad de ingeniería/QA de Apple con hardware o software no
comercial, y (b) equipo de exhibición o trade-in reacondicionado y clasificado. **Para Argentina
vale (b)**, y la evidencia es directa: los catálogos "iPhone Tester" de comercios argentinos
listan modelos y colores **de retail normal** (iPhone 13 128 GB Azul/Medianoche/Rosa a USD 420,
13 Pro Max 128 GB Verde alpino/Azul Sierra a USD 560) y los mayoristas publican el criterio A+
(batería > 85 %, pantalla original, Face ID OK). Una unidad de ingeniería de Apple no se vende en
5 colores ni tiene lista de precios por volumen. La interpretación (a) es un calco del inglés y
**no describe lo que se transa acá**.

### 6. Qué mira un comprador argentino antes de escribir por WhatsApp

La lista de la consigna (batería %, pantalla original, iCloud, procedencia, garantía) **se
confirma**, y hay evidencia de cómo se publica cada dato:

1. **Batería %** — ✅ **confirmado, es el dato #1**. Un vendedor AR de usados lo mete literalmente
   en el título del producto: `iPhone 13 - 128GB - MIDNIGHT - 82% BAT - USADO PREMIUM`,
   `iPhone 14 PRO - 128 GB - BLACK - 80% - USADO PREMIUM`. Otro comercio de Neuquén publica
   "iPhone 12 Pro Max 256 GB, seminuevo, 93 % batería, USD 550". Hasta los clasificados sueltos lo
   ponen: "IPHONE 11 USADO (88 DE BATERIA)". **Esto tiene que ser un campo numérico obligatorio en
   `used_*`, no texto libre, y tiene que estar en el título del aviso exportable.**
2. **Pantalla original** — ✅ confirmado. Es una de las cuatro condiciones explícitas del estándar
   A+ mayorista ("pantalla original"). Booleano.
3. **iCloud** — ✅ confirmado como concepto, pero en el aviso AR se escribe como **"libre"** y como
   **"Face ID funcional"**. Sugerencia: campo de texto corto ("Sin cuenta iCloud / libre de
   iCloud") + booleano `face_id_ok`, porque el comprador de Pro pregunta por Face ID tanto como por
   iCloud.
4. **Procedencia (nacional / importado)** — ✅ confirmado, y es más fuerte de lo que parece: todo
   celular que se venda legalmente en Argentina debe estar **homologado por ENACOM e inscripto en
   RAMATEL**, y el propio ENACOM recomienda al comprador **pedir el IMEI (`*#06#`) y consultarlo en
   `enacom.gob.ar/imei`** antes de cerrar. "Nacional" implica en la práctica factura A/B + garantía
   oficial 12 meses; "importado" implica garantía del comercio.
5. **Garantía** — ✅ confirmado que es un dato que el aviso publica, con **dos escalones bien
   soportados** y **uno flojo**: 12 meses (sellado nacional / "garantía oficial Apple a través de
   partners autorizados") · **90 días** (usado premium, textual en heyshop.com.ar/usados) ·
   **30 días** (tester A+) **con una sola fuente y de un solo comercio** → ver §UNVERIFIED.
   Debería ser un campo `warranty_days` **editable** con default por condición, no prosa.

**Lo que hay que AGREGAR a la lista (aparece en avisos reales y no estaba):**

6. **Si incluye caja, cargador y funda.** Dos comercios del Alto Valle lo publican como beneficio
   central ("cargador 20W + cable + funda con cada unidad, nueva o usada").
7. **Medios de pago y financiación, con nombre propio.** Los avisos AR listan: pesos, dólares,
   transferencia, **USDT**, y cuotas. Los tres escalones **verificados hoy** en
   `iphoneneuquen.online/stock-iphone.php` son exactamente: **6 sin interés** (Visa / Mastercard /
   Naranja, "NO Naranja X") · **12 sin interés sólo con tarjetas del Banco Nación** · **12 cuotas
   fijas** (Visa / Mastercard / Naranja), más **descuento por efectivo o transferencia** (el precio
   USD aplica sólo a ese medio). **No existe ningún escalón de "20 cuotas"** en las fuentes
   citadas: la versión anterior decía "12/20 cuotas fijas" y era falso. Esto es tan decisorio como
   el precio y el CLAUDE.md ya lo tiene en la ficha mínima: hay que respetarlo, no recortarlo.
8. **Canje / plan trade-in sí o no**, ya previsto en el CLAUDE.md y confirmado en los tres
   comercios del Alto Valle que revisé.

**Lo que NO hay que mostrar (y la evidencia lo respalda):** el IMEI. ENACOM le pide al **comprador**
que le pida el IMEI **al vendedor en persona**; nadie lo publica en la vitrina. Publicar IMEI en una
página indexable es regalarle a un tercero el número para clonar. Consistente con `CLAUDE.md` §2.

---

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| Líneas de iPhone verificadas contra Apple | 32 | líneas | Apple es-LAMR (todas las fichas listadas en Fuentes) |
| Combinaciones línea × capacidad | 101 | filas | cálculo sobre la tabla del punto 1 |
| Combinaciones línea × capacidad × color | 453 | filas | cálculo sobre la tabla del punto 1 |
| Capacidad mínima iPhone 15 Pro Max / 16 Pro Max | 256 | GB | support.apple.com/kb/SP904?locale=es_LAMR · /es-lamr/121032 |
| Capacidad mínima línea iPhone 17 | 256 | GB | support.apple.com/es-lamr/125089 |
| Capacidad máxima del catálogo (sólo 17 Pro Max) | 2 | TB | support.apple.com/125091 |
| Última línea con 64 GB | iPhone 12 / SE 3ª | — | support.apple.com/kb/SP830 · SP867 (es_LAMR) |
| Batería mínima para grado "A+" (mayorista AR) | 85 | % | goldencelulares.com.ar |
| Garantía publicada por **un** comercio AR para tester | 30 | días | [instagram.com/cdworldgames — post del 23/01/2025](https://www.instagram.com/cdworldgames/p/DFLvK1zxnJG/) — **una sola tienda, no un estándar** → §UNVERIFIED |
| Garantía típica "usado premium" AR | 90 | días | heyshop.com.ar/usados |
| Rango de batería publicado en usados AR | 80–100 | % | heyshop.com.ar/usados |
| Precio tester AR — iPhone 13 128 GB | 420 | USD | omnitech.ar (iPhone Tester) |
| Precio tester AR — iPhone 13 Pro Max 128 GB | 560 | USD | omnitech.ar |
| Precio tester AR — iPhone 14 Pro Max 128 GB | 660 | USD | omnitech.ar |
| Precio tester AR — iPhone 15 128 GB | 550 | USD | omnitech.ar |
| Precio tester AR — iPhone 15 Pro 128 GB | 690 | USD | omnitech.ar |
| Precio sellado AR — iPhone 17 256 GB | 1.000 | USD | omnitech.ar (iPhone) |
| Precio sellado AR — iPhone 17 Pro Max 256 GB | 1.400 | USD | omnitech.ar |
| Precio usado Neuquén — iPhone 12 Pro Max 256 GB, 93 % bat | 550 | USD | iphoneneuquen.online/stock-iphone.php |
| Precio usado Neuquén — iPhone 14 Pro 128 GB Grafito, 100 % bat | 590 | USD | iphoneneuquen.online/stock-iphone.php |
| iPhone reacondicionado gama entrada AR (SE 3ª / 11) | 200.000–300.000 | ARS | ambito.com, 20/04/2026 |
| iPhone 13 128 GB reacondicionado AR | 570.000–660.000 | ARS | ambito.com, 20/04/2026 |
| iPhone 17 Pro Max reacondicionado AR (tope) | 2.280.000 | ARS | ambito.com, 20/04/2026 |
| iPhone más vendido en MercadoLibre AR | iPhone 17 256 GB | — | culturageek.com.ar, **06/06/2026** (`datePublished` verificado) |
| Precio de lista de ese iPhone 17 256 GB en ML AR | 2.199.999 | ARS | culturageek.com.ar, 06/06/2026 |
| Ahorro "caja abierta" vs nuevo en ML AR (muestra sin iPhone) | 15–53 | % | iprofesional.com/tecnologia/437248, 17/09/2025 |
| Subcategorías de accesorio en mayorista AR | 9 | categorías | distriland.com.ar/accesorios-para-celulares (slugs del nav, 2026-08-27) |
| SKUs de iPad con stock real en reseller AR | 6 de 16 | SKUs | omnitech.ar (iPad) |
| SKUs de Mac con stock real en reseller AR | 3 de 44 | SKUs | omnitech.ar Store API `category=89` (2026-08-27) |
| SKUs de iPad sin stock en ese mismo reseller | 10 de 16 | SKUs | omnitech.ar Store API `category=92` (2026-08-27) |

---

## Fuentes

**Primarias (Apple) — capacidades y colores, consultadas 2026-08-27**

- [Cómo identificar el modelo de iPhone](https://support.apple.com/es-lamr/108044) — índice de todas las fichas
- [iPhone XR](https://support.apple.com/kb/SP781?locale=es_LAMR) · [iPhone SE 2ª gen](https://support.apple.com/kb/SP820?locale=es_LAMR)
- [iPhone 11](https://support.apple.com/kb/SP804?locale=es_LAMR) · [11 Pro](https://support.apple.com/kb/SP805?locale=es_LAMR) · [11 Pro Max](https://support.apple.com/kb/SP806?locale=es_LAMR)
- [iPhone 12 mini](https://support.apple.com/kb/SP829?locale=es_LAMR) · [12](https://support.apple.com/kb/SP830?locale=es_LAMR) · [12 Pro](https://support.apple.com/kb/SP831?locale=es_LAMR) · [12 Pro Max](https://support.apple.com/kb/SP832?locale=es_LAMR)
- [iPhone 13 mini](https://support.apple.com/kb/SP847?locale=es_LAMR) · [13](https://support.apple.com/kb/SP851?locale=es_LAMR) · [13 Pro](https://support.apple.com/kb/SP852?locale=es_LAMR) · [13 Pro Max](https://support.apple.com/kb/SP848)
- [iPhone SE 3ª gen](https://support.apple.com/kb/SP867?locale=es_LAMR)
- [iPhone 14](https://support.apple.com/kb/SP873?locale=es_LAMR) · [14 Plus](https://support.apple.com/kb/SP874?locale=es_LAMR) · [14 Pro](https://support.apple.com/es-lamr/111849) · [14 Pro Max](https://support.apple.com/kb/SP876)
- [iPhone 15](https://support.apple.com/kb/SP901?locale=es_LAMR) · [15 Plus](https://support.apple.com/kb/SP902?locale=es_LAMR) · [15 Pro](https://support.apple.com/kb/SP903?locale=es_LAMR) · [15 Pro Max](https://support.apple.com/kb/SP904)
- [iPhone 16](https://support.apple.com/es-lamr/121029) · [16 Plus](https://support.apple.com/es-lamr/121030) · [16e](https://support.apple.com/es-lamr/122208) · [16 Pro](https://support.apple.com/es-lamr/121031) · [16 Pro Max](https://support.apple.com/121032)
- [iPhone 17](https://support.apple.com/es-lamr/125089) · [17 Pro](https://support.apple.com/es-lamr/125090) · [17 Pro Max](https://support.apple.com/125091) · [iPhone Air](https://support.apple.com/es-lamr/125092) · [17e](https://support.apple.com/es-lamr/126470)
- [Apple — Mac (LatAm)](https://www.apple.com/la/mac/) — confirma **MacBook Neo** como Mac de entrada vigente
- [Apple — Apple Watch (LatAm)](https://www.apple.com/la/watch/) — Series 11 · SE 3 · Ultra 3
- [Apple — iPad (LatAm)](https://www.apple.com/la/ipad/) — iPad Pro · Air · iPad · mini

**Mercado argentino — catálogos y precios reales, consultados 2026-08-27**

- [OMNITECH — iPhone Tester](https://omnitech.ar/categoria/productos/iphone-tester/) — 29 SKUs, precios USD
- [OMNITECH — iPhone](https://omnitech.ar/categoria/productos/iphone/) · [iPad](https://omnitech.ar/categoria/productos/ipad/) · [Watch](https://omnitech.ar/categoria/productos/watch/) · [Macs Openbox](https://omnitech.ar/categoria/productos/macs-openbox/) · [Accesorios](https://omnitech.ar/categoria/productos/accesorios/)
- [iPhone Neuquén Online — stock iPhone](https://www.iphoneneuquen.online/stock-iphone.php) — **reseller del ICP**, condición "Seminuevo/Nuevo", batería %, USD
- [iPhone Neuquén Online — productos Apple](https://www.iphoneneuquen.online/productos-apple.php) — Watch, iPad, MacBook Neo, AirPods
- [Dr.iPhone Neuquén](https://iphoneneuquen.com/productos/) — canje, pago en ARS/USD/transferencia/USDT, garantía 12 meses
- [Hey! Shop — iPhones usados premium](https://heyshop.com.ar/usados/) — batería % en el título, garantía 90 días
- [Ventaconcretada — iPhone usados](https://www.ventaconcretada.com/categoria-producto/apple/iphone-usados/) — ítems marcados "MÁS VENDIDO", ARS
- [Golden Celulares — mayorista AR](https://www.goldencelulares.com.ar/) — define **A+**: batería > 85 %, pantalla original, Face ID funcional
- [Tienda Celular Argentina — iPhone](https://argentina.tiendacelular.com/iphone) — clasificados, muestra la cola larga (6s, 8, XS) y "88 de batería"
- [DistriLand — accesorios para celulares por mayor](https://www.distriland.com.ar/accesorios-para-celulares/) — consultado 2026-08-27. Las **9** subcategorías del lote (incluye `baterias-externas`)

**Prensa y contexto argentino 2026**

- [Ámbito — Cuánto sale un iPhone reacondicionado en 2026](https://www.ambito.com/economia/cuanto-sale-un-iphone-reacondicionado-2026-vale-la-pena-n6268773) — 20/04/2026, rangos ARS y grados A/B/C
- [Cultura Geek — smartphones más vendidos en Argentina 2026](https://culturageek.com.ar/smartphones-mas-vendidos-argentina-2026/) — **06/06/2026**, consultado 2026-08-27. iPhone 17 256 GB como iPhone #1 en ML AR. **No publica ranking general numerado de iPhone**
- [Río Negro — los 3 modelos que lideran las ventas en ML Argentina](https://www.rionegro.com.ar/tendencias/celulares-baratos-en-2026-los-3-modelos-que-lideran-las-ventas-en-mercado-libre-argentina-4426259/) — 06/01/2026
- [ENACOM — IMEI](https://www.enacom.gob.ar/imei) — consulta pública de IMEI antes de comprar usado
- [iProfesional — qué son los celulares con "caja abierta"](https://www.iprofesional.com/tecnologia/437248-que-son-los-celulares-baratos-con-caja-abierta-que-vende-mercado-libre) — publicado **17/09/2025** (`datePublished` en el JSON-LD), consultado 2026-08-27. Definición de open box en ML AR + ahorros 15/32/53 %
- [CDWORLD — post "iPhone Tester con garantía de 30 días"](https://www.instagram.com/cdworldgames/p/DFLvK1zxnJG/) — post del **23/01/2025**, consultado 2026-08-27. **Única** fuente del "30 días" y es **un solo comercio**
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — consultado 2026-08-27. *"A table in an exposed schema without RLS is readable and writable by any role with a grant on it. Enable RLS on every table in an exposed schema."*

---

## Impacto en iStock

**ARCHITECTURE**

- `catalog_models` no es una lista plana de strings. Debe ser **una fila por línea** con
  `family` (`iphone`|`ipad`|`watch`|`mac`|`airpods`|`accessory`), `line_name`, `release_year`,
  `capacities_gb int[]`, `colors_es text[]`, `sort_rank int`. **32 filas de iPhone**, no 453. La
  expansión a 453 se hace en el cliente al elegir línea → GB → color. Esto evita 453 filas ×
  N tenants y mantiene el autocomplete en un fetch chico y cacheable.
- `catalog_models` es **catálogo global, sin `tenant_id`**: es dato público de Apple, sin PII y sin
  tenant leak posible. Es la excepción **sólo a la columna `tenant_id`**, **NO a la RLS**.
  `CLAUDE.md` §7 dice "Sin RLS no hay merge" y acá aplica igual: en un único proyecto Supabase
  expuesto por PostgREST, una tabla sin RLS con grants a `anon`/`authenticated` es **escribible
  desde el browser con la anon key**, y cualquiera podría ensuciar el autocomplete de **todos** los
  tenants. Fuente primaria: docs de Supabase — *"A table in an exposed schema without RLS is
  readable and writable by any role with a grant on it. Enable RLS on every table in an exposed
  schema."* (consultado 2026-08-27). **Recomendación literal para el `db-agent`:**

  ```sql
  alter table catalog_models enable row level security;
  create policy catalog_models_read on catalog_models for select using (true);
  revoke insert, update, delete on catalog_models from anon, authenticated;
  ```

  Escritura sólo por seed/migración con `service_role`. **La ausencia de `tenant_id` necesita una
  decisión explícita del architect**; la RLS read-only **no es negociable**.
- El **orden del autocomplete** necesita dos niveles: `sort_rank` global (el top-10 de arriba) +
  un contador de uso por tenant. Una tabla chica `tenant_model_usage(tenant_id, model_id, uses)`
  con RLS, actualizada al publicar. Sin ML, sin embeddings extra.
- **Watch y Mac no encajan en `capacities_gb`**: Watch se indexa por `size_mm` + `connectivity`
  (GPS/Cellular), Mac por `chip` + `screen_inches` + `ram_gb` + `ssd_gb`. Recomiendo
  `attributes jsonb` validado por Zod **por familia**, en vez de 4 tablas.

**DECISIONS (candidatos a ADR)**

1. **La capacidad es validación dura, no sugerencia.** `assertValidCapacity(line, gb)` en
   `packages/domain` (TS puro, cero I/O) con test de los 5 casos trampa: 14 Pro 64 GB → rechaza ·
   15 Pro Max 128 GB → rechaza · 17 128 GB → rechaza · 17 Pro Max 2 TB → acepta ·
   13 64 GB → rechaza. Sin esto, el catálogo se ensucia en la primera semana.
2. **Colores canónicos en es-LAMR + tabla de alias.** Guardar `Grafito` como canónico y aceptar
   `Graphite`, `grafito`, `gris grafito` en el input y en el chatbot. Lo mismo con
   `(PRODUCT)RED` ↔ `Rojo` ↔ `Product Red`, `Medianoche` ↔ `Midnight`, `Blanco estelar` ↔
   `Starlight`. El chatbot recibe consultas en el español del cliente, no en el de Apple.
3. **`warranty_days` como número editable, con default por condición y calidad de evidencia
   desigual** (esto último importa: no todos los defaults valen lo mismo):
   - `sealed` **365** — garantía oficial Apple vía partner autorizado. Evidencia: alta.
   - `used_excellent` **90** — *"90 días de garantía"* textual en heyshop.com.ar/usados. Alta.
   - `tester_a_plus` **30** — evidencia **débil**: un solo comercio AR (post de IG del 23/01/2025).
     Ver §UNVERIFIED. Sembrarlo como default **editable**, nunca como constante de dominio.
   - `open_box` **sin default duro**: la fuente dice *"en muchos casos conservan la garantía oficial
     del fabricante vigente"*, sin número. Heredar 365 **sólo si** el dueño marca "conserva
     garantía de fábrica"; si no, pedir el número.
   - `used_with_detail` **sin default verificado**: usar el mismo que `used_excellent` (90) como
     conveniencia de UI, marcándolo como suposición, no como dato de mercado.
   Hoy la garantía es texto libre en la ficha mínima; con esto es un número comparable.
4. **`battery_pct` obligatorio y numérico para `tester_a_plus`, `used_excellent`,
   `used_with_detail`.** Es el dato #1 del comprador argentino y va **en el título del copy
   exportable a estados de IG/WA**, no escondido en la ficha.
5. **Agregar a la ficha pública dos campos ya presentes en el mercado**: `incluye_accesorios`
   (caja/cargador/funda) y `medios_de_pago` con USDT como opción real. No es scope creep: los tres
   comercios del Alto Valle que revisé lo publican y `CLAUDE.md` ya exige medios de pago.
6. **`used_excellent` se muestra al público como "Usado premium"**, no como "Usado excelente".
   Es el término que ya usa el mercado y el que el comprador reconoce. El enum interno no cambia.
7. **El enum de subtipo de `accessory` son 9 valores, no 8.** El que faltaba es
   **`power_bank` (baterías externas)** — es de las categorías de mayor rotación por lote en el
   mayorista AR y no se puede omitir del seed: `headset` · `power_bank` · `usb_cable` ·
   `charger` · `screen_protector` · `case` · `memory` · `speaker` · `mount`.
8. **No sembrar iPhone anteriores al XR** (8, X, XS, XS Max, 7, 6s) en V1. Existen en clasificados
   pero no en stock de reseller, y no los verifiqué contra Apple.

**COST**

- Seed de catálogo: **~32 filas iPhone + ~16 filas iPad/Watch/Mac/AirPods ≈ 50 filas**, una sola
  vez, versionado en git. Peso despreciable en Postgres.
- **Embeddings: ~50 vectores, una sola vez en el seed** (consistente con `CLAUDE.md` §3: embeddings
  sólo en seed/update de `catalog_models`). Si en cambio se expandiera a 453 filas
  línea×GB×color, serían **453 embeddings y 9× el costo y el peso del índice pgvector para
  cero ganancia semántica** — el color no cambia el significado. **Recomendación explícita: NO
  expandir. Embeber la línea, filtrar GB/color con SQL.**
- Autocomplete: `catalog_models` es global e inmutable → **cachear en CDN / RSC con revalidate
  largo**. Cero hits a Postgres por tecleo. Un autocomplete que pega a la DB por keystroke sería
  exactamente el "costo tonto" que veta el `cost-auditor`.
- Sin egress nuevo, sin jobs nuevos, sin tokens nuevos en el hot path.

---

## Confianza

**Media-alta**, desagregada porque las partes no valen lo mismo. **Esta versión incorpora las
correcciones de un review adversarial**: se borró una cifra que no estaba en la fuente ("iPhone 13
en el puesto 11"), se corrigieron tres números contra la fuente primaria (open box 10–30 % → 15–53 %;
DistriLand 8 → 9 subcategorías; OMNITECH familia 13: 7 → 6 SKUs) y se eliminó un escalón de
financiación inexistente ("20 cuotas").

- **Capacidades y colores (punto 1): alta.** Fuente primaria de Apple, ficha por ficha, en es-LAMR.
  32 de 32 líneas verificadas una por una. Lo que bajaría esto: nada razonable; lo único pendiente
  es XS/XS Max, que dejé fuera a propósito.
- **Vocabulario de condición (punto 5): media-alta.** La definición operativa de A+ (batería > 85 %,
  pantalla original, Face ID, estética) viene de un mayorista argentino y es consistente con lo que
  publican los comercios. Lo que la subiría: la lista de precios por WhatsApp de 2–3 mayoristas AR
  (Golden, AppleTrade) con su propia grilla de grados escrita.
- **Datos que mira el comprador (punto 6): alta.** Batería % en el título del aviso está evidenciado
  en tres comercios AR independientes y hasta en clasificados sueltos. ENACOM es fuente oficial.
- **Top 10 (punto 2): media-baja, y bajó tras el review.** No existe ranking público de reventa de
  usados en Argentina. Es triangulación de 5 fuentes con datos de 2026 y coinciden en el núcleo
  (13, 14, 15 arriba; 11 y 12 como piso; 17 como sellado #1), pero el **orden exacto entre los
  puestos 4 y 10 es opinión fundada, no medición**. Además: en el catálogo tester de OMNITECH
  **13 y 14 empatan a 6 SKUs**, así que el #1 del 13 se sostiene principalmente en Hey! Shop
  (7 de 12 ítems) y en Ámbito, no en OMNITECH. **Los puestos 1 y 2 son intercambiables** sin que
  cambie nada del producto — otra razón para que el orden sea data-driven por tenant. Lo que la subiría: (a) el ranking real de `catalog_models` más usados en
  nuestros propios tenants después de 30 días —esta es la razón principal para hacer el orden
  data-driven desde el día 1—; (b) acceso al ranking de MercadoLibre AR filtrado por condición
  "usado" (la API pública `api.mercadolibre.com/sites/MLA/search` devuelve **403** hoy, y
  `listado.mercadolibre.com.ar` bloquea el fetch, así que no pude medirlo directo).
- **Mix de iPad/Watch/Mac y accesorios (puntos 3 y 4): media.** Basado en 3 comercios argentinos,
  dos de ellos del Alto Valle. Muestra chica pero muy alineada con el ICP. Lo que la subiría:
  el inventario real de un tenant piloto en Cipolletti.

## Refutaciones al review

Acepto 9 de 9 findings. Dos precisiones, **con evidencia**, sobre datos que el propio review trajo:

- El review sugiere citar la nota de open box como **"iProfesional, 19/08/2026"**. El `datePublished`
  del JSON-LD de esa URL es **`2025-09-17T07:09:00-03:00`**, y el `dateModified` es el mismo. En el
  doc quedó **17/09/2025**. Reproducir:
  `curl -s -A 'Mozilla/5.0' -L 'https://www.iprofesional.com/tecnologia/437248-que-son-los-celulares-baratos-con-caja-abierta-que-vende-mercado-libre' | grep -o 'datePublished[^,]*'`.
  Esto **debilita** la fuente (es de 2025, no de 2026), no la fortalece: por eso el rango 15–53 %
  queda anotado como no aplicable a iPhone.
- El review dice que el catálogo de Mac de OMNITECH tiene **43** SKUs (número que venía de mi propia
  versión anterior). La Store API devuelve **44** hoy:
  `curl -s 'https://omnitech.ar/wp-json/wc/store/v1/products?category=89&per_page=100' | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` → `44`. Corregido a **3 de 44**.

Nada más. El resto de los findings eran correctos y están aplicados arriba.

## UNVERIFIED

**Bajadas acá por el review adversarial (texto exacto de lo que se afirmaba y motivo):**

- ~~"el iPhone 13 en el puesto 11 del ranking general de celulares" (MercadoLibre AR 2026, vía
  Cultura Geek / iProfesional)~~ — **BORRADO. No existe en ninguna de las dos fuentes atribuidas.**
  Cultura Geek (06/06/2026) no publica ranking general numerado de iPhone y su único "puesto" es el
  Moto G15 SE; el artículo de iProfesional citado es sobre "caja abierta" y ni menciona el iPhone 13.
  Fue una cifra fabricada por atribución: el peor fallo posible de este oficio. Nada del ranking
  depende ya de ella.
- ~~"Precio [open box] típicamente 10–30 % abajo del sellado"~~ — **CORREGIDO a 15–53 %**, que es lo
  que reporta la única fuente de open box del doc (iProfesional, 17/09/2025). Advertencia que sigue
  sin verificar: **esa muestra no tiene ni un iPhone** (Samsung A15/A24, TCL 501, Tecno Spark), así
  que el rango **no es un default de pricing de open box de iPhone**. No usarlo para upsell.
- ~~"~100 % de batería" para `open_box`~~ — la fuente dice *"batería en condiciones óptimas"*, **sin
  porcentaje**. No hay número verificado.
- ~~"Usado con detalle: garantía 30–90 días"~~ — **sin fuente inline ni en la tabla de Números.**
  Sacado del cuerpo. No hay dato de mercado verificado para el `warranty_days` de esta condición.
- ~~"12/20 cuotas fijas"~~ — **el escalón de 20 cuotas no existe** en ninguna fuente citada. Lo
  verificado hoy en iphoneneuquen.online es 6 s/i (Visa/MC/Naranja), 12 s/i (Bco. Nación) y 12 fijas.
- **"Garantía típica tester A+ = 30 días"** — se sostiene en **una** fuente: un post de Instagram de
  **un solo comercio** (`instagram.com/cdworldgames`, 23/01/2025), cuyo texto sí pude leer hoy
  (*"¡Ya llegaron los iPhone Tester! Con garantía de 30 días"*). **No es un estándar de mercado**:
  goldencelulares.com.ar define el grado A+ (batería > 85 %, pantalla original, Face ID funcional,
  estética impecable) pero **no publica días de garantía**; totalynk.com dice "cada equipo sale
  testeado y con garantía" sin número. Tratarlo como default editable, no como constante.
- **"iPhone 16 Pro 128" entre los `MÁS VENDIDO` de Ventaconcretada"** — **sacado**: el SKU existe en
  el catálogo pero hoy no tiene el tag. Los tags son 7, no 8.
- **Composición del catálogo tester de OMNITECH** — corregida a 6 SKUs para la familia 13 (antes
  decía 7, y el desglose sumaba 30 contra 29 declarados). Es un catálogo vivo: el conteo vale para
  2026-08-27 y puede rotar mañana. Lo mismo para los 44 SKUs de Mac y los 16 de iPad.

**Pendientes de origen (ya estaban):**

- **iPhone XS y iPhone XS Max**: aparecen en clasificados argentinos (un aviso "Iphone Xs 64 gb.
  Black." a $82.000 ARS) pero **no verifiqué sus capacidades ni colores contra la ficha de Apple**.
  No sembrar hasta verificar.
- **iPhone 8 / 8 Plus / X / 7 / 6s**: se ven en clasificados AR a $17.000–$37.000 ARS. Capacidades
  y colores **sin verificar**. Fuera del seed V1.
- **Orden exacto de los puestos 4 a 10 del top-10**: es inferencia por triangulación, **no hay
  ranking oficial de reventa de usados en Argentina**. El núcleo (13/14/15 arriba) sí está
  soportado por 5 fuentes.
- **Precios de mayorista argentino por volumen**: los mayoristas (Golden Celulares, AppleTrade)
  publican la lista **sólo por WhatsApp**. No hay URL con la grilla → **sin cifra verificable**.
  Los precios USD que sí cité son de **catálogos minoristas online**, no de lista mayorista.
- **`iPhone S26 Ultra`** aparece listado a USD 1.090 en el stock de un reseller de Neuquén.
  Es casi con seguridad un **Samsung Galaxy S26 Ultra** mal etiquetado por el comercio (Apple no
  tiene ninguna línea "S26"). No lo uso para nada, pero lo dejo anotado porque **muestra que los
  resellers escriben mal los nombres de modelo** — argumento fuerte a favor del autocomplete cerrado.
- **iPad mini 7ª gen, iPad 10ª gen, MacBook Air M2/M3, MacBook Pro M3/M4/M5**: figuran en catálogos
  AR pero **sin stock**. No puedo afirmar que roten hoy.
- **Cotización del dólar en Argentina (~$1.500 ARS)**: mencionado por Río Negro el 06/01/2026.
  **Dato de enero, no de agosto de 2026.** Irrelevante para nosotros —el TC lo setea el dueño por
  tenant— pero no lo tomen como valor vigente.
- **Tamaños en mm y materiales de caja de Apple Watch Series 11 / SE 3 / Ultra 3**: los infiero de
  los catálogos AR (42/46 mm para Series 11, 40 mm para SE 3, 49 mm para Ultra 3).
  `apple.com/la/watch` **no publica los mm en la página de familia** → sin verificar contra fuente
  primaria.
- **Capacidades y configuraciones de `MacBook Neo`**: confirmé que **el producto existe y es la Mac
  de entrada de Apple** (apple.com/la/mac), pero **no verifiqué chip, RAM ni SSD** contra la ficha
  técnica. Los USD 950–1.000 y las configs 256/512 GB salen de un reseller, no de Apple.
