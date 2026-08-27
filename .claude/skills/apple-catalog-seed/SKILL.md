---
name: apple-catalog-seed
description: Semilla del catálogo de modelos Apple que se venden hoy en Argentina - líneas, storages, colores y FAQs - más los embeddings de catalog_models. Usar al poblar o actualizar el catálogo.
---

# apple-catalog-seed

`catalog_models` es **global** (no por tenant): el catálogo es el mismo para todos.
Lo que es por tenant es el `listing` que apunta a un modelo.

## Fuente de verdad
`docs/research/apple-catalog-ar.md` (topic **R6** de FASE 1). **No inventes líneas ni storages
de memoria** — el mix que se vende en Argentina no es el mix global y cambia por año.

## Forma del registro
```ts
{
  slug: 'iphone-14-pro-256',        // estable, url-safe, único
  family: 'iphone',                  // iphone | ipad | watch | mac | accessory
  line: 'iPhone 14 Pro',
  storageGb: 256,
  releaseYear: 2022,
  colors: ['Grafito', 'Plata', 'Oro', 'Morado oscuro'],  // en español, como los nombra el ICP
  displayName: 'iPhone 14 Pro 256GB',
  searchText: '...',                 // texto plano para embedding
}
```

## Reglas
1. **Colores en español rioplatense**, como los nombra el vendedor ("Grafito", no "Graphite").
2. Slug **estable**: si cambia, se rompen fichas indexadas. Cambio de slug = migración explícita.
3. Storages sólo los que **existieron** en esa línea. Un `iPhone 14 Pro 64GB` no existe: el seed
   no debe permitirlo, y el panel tampoco.
4. `catalog_faqs`: 3–8 preguntas por familia (batería, garantía, iCloud, procedencia, canje).
   Son la **base del RAG del chatbot** — texto corto, factual, sin promesas de precio.
5. **Embeddings sólo acá**, en seed/update. Nunca por request. Guardá el modelo de embedding usado
   y su dimensión; cambiar de modelo obliga a regenerar todo.
6. Chunk = **una FAQ o una spec**, no un documento entero. El chatbot recupera 3 chunks del
   **mismo modelo** — chunks gordos rompen la dieta de tokens.

## Aceptación
```
pnpm --filter @istock/db seed:catalog && pnpm --filter @istock/db test -- catalog
```
El test verifica: slugs únicos · sin storage inválido por línea · toda FAQ con embedding ·
dimensión de embedding consistente.
