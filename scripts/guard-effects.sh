#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  GUARD DE EFECTOS DECLARADOS — todo efecto que el dominio declara tiene que tener quien lo ejecute
#
#  `packages/domain/src/listing-status.ts` define `TransitionEffects` y lo comenta asi, textual:
#
#      "Efectos declarados de una transicion. El dominio los describe; `apps/web` los ejecuta."
#
#  Este gate existe porque esa segunda mitad no era verdad y nadie lo veia.
#
#  ── El fallo que lo motivo (S6, adversary del 2026-08-28) ────────────────────────────────────
#  `closesReservation` esta comentado en el dominio como **"Efecto obligatorio"** y tenia CERO
#  consumidores en `apps/web`. En paralelo, `transitionUnit()` evaluaba toda transicion con
#  `activeReservation: null` hardcodeado —S6 le agrego un parametro opcional a
#  `transitionContextFor()` y se olvido de un caller—, asi que "Publicar" sobre una unidad RESERVADA
#  devolvia ok, republicaba el equipo en la vidriera como Disponible con la sena puesta, y lo dejaba
#  irreservable hasta que el cron lo venciera. El dominio aprobaba porque le mentian.
#
#  TypeScript no lo vio: el parametro es opcional y su default es un valor valido. El typecheck no
#  distingue "no me lo pasaron" de "me pasaron que no hay reserva", y esa es exactamente la
#  diferencia que costaba el producto.
#
#  ── Por que un grep y no algo mas fuerte ─────────────────────────────────────────────────────
#  La afirmacion fuerte —"quien ejecuta la transicion LEE `transitionEffects()` en vez de re-derivar
#  la regla"— no se mide con grep. Esta es la version debil y honesta: un efecto declarado sin un
#  solo lector es, o un bug como el de arriba, o una declaracion que nadie necesita y entonces no
#  deberia decir que es obligatoria. Las dos merecen una linea escrita.
#
#  ── Las tres polaridades ─────────────────────────────────────────────────────────────────────
#  sin consumidor + sin motivo → FAIL. Es el caso de `closesReservation`.
#  sin consumidor + con motivo → PASS, y el motivo queda versionado y se lee en cada corrida.
#  CON consumidor + con motivo → FAIL. Es la exencion podrida: la que sobrevive al problema que la
#  justificaba y despues excusa un caso que nadie miro. Sin esta tercera rama el gate se oxida solo.
#
#  Los tests NO cuentan como consumidor: un efecto que solo se ejecuta en un test es un efecto que
#  no se ejecuta.
#
#  Duenio: LEAD (`CLAUDE.md` §4). Audita a `domain-agent` y a `app-agent` a la vez, o sea a dos
#  writers; un gate no puede ser del writer que audita.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

# ── La escotilla de fixture (`T32`, LEAD 2026-08-28) ─────────────────────────────────────────
# Las dos rutas salen de una variable de entorno para que `scripts/guard-effects.test.sh` pueda
# apuntar el gate a un arbol de mentira y verlo ENCENDER. Antes estaban clavadas y por eso este
# gate no se habia visto nunca fallar: la unica forma de probarlo era romper el dominio de verdad,
# o sea nunca. Es la misma escotilla que `DOC_TABLES_ROOT` en `guard-doc-tables.sh`, y existe por
# el mismo motivo que ese arnes: un gate que no se vio encender no es evidencia de nada.
#
# No la puede usar nadie mas: en CI las variables no estan seteadas y el gate audita el arbol real.
FUENTE="${EFFECTS_FUENTE:-packages/domain/src/listing-status.ts}"
DESTINO="${EFFECTS_DESTINO:-apps/web/app}"

# `motivo_de <efecto>` — la lista de exenciones, versionada y con el motivo al lado.
#
# bash 3.2 (el que trae macOS) no tiene arrays asociativos, asi que esto es un `case`. No es una
# limitacion: obliga a que cada exencion sea una linea legible con su razon pegada.
motivo_de() {
  case "$1" in
    writesListingEvent)
      echo "Es constante \`true\` y el dominio lo dice ahi mismo: toda transicion escribe en \`listing_events\`. Todos los caminos de escritura insertan el evento incondicionalmente, asi que leer un booleano que nunca es falso seria ceremonia. Se declara igual porque el dia que deje de ser siempre \`true\` esta exencion es lo que se rompe." ;;
    # `createsSale` TENIA una exencion aca y se la saque en S7, LEAD 2026-08-28. Su texto decia
    # "la exencion vence con esa slice ... apenas aparezca un consumidor, tener el motivo escrito
    # pasa a ser FAIL", y es exactamente lo que paso: `transitionUnit()` lo consume en
    # `publish-listing.ts:451` y este gate se puso rojo sin que nadie se acordara de venir. Queda
    # anotado y no borrado en silencio porque es la unica exencion del repo que se vio expirar
    # sola, que era el punto de escribirla con fecha de vencimiento adentro.
    createsReservation)
      echo "Hoy \`reserveUnit\` inserta la reserva por su cuenta despues de que \`checkTransition\` aprueba, o sea que la regla esta escrita dos veces: una en la tabla del dominio y otra en el camino de escritura. No es un bug —las dos dicen lo mismo— pero es la misma forma exacta que produjo el fallo de S6, y por eso queda anotada en vez de tapada: se consolida cuando \`transitionUnit\` consuma la tabla entera en lugar de re-derivar efecto por efecto." ;;
    *) echo "" ;;
  esac
}

sec 'E1 · la interfaz de efectos se puede leer del dominio'
if [ ! -f "$FUENTE" ]; then
  no "no existe $FUENTE: este gate deriva su lista de ahi y sin la fuente no puede afirmar nada"
  printf '\n\033[31mGUARD-EFFECTS: RECHAZADO\033[0m\n'; exit 1
fi
EFECTOS=$(awk '/^export interface TransitionEffects \{/{d=1;next} d&&/^\}/{exit} d' "$FUENTE" \
          | sed -nE 's/^[[:space:]]*readonly[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*:.*/\1/p')
CANT=$(printf '%s\n' "$EFECTOS" | grep -c '[^[:space:]]' || true)
if [ "$CANT" -ge 1 ]; then
  ok "se leyeron $CANT efectos declarados de TransitionEffects"
else
  no "no se pudo extraer ningun campo de TransitionEffects en $FUENTE. Si la interfaz se renombro o cambio de forma, este gate quedo mirando al vacio y hay que arreglarlo, no borrarlo"
  printf '\n\033[31mGUARD-EFFECTS: RECHAZADO\033[0m\n'; exit 1
fi

sec 'E2 · cada efecto declarado tiene quien lo ejecute, o un motivo escrito'
for e in $EFECTOS; do
  # `grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)'` — una mencion en un DOCBLOCK no es un consumidor.
  # Medido en S7 por el LEAD: de las 8 referencias a `createsSale` en `apps/web/app`, **7 eran
  # lineas de comentario** y una sola era codigo (`publish-listing.ts:451`). El veredicto de ese
  # dia salio bien igual —con un consumidor real alcanza para que la exencion este podrida— pero
  # el conteo estaba inflado 8x, y en la direccion peligrosa: un efecto DOCUMENTADO y no
  # ejecutado habria contado como ejecutado, que es literalmente el bug de S6 con prosa encima.
  # Es la misma clase que `G4` de `guard-gates.sh` tenia con `ci.yml` y se cerro el mismo dia:
  # un gate que lee texto contesta "¿esta escrito?" cuando la pregunta es "¿se ejecuta?".
  USOS=$(_buscar "\\b$e\\b" "$DESTINO" | grep -vE '\.test\.[tj]sx?:' | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' || true)
  N=$(printf '%s' "$USOS" | grep -c '[^[:space:]]' || true)
  MOTIVO=$(motivo_de "$e")

  if [ "$N" -gt 0 ] && [ -n "$MOTIVO" ]; then
    no "$e TIENE $N consumidor(es) y ademas una exencion escrita en este gate. Es la exencion podrida: sacala de \`motivo_de\`, porque una excusa que sobrevive a su problema termina excusando un caso que nadie miro"
    printf '%s' "$USOS" | sed 's/^/        /' | cut -c1-160 | head -3
  elif [ "$N" -gt 0 ]; then
    ok "$e se ejecuta en $DESTINO ($N referencia(s))"
  elif [ -n "$MOTIVO" ]; then
    ok "$e no tiene consumidor, y esta declarado"
    printf '%s\n' "$MOTIVO" | fold -s -w 96 | sed 's/^/        · /'
  else
    no "$e lo declara el dominio y NO lo ejecuta nadie en $DESTINO. O falta ejecutarlo —es el bug de S6: \`closesReservation\` estaba en cero y una unidad reservada se republicaba como disponible con la sena puesta— o la declaracion sobra. Las dos salidas piden una linea escrita: agregale el motivo a \`motivo_de\` en este archivo, o dale un consumidor"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mGUARD-EFFECTS: OK\033[0m\n'
else
  printf '\033[31mGUARD-EFFECTS: RECHAZADO\033[0m\n'
fi
exit "$fail"
