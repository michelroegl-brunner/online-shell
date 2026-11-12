# Linux-Übungen – Musterlösungen

Zu `content/exercises/linux-htl.json` (wird nicht importiert).
Alle Befehle werden im jeweiligen Übungsordner `~/exercises/<slug>` ausgeführt.

## Linux-Shell Grundlagen 1: echo, help und Umleitungen

Slug: `linux-shell-grundlagen-1` · 7 Schritte · 18 Punkte

### 1. Verzeichnis COPR anlegen (2 P.)

```bash
mkdir COPR
```

### 2. Hello, world! (2 P.)

```bash
echo 'Hello, world!' > hello.txt
```

### 3. Hilfe zu echo (3 P.)

```bash
help echo > echo-hilfe.txt
```

### 4. fee, fie, foe, fum mit der Historie (3 P.)

```bash
echo fee > fee.txt
echo fie >> fee.txt
echo foe >> fee.txt
echo fum >> fee.txt
```

### 5. Ausgabe löschen (2 P.)

```bash
clear
echo clear > clear.txt
```

### 6. Anführungszeichen ausgeben (3 P.)

```bash
echo 'Use "man echo"' > zitat.txt
```

### 7. 5 Sekunden pausieren (3 P.)

```bash
sleep 5
echo 'sleep 5' > pause.txt
```

## Linux-Shell Grundlagen 2: Dateien, cat, ls, cp, mv

Slug: `linux-shell-grundlagen-2` · 7 Schritte · 21 Punkte

### 1. Zwei Dateien mit echo erzeugen (3 P.)

```bash
echo 'Erste Beispielzeile fuer Linux Aufgabe 8.' > line_1.txt
echo 'Zweite Beispielzeile fuer Linux Aufgabe 8.' > line_2.txt
```

### 2. Dateien mit cat kombinieren (3 P.)

```bash
cat line_1.txt line_2.txt > line_3.txt
```

### 3. Inhalt mit less ansehen (2 P.)

```bash
wc -l < line_3.txt > zeilen.txt
```

### 4. Dateien mit l… auflisten (3 P.)

```bash
ls l* > l-dateien.txt
```

### 5. Alles in der langen Form (3 P.)

```bash
ls -la > alle.txt
```

### 6. foo.txt kopieren (3 P.)

```bash
echo 'hello world' > foo.txt
cp foo.txt bar.txt
```

### 7. Umbenennen und kopieren (4 P.)

```bash
cd aufgabe14
mv foo bar
cp bar foobar
printf 'mv foo bar\ncp bar foobar\n' > befehle.txt
```

## Shell-Skripte (leicht): Rechner und Dateizähler

Slug: `linux-skripte-leicht` · 4 Schritte · 30 Punkte

### 1. Einfache Rechenmaschine (rechner.sh) (10 P.)

```bash
cat > rechner.sh <<'EOF'
#!/bin/bash
a=$1
b=$2
echo "Summe: $((a + b)), Differenz: $((a - b)), Produkt: $((a * b)), Division: $((a / b))"
EOF
chmod +x rechner.sh
```

### 2. Rechner: Fehlerbehandlung (5 P.)

```bash
cat > rechner.sh <<'EOF'
#!/bin/bash
if [ $# -ne 2 ]; then
  echo "Aufruf: $0 ZAHL1 ZAHL2" >&2
  exit 1
fi
for z in "$1" "$2"; do
  if ! [[ $z =~ ^-?[0-9]+$ ]]; then
    echo "Fehler: '$z' ist keine ganze Zahl." >&2
    exit 1
  fi
done
if [ "$2" -eq 0 ]; then
  echo "Fehler: Division durch 0." >&2
  exit 1
fi
a=$1
b=$2
echo "Summe: $((a + b)), Differenz: $((a - b)), Produkt: $((a * b)), Division: $((a / b))"
EOF
```

### 3. Dateizähler (count_files.sh) (10 P.)

```bash
cat > count_files.sh <<'EOF'
#!/bin/bash
dir=$1
if [ ! -d "$dir" ]; then
  echo "Fehler: Verzeichnis '$dir' existiert nicht." >&2
  exit 1
fi
dateien=$(find "$dir" -type f | wc -l)
ordner=$(find "$dir" -mindepth 1 -type d | wc -l)
echo "Dateien: $dateien, Ordner: $ordner"
EOF
chmod +x count_files.sh
```

### 4. Dateizähler: nur eine Endung (5 P.)

```bash
cat > count_files.sh <<'EOF'
#!/bin/bash
dir=$1
endung=$2
if [ ! -d "$dir" ]; then
  echo "Fehler: Verzeichnis '$dir' existiert nicht." >&2
  exit 1
fi
if [ -n "$endung" ]; then
  dateien=$(find "$dir" -type f -name "*$endung" | wc -l)
else
  dateien=$(find "$dir" -type f | wc -l)
fi
ordner=$(find "$dir" -mindepth 1 -type d | wc -l)
echo "Dateien: $dateien, Ordner: $ordner"
EOF
```

## Shell-Skripte (mittel): Backup, Log-Analyse, Dateien verschieben

Slug: `linux-skripte-mittel` · 5 Schritte · 40 Punkte

### 1. Backup-Skript (backup.sh) (10 P.)

```bash
cat > backup.sh <<'EOF'
#!/bin/bash
quelle=$1
ziel=$2
if [ ! -d "$quelle" ] || [ -z "$ziel" ]; then
  echo "Aufruf: $0 QUELLE ZIEL" >&2
  exit 1
fi
mkdir -p "$ziel"
name="backup_$(date +%Y-%m-%d_%H-%M)"
cp -r "$quelle" "$ziel/$name"
echo "Backup erstellt: $ziel/$name"
EOF
chmod +x backup.sh
```

### 2. Backup: alte Sicherungen löschen (5 P.)

```bash
cat >> backup.sh <<'EOF'
find "$ziel" -mindepth 1 -maxdepth 1 -type d -name 'backup_*' -mtime +7 -exec rm -rf {} +
EOF
```

### 3. Logfile-Analyzer (log_analyzer.sh) (10 P.)

```bash
cat > log_analyzer.sh <<'EOF'
#!/bin/bash
log=$1
if [ ! -f "$log" ]; then
  echo "Fehler: Datei '$log' nicht gefunden." >&2
  exit 1
fi
e=$(grep -cw ERROR "$log")
w=$(grep -cw WARNING "$log")
i=$(grep -cw INFO "$log")
echo "ERROR: $e, WARNING: $w, INFO: $i"
EOF
chmod +x log_analyzer.sh
```

### 4. Log-Analyzer: nur ein Level (5 P.)

```bash
cat > log_analyzer.sh <<'EOF'
#!/bin/bash
log=$1
level=$2
if [ ! -f "$log" ]; then
  echo "Fehler: Datei '$log' nicht gefunden." >&2
  exit 1
fi
if [ -n "$level" ]; then
  echo "$level: $(grep -cw "$level" "$log")"
  exit 0
fi
e=$(grep -cw ERROR "$log")
w=$(grep -cw WARNING "$log")
i=$(grep -cw INFO "$log")
echo "ERROR: $e, WARNING: $w, INFO: $i"
EOF
```

### 5. Dateien verschieben mit Protokoll (mvprot.sh) (10 P.)

```bash
cat > mvprot.sh <<'EOF'
#!/bin/bash
endung=$1
ordner=$2
protokoll=$3
if [ $# -ne 3 ]; then
  echo "Aufruf: $0 ENDUNG ORDNER ja|nein" >&2
  exit 1
fi
mkdir -p "$ordner"
anzahl=0
namen=""
for f in *."$endung"; do
  [ -f "$f" ] || continue
  mv "$f" "$ordner/"
  anzahl=$((anzahl + 1))
  namen="$namen $f"
done
if [ "$protokoll" = "ja" ]; then
  echo "Verschoben: $anzahl Dateien nach $ordner:$namen" > mvprot.log
  echo "$anzahl Dateien nach ./$ordner verschoben. Protokoll: ./mvprot.log"
else
  echo "$anzahl Dateien nach ./$ordner verschoben."
fi
EOF
chmod +x mvprot.sh
```

## Shell-Skripte (schwer): Benutzerverwaltung

Slug: `linux-skripte-benutzerverwaltung` · 3 Schritte · 30 Punkte

### 1. Benutzer anlegen (add) (10 P.)

```bash
cat > user_manager.sh <<'EOF'
#!/bin/bash
db=benutzer.db
hilfe() {
  echo "Aufruf: $0 add|delete NAME" >&2
  exit 1
}
[ $# -ge 2 ] || hilfe
befehl=$1
name=$2
touch "$db"
case "$befehl" in
  add)
    if grep -q "^$name:" "$db"; then
      echo "Fehler: Benutzer $name existiert bereits." >&2
      exit 1
    fi
    echo "$name:schueler:-" >> "$db"
    echo "Benutzer $name wurde erfolgreich angelegt."
    ;;
  *)
    hilfe
    ;;
esac
EOF
chmod +x user_manager.sh
```

### 2. Benutzer löschen (delete) (10 P.)

```bash
cat > user_manager.sh <<'EOF'
#!/bin/bash
db=benutzer.db
hilfe() {
  echo "Aufruf: $0 add|delete NAME" >&2
  exit 1
}
[ $# -ge 2 ] || hilfe
befehl=$1
name=$2
touch "$db"
case "$befehl" in
  add)
    if grep -q "^$name:" "$db"; then
      echo "Fehler: Benutzer $name existiert bereits." >&2
      exit 1
    fi
    echo "$name:schueler:-" >> "$db"
    echo "Benutzer $name wurde erfolgreich angelegt."
    ;;
  delete)
    if ! grep -q "^$name:" "$db"; then
      echo "Fehler: Benutzer $name existiert nicht." >&2
      exit 1
    fi
    grep -v "^$name:" "$db" > "$db.tmp"
    mv "$db.tmp" "$db"
    echo "Benutzer $name wurde gelöscht."
    ;;
  *)
    hilfe
    ;;
esac
EOF
```

### 3. Passwort und Gruppe (10 P.)

```bash
cat > user_manager.sh <<'EOF'
#!/bin/bash
db=benutzer.db
hilfe() {
  echo "Aufruf: $0 add NAME [GRUPPE] | delete NAME" >&2
  exit 1
}
[ $# -ge 2 ] || hilfe
befehl=$1
name=$2
gruppe=$3
[ -n "$gruppe" ] || gruppe=schueler
touch "$db"
case "$befehl" in
  add)
    if grep -q "^$name:" "$db"; then
      echo "Fehler: Benutzer $name existiert bereits." >&2
      exit 1
    fi
    passwort=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 10)
    echo "$name:$gruppe:$passwort" >> "$db"
    echo "Benutzer $name wurde erfolgreich angelegt (Gruppe: $gruppe, Passwort: $passwort)."
    ;;
  delete)
    if ! grep -q "^$name:" "$db"; then
      echo "Fehler: Benutzer $name existiert nicht." >&2
      exit 1
    fi
    grep -v "^$name:" "$db" > "$db.tmp"
    mv "$db.tmp" "$db"
    echo "Benutzer $name wurde gelöscht."
    ;;
  *)
    hilfe
    ;;
esac
EOF
```
