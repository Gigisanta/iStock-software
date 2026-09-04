# iStock

## Identidad visual draft

### Decisión de marca

iStock es el producto. MaatWork es la empresa.

iStock ayuda a resellers argentinos de iPhone a ordenar su stock y venderlo desde Instagram y WhatsApp. La identidad tiene que funcionar en una vidriera, en un avatar y en un anuncio vertical sin perder lectura.

### Design Read

Identidad de producto y anuncio vertical para resellers argentinos de iPhone, con lenguaje premium-funcional, gráfico y reconocible, apoyado en geometría modular, tipografía sans y contraste monocromo con un único acento verde mineral.

`DESIGN_VARIANCE: 8`
`MOTION_INTENSITY: 7`
`VISUAL_DENSITY: 3`

### Idea de la marca

El mark es una estantería abstracta construida con tres tramos rectos. Cada tramo se desplaza y vuelve a trabar con el siguiente. Evoca inventario ordenado, movimiento de unidades y una ruta clara hacia la venta.

La forma usa ángulos de 90 grados, módulos repetibles y un vacío controlado. No usa una flecha, una curva ornamental ni un swoosh genérico. El dibujo es propio y conserva carácter cuando baja a favicon.

### Lockup y jerarquía

- La palabra `iStock` siempre es protagonista.
- `MaatWork` aparece como firma de empresa en tamaños secundarios.
- En primera mención puede escribirse `iStock, producto de MaatWork`.
- En espacios chicos se usa sólo el mark. No reducir el lockup hasta volver ilegible la firma.
- Mantener un área libre mínima equivalente a un módulo del mark alrededor del conjunto.

El logo horizontal incluido es editable: el mark está separado por grupo, el wordmark es texto SVG y los colores viven en variables internas.

### Paleta

La base es fría, clara y de alto contraste. El verde mineral es el único acento. Sus variantes de acción y superficie son cambios de contraste dentro de la misma familia, no colores nuevos.

| Token | Uso | Valor |
| --- | --- | --- |
| `--istock-paper` | Fondo principal | `#f1f3ee` |
| `--istock-ink` | Texto y lockup | `#111513` |
| `--istock-surface` | Placas y áreas de apoyo | `#dfe7e1` |
| `--istock-line` | Bordes y divisores | `#c7d1c9` |
| `--istock-accent` | Mark y énfasis | `#2f8f68` |
| `--istock-accent-action` | Acción sobre fondo claro | `#1e6047` |

No usar gradientes gratuitos, colores de acento secundarios ni sombras negras duras. En fondos oscuros, invertir papel e ink y conservar el verde mineral.

### Tipografía

- Display y titulares: `Helvetica Neue`, `Arial`, sans-serif. Peso 700, tracking levemente cerrado.
- Texto funcional: la misma familia, peso 400 o 500, interlineado generoso.
- Metadatos: `SFMono-Regular`, `Consolas`, monospace. Usar poco y sólo para datos, formatos o etiquetas técnicas.
- No usar serif como recurso decorativo.

La voz es directa, local y útil. Preferir verbos concretos: `cargá`, `publicá`, `respondé`, `vendé`. Evitar promesas abstractas y adjetivos de tecnología.

### Composición

- Priorizar alineación a la izquierda y bloques asimétricos.
- Trabajar con una retícula de 8 px y módulos grandes con esquinas de 14 px.
- Un solo foco por pieza. El mark puede ocupar un área amplia, pero no competir con el nombre del producto.
- En vertical 9:16, reservar una zona de seguridad de un módulo alrededor del mark y del lockup.
- Usar superficies planas, líneas útiles y aire. No dibujar grillas sólo como decoración.

### Movimiento

El movimiento del preview muestra cómo se arma la marca: entrada por transformación y opacidad, con una pausa corta al llegar a su lugar. En producto, limitar la animación a jerarquía, feedback y cambios de estado. Toda animación debe desaparecer con `prefers-reduced-motion: reduce`.

### Usos recomendados

- Lockup horizontal en cabecera de vidriera y material institucional.
- Mark en favicon, avatar, sticker de stock y sello de imagen.
- Verde mineral para botón primario, disponibilidad real o llamada principal.
- Fondo claro para catálogo y fondo oscuro para piezas de alto contraste.

### Evitar

- No separar `iStock` de su mark en la cabecera si hay espacio suficiente.
- No escribir `MaatWork iStock` como si MaatWork fuera el producto.
- No inclinar, estirar, rotar ni encerrar el mark en una forma nueva.
- No agregar íconos de teléfono, manzana, flecha o carrito al logo.
- No usar más de un acento en la misma pieza.

### Entregables

- `logo-horizontal.svg`: lockup editable.
- `mark.svg`: marca modular independiente.
- `favicon.svg`: versión compacta con fondo de protección.
- `brand-tokens.css`: variables de color, tipo, ritmo y forma.
- `preview.html`: lámina local de revisión.
- `explorations.html`: tres pruebas de mark con la decisión de selección.

### Aceptación

```bash
xmllint --noout creative/istock-brand/logo-horizontal.svg creative/istock-brand/mark.svg creative/istock-brand/favicon.svg
```

Costo: SVG y CSS estáticos, sin egress, sin LLM y sin créditos de Higgsfield.
