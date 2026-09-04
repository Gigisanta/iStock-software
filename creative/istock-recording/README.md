# Fixture de captura para iStock

Este archivo es un recurso visual local para probar la vidriera y el primer anuncio. La silueta es deliberadamente editorial y no representa una foto ni una unidad de inventario real.

Uso:

1. Convertir `fixture.svg` a WebP.
2. Copiar el resultado a las claves públicas del seed bajo `media/v1/...`.
3. Levantar la app con `MEDIA_DRIVER=local`, `MEDIA_LOCAL_ROOT` apuntando al root de captura y `NEXT_PUBLIC_MEDIA_BASE_URL` apuntando a `/_media`.

Costo: cero egress, cero API externa, cero créditos de Higgsfield.
