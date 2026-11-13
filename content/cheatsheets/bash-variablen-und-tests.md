---
slug: bash-variablen-und-tests
title: Variablen, Tests & Schleifen
shell: BASH
tags: [variablen, if, tests, bedingungen, schleifen, loops, case, skript, parameter, benutzer, backup, funktionen, functions]
order: 30
---

## Variablen

```bash
name="Anna"             # KEINE Leerzeichen um =
echo "$name" "${name}s"
anzahl=$(ls | wc -l)    # Ausgabe eines Befehls
summe=$((3 + 4))        # rechnen (ganze Zahlen)
read -p "Name: " name   # Eingabe lesen
```

| | |
|---|---|
| `$?` | Exit-Code des letzten Befehls (0 = OK) |
| `$$` | PID der Shell |
| `${#name}` | Länge |
| `${name:-x}` | `x`, wenn leer |
| `export VAR=1` | an Kindprozesse vererben |

## Tests

`[ … ]` braucht Leerzeichen innen: `[ -f a.txt ]`. `[[ … ]]` (nur Bash) kann `&&`, `||`, Muster mit `==` und Regex mit `=~`.

| Datei | | Strings | | Zahlen | |
|---|---|---|---|---|---|
| `-e` | existiert | `-z "$s"` | leer | `-eq` | = |
| `-f` | normale Datei | `-n "$s"` | nicht leer | `-ne` | ≠ |
| `-d` | Ordner | `"$a" = "$b"` | gleich | `-lt` / `-le` | < / ≤ |
| `-r` `-w` `-x` | lesen / schreiben / ausführen | `"$a" != "$b"` | ungleich | `-gt` / `-ge` | > / ≥ |
| `-s` | nicht leer | | | | |

```bash
[[ $datei == *.txt ]] && echo "Textdatei"
(( n > 5 )) && echo "groß"     # Arithmetik-Test
```

## if / elif / else

```bash
if [ -d "$1" ]; then
  echo "Ordner"
elif [ -f "$1" ]; then
  echo "Datei"
else
  echo "gibt es nicht" >&2
  exit 1
fi
```

## && und ||

```bash
mkdir backup && cp *.txt backup/   # nur wenn mkdir klappt
cd ordner || exit 1                # bei Fehler abbrechen
grep -q root /etc/passwd && echo gefunden
```

## for / while

```bash
for f in *.txt; do
  echo "Datei: $f"
done
```

```bash
for i in {1..5}; do echo "$i"; done
for ((i = 0; i < 3; i++)); do echo "$i"; done
```

```bash
while read -r zeile; do
  echo ">> $zeile"
done < liste.txt
```

```bash
n=0
while [ $n -lt 3 ]; do n=$((n + 1)); done
```

`break` = Schleife verlassen, `continue` = nächster Durchlauf.

## case

```bash
case "$1" in
  start)   echo "Starte" ;;
  stop|q)  echo "Stoppe" ;;
  *)       echo "Usage: $0 start|stop"; exit 1 ;;
esac
```

## Exit-Codes

```bash
exit 0                 # Erfolg
exit 1                 # Fehler
befehl; echo $?        # Code prüfen
set -e                 # Skript bei Fehler abbrechen
```
