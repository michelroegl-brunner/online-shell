---
slug: text-tools
title: Text-Tools
shell: BASH
tags: [grep, cut, sort, uniq, wc, head, tail, tr, sed, awk, text, filter, pipes, log, logs, find]
order: 40
---

## grep – Zeilen filtern

| Befehl | Bedeutung |
|---|---|
| `grep muster datei` | Zeilen mit „muster" |
| `grep -i` | Groß/klein egal |
| `grep -v` | Zeilen **ohne** Muster |
| `grep -c` | nur die Anzahl |
| `grep -n` | mit Zeilennummer |
| `grep -r muster dir/` | rekursiv |
| `grep -l` | nur Dateinamen |
| `grep -w` | ganzes Wort |
| `grep -E "a\|b"` | erweiterte Regex (`a` oder `b`) |
| `grep -q` | still, nur Exit-Code |

Regex: `^anfang`, `ende$`, `.` = ein Zeichen, `.*` = beliebig viele, `[0-9]+`.

## cut – Spalten

```bash
cut -d: -f1 /etc/passwd        # 1. Feld, Trenner :
cut -d, -f2,4 daten.csv        # Felder 2 und 4
cut -c1-5 datei                # Zeichen 1–5
```

## sort / uniq

| Befehl | Bedeutung |
|---|---|
| `sort` | alphabetisch |
| `sort -n` / `sort -r` | numerisch / umgekehrt |
| `sort -t, -k2` | nach Spalte 2, Trenner `,` |
| `sort -u` | sortiert, Duplikate weg |
| `uniq` | nur **aufeinanderfolgende** Duplikate weg → vorher `sort`! |
| `uniq -c` | mit Anzahl |

```bash
cut -d' ' -f1 access.log | sort | uniq -c | sort -nr | head -5
```

## wc / head / tail

| Befehl | Bedeutung |
|---|---|
| `wc -l` / `-w` / `-c` | Zeilen / Wörter / Bytes |
| `head -n 5` | erste 5 Zeilen |
| `tail -n 5` | letzte 5 Zeilen |
| `tail -n +2` | ab Zeile 2 (Kopfzeile weg) |
| `tail -f log` | live mitlesen (Strg+C) |

## tr – Zeichen ersetzen

```bash
tr 'a-z' 'A-Z' < datei         # Großbuchstaben
tr -d '\r' < datei             # Zeichen löschen
tr -s ' ' < datei              # mehrfache Leerzeichen → eins
tr ',' '\n' < datei            # Komma → Zeilenumbruch
```

## sed – Suchen & Ersetzen

```bash
sed 's/alt/neu/' datei         # erstes Vorkommen pro Zeile
sed 's/alt/neu/g' datei        # alle
sed -i 's/alt/neu/g' datei     # Datei direkt ändern
sed -n '2,4p' datei            # Zeilen 2–4 ausgeben
sed '/^#/d' datei              # Kommentarzeilen löschen
```

## awk – Spalten

```bash
awk '{print $1, $3}' datei
awk -F: '$3 >= 1000 {print $1}' /etc/passwd
awk '{s += $2} END {print s}' zahlen.txt
```

## find

```bash
find . -name "*.log" -size +1M
find . -type f -mtime -7       # in den letzten 7 Tagen geändert
find . -name "*.tmp" -delete
```
