---
slug: bash-grundlagen
title: Bash-Grundlagen
shell: BASH
tags: [bash, grundlagen, echo, help, cat, ls, cp, mv, dateien, navigation, umleitung, pipes, backup, skript]
order: 10
---

## Navigation

| Befehl | Bedeutung |
|---|---|
| `pwd` | aktuelles Verzeichnis |
| `ls -la` | alle Dateien, ausführlich |
| `cd ordner` | in Ordner wechseln |
| `cd ..` / `cd ~` / `cd -` | hoch / Home / zurück |
| `tree` | Verzeichnisbaum |
| `man ls` / `ls --help` / `help cd` | Hilfe |

## Dateien & Ordner

| Befehl | Bedeutung |
|---|---|
| `touch a.txt` | leere Datei anlegen |
| `mkdir -p a/b/c` | Ordner (mit Zwischenordnern) |
| `cp a.txt b.txt` / `cp -r dir neu` | kopieren / Ordner kopieren |
| `mv a.txt dir/` / `mv alt neu` | verschieben / umbenennen |
| `rm a.txt` / `rm -r dir` | löschen (kein Papierkorb!) |
| `cat a.txt` / `less a.txt` | anzeigen / blättern (`q` = Ende) |
| `find . -name "*.log"` | Dateien suchen |
| `chmod +x skript.sh` | ausführbar machen |

## Ausgabe

```bash
echo "Hallo $USER"
echo -n "ohne Zeilenumbruch"
echo -e "a\tb\nc"       # \t und \n auswerten
printf "%s: %d\n" Zahl 42
```

## Umleitungen

| Syntax | Bedeutung |
|---|---|
| `cmd > datei` | stdout in Datei (überschreiben) |
| `cmd >> datei` | stdout anhängen |
| `cmd 2> fehler.txt` | stderr in Datei |
| `cmd > out.txt 2>&1` | stdout **und** stderr in Datei |
| `cmd &> out.txt` | dasselbe, kurz |
| `cmd 2> /dev/null` | Fehler verwerfen |
| `cmd < datei` | Datei als Eingabe |
| `cmd1 \| cmd2` | Ausgabe von cmd1 → Eingabe von cmd2 |

```bash
ls -l | grep ".txt" > liste.txt
```

## Quoting

| | Beispiel | Ergebnis |
|---|---|---|
| `"…"` | `echo "Hi $USER"` | Variablen werden ersetzt |
| `'…'` | `echo 'Hi $USER'` | alles wörtlich |
| `\` | `echo \$HOME` | ein Zeichen wörtlich |
| `$(…)` | `echo "Heute: $(date +%F)"` | Ausgabe eines Befehls |

Dateinamen mit Leerzeichen immer quoten: `cat "meine datei.txt"`.

## Skript

```bash
#!/usr/bin/env bash
echo "Start"
```

```bash
chmod +x skript.sh && ./skript.sh
bash skript.sh          # ohne chmod
```

## Wildcards

| Muster | passt auf |
|---|---|
| `*` | beliebig viele Zeichen |
| `?` | genau ein Zeichen |
| `[abc]` / `[0-9]` | ein Zeichen aus der Menge |
| `{a,b}.txt` | `a.txt b.txt` |
