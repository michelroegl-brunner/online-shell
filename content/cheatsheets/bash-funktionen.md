---
slug: bash-funktionen
title: Bash-Funktionen
shell: BASH
tags: [funktionen, functions, function, parameter, argumente, return, local]
order: 20
---

## Definieren & aufrufen

```bash
gruss() {
  echo "Hallo $1"
}
gruss Anna            # Aufruf: OHNE Klammern
```

```bash
function gruss {      # gleichwertig (Bash-Stil)
  echo "Hallo $1"
}
```

- Funktion **vor** dem ersten Aufruf definieren.
- Einzeiler: `f() { echo hi; }` – Leerzeichen nach `{`, `;` vor `}`.

## Parameter

| Ausdruck | Bedeutung |
|---|---|
| `$1` … `$9`, `${10}` | 1. … 10. Argument |
| `$#` | Anzahl der Argumente |
| `"$@"` | alle Argumente, **jedes einzeln** gequotet |
| `"$*"` | alle Argumente als **ein** String |
| `$0` | Name des Skripts (nicht der Funktion) |
| `${1:-standard}` | `$1` oder `standard`, wenn leer |
| `shift` | `$2` wird zu `$1` … |

```bash
zeige() { for a in "$@"; do echo "[$a]"; done; }
zeige "a b" c         # [a b] [c]
```

```bash
pruefe() {
  if [ $# -lt 1 ]; then
    echo "Usage: pruefe DATEI" >&2
    return 1
  fi
}
```

## local

```bash
zaehle() {
  local n=0           # nur in der Funktion sichtbar
  n=$((n + 1))
  echo "$n"
}
```

Ohne `local` ist jede Variable **global** und überschreibt gleichnamige Variablen.

## return vs. echo

| | Zweck | Abfragen mit |
|---|---|---|
| `return 0..255` | Exit-Code (0 = Erfolg) | `$?`, `if f; then` |
| `echo wert` | Ergebnis (Text) | `x=$(f)` |

```bash
summe() { echo $(( $1 + $2 )); }
s=$(summe 3 4)        # s=7
```

```bash
ist_datei() { [ -f "$1" ]; }   # Exit-Code des Tests
if ist_datei notes.txt; then echo ja; fi
```

## Aus Datei laden

```bash
source ./lib.sh       # oder: . ./lib.sh
```

Funktionen aus `lib.sh` sind danach in der aktuellen Shell verfügbar.

## Typische Fehler

| Falsch | Richtig |
|---|---|
| `function name{` | `function name {` |
| `name(){echo hi}` | `name() { echo hi; }` |
| `name()` (Aufruf) | `name` |
| `name(a, b)` | `name a b` |
| `return "text"` | `echo "text"` (return nur Zahlen) |
| `x = $(f)` | `x=$(f)` (keine Leerzeichen bei `=`) |
| `for a in $@` | `for a in "$@"` |
| `echo $1` bei Leerzeichen | `echo "$1"` |

## Nützlich

```bash
declare -f            # alle Funktionen anzeigen
type gruss            # Definition einer Funktion
unset -f gruss        # Funktion löschen
```
