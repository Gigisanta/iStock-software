# Instagram Reels creative 2026
_Consultado: 2026-09-03 · Agente: researcher_

## Pregunta

¿Qué especificaciones y prácticas oficiales vigentes conviene aplicar para publicar un Reel vertical de 15 s, y qué implica cada una para `creative/istock-ad v9`?

## Respuesta corta

- Para el creativo pago de Reels, usar relación **9:16**. Meta recomienda **1.440 × 2.560 px**; una pieza de **15 s** está dentro del rango de duración publicado para anuncios. ([Meta Ads Guide — Instagram Reels](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
- Mantener texto, logotipos y elementos clave fuera de al menos **14% arriba, 35% abajo y 6% a cada lado**; revisar el perímetro de zona segura en Ads Manager. Si hubiera un disclaimer, dejar libre el **40% inferior**. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultados 2026-09-03.)
- Exportar **MP4 o MOV**, video **H.264**, píxeles cuadrados, tasa de fotogramas fija y escaneo progresivo; audio **AAC estéreo de 128 kbps o más**. Los subtítulos son opcionales pero recomendados; el sonido es opcional pero muy recomendado. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
- Para un anuncio, no usar música de la biblioteca licenciada de Instagram: usar audio original o una pista con derechos comerciales, por ejemplo Meta Sound Collection. La biblioteca licenciada se describe como personal/no comercial, mientras que Sound Collection se ofrece para usos comerciales como anuncios. ([Instagram Help Center — música](https://www.facebook.com/help/instagram/402084904469945) — consultado 2026-09-03.)
- Para `creative/istock-ad v9`, conservar la narrativa y convertir estas reglas en un preflight: lienzo 9:16, safe zone visible, formato/codec/audio válidos y derechos de la pista confirmados. La resolución de exportación debe ser una decisión explícita: **1.440 × 2.560 px es recomendación de Meta, no un mínimo de rechazo**; no se debe confundir con el límite de **1 GB** de la API de publicación orgánica. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultados 2026-09-03.)

## Detalle

### Alcance del contrato

El impacto principal es sobre un **anuncio de Instagram Reels** administrado en Ads Manager, porque el artefacto está bajo `creative/istock-ad`. Meta también publica un contrato separado para publicar Reels mediante la API de Instagram. Las cifras de ambos no deben mezclarse:

- La [Guía de anuncios de Meta](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) da el perfil del archivo que se sube como creativo pago: recomendación 9:16, resolución recomendada, safe zone, codecs y límite de archivo del anuncio.
- La colección oficial de [Meta Reels Publishing en Postman](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) describe publicación server-side: la URL del video debe ser pública para que Meta lo descargue y el flujo pasa por contenedor, consulta de estado y publicación. No es el contrato que define el export del anuncio de v9, salvo que el equipo decida además publicar orgánicamente por API.
- La página oficial de requisitos de carga orgánica de Instagram ([Instagram Help Center](https://help.instagram.com/1038071743007909)) no fue recuperable durante esta consulta por respuesta **429**; por eso sus mínimos orgánicos no se usan como gate de v9. Ver `UNVERIFIED`.

### Resolución y relación de aspecto

Para Reels ads, la relación recomendada es **9:16** y la resolución que muestra actualmente la Guía de anuncios es **1.440 × 2.560 px**. La misma página admite relaciones entre **4:5 y 191:100** en el selector, pero 9:16 es el perfil vertical pertinente para esta pieza. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)

La recomendación de 1.440 × 2.560 px no debe interpretarse como una validación binaria del upload: la página también publica un ancho mínimo de **250 px para anuncios de menos de 30 s**. Un Reel de 15 s debe apuntar a la resolución recomendada por calidad, no diseñarse alrededor del mínimo técnico. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)

Para `creative/istock-ad v9`, la decisión debe quedar registrada en el export: mantener el canvas vertical ya definido por el pipeline o adoptar la recomendación de Meta. Si se mantiene una resolución menor, documentar que es una decisión de peso/tiempo de render y no presentarla como “resolución recomendada por Meta”. No cambia la narrativa.

### Zonas seguras y overlays

La regla cuantitativa de la Guía de anuncios para Reels es dejar libre, respecto del contenido importante:

- **14% superior**;
- **35% inferior**;
- **6% de cada lateral**.

Meta explica que esos bordes pueden quedar truncados o cubiertos por el icono de perfil, la llamada a la acción o los bordes de pantallas más altas que 9:16. En Ads Manager se puede activar el perímetro de zona segura para inspeccionar el creativo. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultados 2026-09-03.)

La ayuda de Meta agrega prácticas de overlay: tipografía moderna y clara, tamaño adecuado, color con contraste, no obstruir el contenido visual, no amontonar mensajes y mantener el contenido dentro de la zona segura. No publica en esa página un tamaño mínimo de fuente ni una relación de contraste numérica. ([Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03.)

El **40% inferior** es una condición más estricta para anuncios que contienen disclaimers. No contradice el 35% general: el 35% es la guía general de bordes para texto/logos/elementos importantes y el 40% aplica sólo cuando hay disclaimer. ([Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03.)

Aplicación a v9: el layout debe tener una guía visible de safe zone durante composición y una revisión final con la interfaz de Ads Manager. El overlay es una herramienta de preflight, no una capa que deba quedar quemada en el archivo final.

### Audio y legibilidad

Meta marca el sonido como opcional pero **muy recomendado** para Reels ads, y los subtítulos como opcionales pero recomendados. Para una pieza de 15 s esto implica que la lectura no debe depender del audio: el texto esencial tiene que sobrevivir con el sonido silenciado, mientras que la mezcla puede conservar el valor del audio cuando el usuario lo tenga activo. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)

La Guía de anuncios prohíbe música con licencia para anuncios de Reels y propone audio original o música libre de regalías de la colección de sonidos de Meta. El Help Center de Instagram describe la biblioteca licenciada como destinada a uso personal/no comercial, con disponibilidad que puede variar por cuenta o región, y describe Sound Collection como utilizable comercialmente, incluso en anuncios. La pista elegida para v9 debe tener una evidencia de derechos aptos para pauta; que una pista esté disponible en Instagram no prueba por sí solo esa autorización. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Instagram Help Center — música](https://www.facebook.com/help/instagram/402084904469945) — consultados 2026-09-03.)

Meta recomienda usar una tipografía clara, de tamaño adecuado y con contraste, sin tapar el motivo visual ni acumular demasiados mensajes. Para v9, el criterio verificable es revisar la pieza en viewport móvil, con sonido activado y silenciado, comprobando que texto, logotipo y CTA permanecen dentro del safe zone. No invento un umbral de puntos, contraste, palabras por segundo o cantidad de líneas porque no aparece publicado en las fuentes primarias consultadas. ([Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03.)

### Compresión y subida

Para Ads Manager, el perfil oficial es **MP4 o MOV**, H.264, píxeles cuadrados, fotogramas fijos, escaneo progresivo y AAC estéreo de 128 kbps o más. El límite de archivo que publica la Guía de anuncios es 4 GB. Para v9 conviene producir un único export limpio dentro de ese perfil y evitar una cadena de recompras; el sitio de Meta no publica un bitrate único obligatorio para el upload de anuncios, así que no se fija uno como requisito del documento. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)

Si se usa la API de publicación de Reels, la colección oficial especifica contenedor MOV/MP4, video HEVC o H.264, audio AAC a 48 kHz, 23–60 fps, ancho máximo de 1.920 px, bitrate de video máximo de 25 Mbps, audio de 128 kbps, duración de 3 s a 15 min y archivo máximo de 1 GB. Esos límites pertenecen a la API, no deben reemplazar el perfil de Ads Manager. ([Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03.)

Por lo tanto, los **4 GB de anuncios** y **1 GB de API** no son una contradicción factual: son límites de dos superficies distintas. Del mismo modo, la recomendación de 1.440 px de ancho para el anuncio queda dentro del máximo de 1.920 px de la API, pero sólo importa ese máximo si se implementa el flujo server-side. Si una especificación antigua o un checklist genérico muestra otros límites, pesa más la página viva específica del placement y la fecha de consulta de este informe. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultados 2026-09-03.)

Meta explica que Facebook e Instagram Reels se codifican en múltiples versiones de bitrate y que el cliente selecciona una versión según la conexión. La consecuencia práctica es exportar una fuente limpia y compatible y dejar la adaptación de entrega a Meta; no diseñar el master alrededor de un bitrate de reproducción no publicado. ([Meta Engineering — AV1 para Reels](https://engineering.fb.com/2023/02/21/video-engineering/av1-codec-facebook-instagram-reels/) — consultado 2026-09-03.)

## Números que importan

| ítem | valor | unidad | fuente |
|---|---:|---|---|
| duración objetivo de la pieza | 15 | s | Objetivo del encargo; el rango de anuncios de Meta es 0 s–15 min: [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| relación recomendada para Reels ads | 9:16 | aspecto | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| resolución recomendada | 1.440 × 2.560 | px | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| margen superior sin contenido clave | 14 | % | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| margen inferior sin contenido clave | 35 | % | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| margen lateral sin contenido clave | 6 por lado | % | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| margen inferior si hay disclaimer | 40 | % | [Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03 |
| ancho mínimo de anuncio menor de 30 s | 250 | px | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| tamaño máximo de archivo en Ads Manager | 4 | GB | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| bitrate mínimo de audio del anuncio | 128 o más | kbps | [Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03 |
| tamaño máximo de archivo en publicación por API | 1 | GB | [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03 |
| ancho máximo en publicación por API | 1.920 | px | [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03 |
| rango de fotogramas en publicación por API | 23–60 | fps | [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03 |
| bitrate máximo de video en publicación por API | 25 | Mbps | [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03 |
| frecuencia de muestreo AAC en publicación por API | 48 | kHz | [Meta Reels Publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03 |
| biblioteca Sound Collection según Help Center | más de 14.000 | sonidos/canciones | [Instagram Help Center — música](https://www.facebook.com/help/instagram/402084904469945) — consultado 2026-09-03 |

## Fuentes

- [Meta Ads Guide — especificaciones de anuncios con video en Instagram Reels](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.
- [Meta Business Help Center — información sobre texto superpuesto y zona segura](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03.
- [Meta — Instagram API: Reels Publishing, Postman API Network](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) — consultado 2026-09-03.
- [Instagram Help Center — acceso a la biblioteca de música licenciada](https://www.facebook.com/help/instagram/402084904469945) — consultado 2026-09-03.
- [Meta Engineering — AV1: the video codec that powers Facebook and Instagram Reels](https://engineering.fb.com/2023/02/21/video-engineering/av1-codec-facebook-instagram-reels/) — consultado 2026-09-03.
- [Instagram Help Center — requisitos para compartir videos](https://help.instagram.com/1038071743007909) — consultado 2026-09-03; la página respondió 429 durante la consulta, por lo que no se usó para cifras ni aceptación.

## Impacto en iStock

### ARCHITECTURE

- Mantener separado el perfil de export de `creative/istock-ad v9` del perfil de publicación orgánica/API. El primer perfil se valida contra la Guía de anuncios; el segundo sólo se agrega si el producto decide implementar ese canal.
- Incorporar al preflight del pipeline campos explícitos para relación 9:16, resolución, duración, contenedor, H.264, fotogramas fijos/progresivos, AAC y derechos de audio. La guía de safe zone debe ser una capa de composición/inspección, nunca parte del video final. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
- Tratar el upload como fuente que Meta transcodifica a varias versiones de entrega. No agregar una CDN, un worker ni una transformación de producto para resolver la reproducción de Reels; este informe no requiere cambios de app.

### DECISIONS

- Para v9, conservar la narrativa vigente y fijar 9:16 como contrato visual. Usar 1.440 × 2.560 px como objetivo de calidad de Meta; si se conserva el master actual por razones de render o peso, dejar esa excepción escrita y no llamarla “recomendación de Meta”. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
- Ubicar cada texto, logo y elemento visual importante dentro de 14%/35%/6%, inspeccionando el safe-zone guardrail de Ads Manager. Si aparece un disclaimer, aplicar el margen inferior de 40%. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultados 2026-09-03.)
- Mantener un export MP4/MOV con H.264, tasa fija, progresivo y AAC estéreo de al menos 128 kbps. Preferir audio original o Sound Collection/otra pista con licencia comercial comprobable; no trasladar una pista de la biblioteca licenciada personal al anuncio sin autorización independiente. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels); [Instagram Help Center — música](https://www.facebook.com/help/instagram/402084904469945) — consultados 2026-09-03.)
- Validar manualmente legibilidad en móvil con audio activado y silenciado. No introducir un tamaño mínimo de tipografía o un umbral de contraste no publicado por Meta.

### COST

- La investigación y el documento agregan **costo de runtime: ninguno**; no se modificó `creative/` ni la aplicación.
- Elegir 1.440 × 2.560 px puede aumentar tiempo de render, almacenamiento temporal y bytes de subida frente a un master menor; Meta no publica aquí un tamaño de archivo determinista para un Reel de 15 s, por lo que el delta monetario de egress/almacenamiento queda **UNVERIFIED** hasta medir un export real. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
- La transcodificación y las versiones ABR de entrega ocurren en Meta; no corresponde presupuestar un bitrate de reproducción propio. La única decisión de costo local es la resolución del master y su impacto medido en bytes, no una nueva arquitectura.

## Confianza

**alta** para el contrato de anuncios pago, safe zones, formatos, audio y derechos: las cifras principales provienen de la página viva de Meta Ads Guide y de páginas oficiales de Meta/Instagram consultadas el 2026-09-03. **media** para cualquier conclusión sobre publicación orgánica, porque el Help Center orgánico devolvió 429 y no se usaron sus cifras. La confianza subiría con una respuesta directa y vigente de esa página orgánica o un changelog oficial que versionara los requisitos; bajaría si Meta muestra un perfil distinto para la cuenta, región o flujo de upload concreto.

## UNVERIFIED

- Requisitos mínimos orgánicos vigentes de Instagram —incluidos resolución mínima, fps mínimo, límite de archivo y portada—: la [página oficial](https://help.instagram.com/1038071743007909) devolvió 429 el 2026-09-03; no son gate de `creative/istock-ad`.
- Tamaño mínimo de tipografía, relación de contraste, cantidad máxima de líneas/palabras o velocidad de lectura para esta pieza: no publicados numéricamente en las fuentes primarias consultadas. ([Meta Business Help](https://www.facebook.com/business/help/980593475366490/) — consultado 2026-09-03.)
- Tamaño final en bytes, costo de egress/almacenamiento y tiempo de render de un export de v9 a 1.440 × 2.560 px: dependen del contenido, encoder y bitrate elegidos; requieren medir el archivo real. ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) — consultado 2026-09-03.)
