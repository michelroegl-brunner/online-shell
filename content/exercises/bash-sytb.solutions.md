# Bash (SYTB) – Musterlösungen

Zu `content/lessons/bash-sytb.json` (Lektionen) und `content/exercises/bash-sytb.json`
(Übungen); wird nicht importiert. Nach den SYTB-3-Unterlagen (`01_scripts` bis `09_funktionen`), dazu Bash 00 (Grundbefehle) als Einstieg.
Alle Befehle im jeweiligen Übungsordner `~/exercises/<slug>`.

## Bash 00 · Grundbefehle (Lektion)

Slug: `bash-00-grundlagen` · 10 Schritte · Lektion (unbewertet)

### 1. echo und >

```bash
echo Hallo Linux > hallo.txt
cat hallo.txt
```

### 2. Anhängen mit >>

```bash
echo Zweite Zeile >> hallo.txt
```

### 3. pwd

```bash
pwd > ort.txt
```

### 4. Versteckte Dateien mit ls -a

```bash
ls -a > alle.txt
```

### 5. cat hängt Dateien zusammen

```bash
cat teil1.txt teil2.txt > ganz.txt
```

### 6. mkdir, cd und touch

```bash
mkdir -p projekt/src
cd projekt/src
touch main.sh
cd ../..
```

### 7. cp und mv

```bash
cp einkauf.txt projekt/
mv notiz.txt notiz-alt.txt
```

### 8. rm

```bash
rm muell.txt
rm -r alt
```

### 9. head und wc

```bash
head -n 3 namen.txt > top3.txt
wc -l namen.txt > anzahl.txt
```

### 10. grep, sort und die Pipe

```bash
grep Linz staedte.txt > linz.txt
cat namen.txt | sort > sortiert.txt
```

## Bash 00 · Grundbefehle (Übung)

Slug: `bash-00-grundlagen-ue` · 8 Schritte · 14 Punkte

### 1. Ordnerstruktur (2 P.)

```bash
mkdir -p schule/deutsch schule/mathe schule/informatik
```

### 2. Steckbrief (2 P.)

```bash
echo "Name: Max Muster" > steckbrief.txt
echo "Klasse: 3AHITS" >> steckbrief.txt
echo "Hobby: Programmieren" >> steckbrief.txt
```

### 3. Downloads einsortieren (2 P.)

```bash
mv downloads/skript.sh schule/informatik/
cp downloads/aufsatz.txt schule/deutsch/
```

### 4. Aufräumen (1 P.)

```bash
rm downloads/werbung.jpg
rm -r tmp
```

### 5. Versteckte Nachricht (2 P.)

```bash
ls -a geheim
cat geheim/.nachricht > gefunden.txt
```

### 6. Schüler zählen (2 P.)

```bash
wc -l < schueler.txt > anzahl.txt
```

### 7. Klasse filtern (2 P.)

```bash
grep 3AHITS schueler.txt | sort > klasse.txt
```

### 8. Das Ende vom Log (1 P.)

```bash
tail -n 2 system.log > letzte.txt
```

## Bash 01 · Skripte (Lektion)

Slug: `bash-01-skripte` · 5 Schritte · Lektion (unbewertet)

### 1. Hello World mit sh

```bash
printf '# Hello World Skript\necho Hello World\n' > hello.sh
sh hello.sh
```

### 2. Shebang und eXecute-Flag

```bash
printf '#!/bin/sh\n# Hello World Skript\necho Hello World\n' > hello.sh
chmod u+x hello.sh
./hello.sh
```

### 3. Warum ./ ?

```bash
echo $PATH > path.txt
```

### 4. Argumente $#, $0, $1 …

```bash
printf '#!/bin/sh\necho $#\necho $0\necho $1\necho $2\necho $3\n' > args.sh
chmod u+x args.sh
./args.sh eins zwei drei vier
```

### 5. Alle Argumente mit $@

```bash
cat > alle.sh <<'EOF'
#!/bin/sh
for arg in "$@"
do
  echo "$arg"
done
EOF
chmod u+x alle.sh
```

## Bash 01 · Skripte (Übung)

Slug: `bash-01-skripte-ue` · 5 Schritte · 22 Punkte

### 1. Directory-Struktur (build_dirs.sh) (5 P.)

```bash
cat > build_dirs.sh <<'EOF'
#!/bin/bash
mkdir -p "$1/$1_01" "$1/$1_02"
touch "$1/$1_01/$1.01."{1,2,3}.txt "$1/$1_02/$1.02."{1,2,3}.txt
EOF
chmod u+x build_dirs.sh
```

### 2. Aufräumen (clean_dir.sh) (3 P.)

```bash
printf '#!/bin/bash\nrm -r "$1"\n' > clean_dir.sh
chmod u+x clean_dir.sh
```

### 3. Skript-Generator (makescript.sh) (5 P.)

```bash
cat > makescript.sh <<'EOF'
#!/bin/bash
f="$1.sh"
echo '#!/bin/sh' > "$f"
echo '' >> "$f"
echo "echo \"$1 Skript\"" >> "$f"
echo '' >> "$f"
echo '# write your script here' >> "$f"
chmod u+x "$f"
EOF
chmod u+x makescript.sh
```

### 4. Headline Cat (headline_cat.sh) (5 P.)

```bash
cat > headline_cat.sh <<'EOF'
#!/bin/bash
> result.txt
for f in "$@"
do
  echo "== $f ==========================================" >> result.txt
  cat "$f" >> result.txt
  echo >> result.txt
done
EOF
chmod u+x headline_cat.sh
```

### 5. Zufallskopie (randcp.sh) (4 P.)

```bash
cat > randcp.sh <<'EOF'
#!/bin/bash
for f in "$@"
do
  cp "$f" "$f.$RANDOM"
done
EOF
chmod u+x randcp.sh
```

## Bash 02 · Command Substitution (Lektion)

Slug: `bash-02-cmdsubst` · 4 Schritte · Lektion (unbewertet)

### 1. Das aktuelle Datum

```bash
echo "Das aktuelle Datum ist $(date)" > datum.txt
```

### 2. In einer Woche

```bash
echo "Heute $(date -I) in einer Woche ist $(date --date='+1 week' -I)" > woche.txt
```

### 3. Einträge in /etc zählen

```bash
echo "Es sind $(ls /etc | wc -l) Einträge im dir /etc" > anzahl.txt
```

### 4. Newlines werden Leerzeichen

```bash
echo $(ls dateien) > liste.txt
```

## Bash 02 · Command Substitution (Übung)

Slug: `bash-02-cmdsubst-ue` · 5 Schritte · 22 Punkte

### 1. Tage bis zum Ball (ball.sh) (5 P.)

```bash
cat > ball.sh <<'EOF'
#!/bin/bash
TAGE=$(( ( $(date -d "$1" +%s) - $(date +%s) ) / 86400 + 1 ))
echo "Es sind noch $TAGE Tage bis zum HTL Ball ($1)"
EOF
chmod u+x ball.sh
```

### 2. Zufälliger Satz (satz.sh) (6 P.)

```bash
cat > satz.sh <<'EOF'
#!/bin/bash
n=$(wc -l < wortliste.txt)
satz=""
for i in 1 2 3 4 5
do
  satz="$satz $(sed -n "$(( RANDOM % n + 1 ))p" wortliste.txt)"
done
echo $satz
EOF
chmod u+x satz.sh
```

### 3. Datierte Kopie V1 (dated_copy1.sh) (3 P.)

```bash
printf '#!/bin/bash\ncp "$1" "$(date -I)_$1"\n' > dated_copy1.sh
chmod u+x dated_copy1.sh
```

### 4. Datierte Kopie V2 (dated_copy2.sh) (4 P.)

```bash
cat > dated_copy2.sh <<'EOF'
#!/bin/bash
name=$(echo "$1" | cut -d. -f1)
ext=$(echo "$1" | cut -d. -f2)
cp "$1" "${name}_$(date -I).$ext"
EOF
chmod u+x dated_copy2.sh
```

### 5. Datierte Kopie V3 (dated_copy3.sh) (4 P.)

```bash
cat > dated_copy3.sh <<'EOF'
#!/bin/bash
for f in "$@"
do
  name=$(echo "$f" | cut -d. -f1)
  ext=$(echo "$f" | cut -d. -f2)
  cp "$f" "${name}_$(date -I).$ext"
done
EOF
chmod u+x dated_copy3.sh
```

## Bash 03 · Arithmetik (Lektion)

Slug: `bash-03-arithmetik` · 4 Schritte · Lektion (unbewertet)

### 1. let

```bash
let "a = 5 + 4"
echo $a > let.txt
```

### 2. expr

```bash
expr 2 \* 3 > expr.txt
```

### 3. Potenz mit $(( ))

```bash
echo $(( 2 ** 10 )) > potenz.txt
```

### 4. Rest einer Division

```bash
echo $(( 17 % 5 )) > rest.txt
```

## Bash 03 · Arithmetik (Übung)

Slug: `bash-03-arithmetik-ue` · 4 Schritte · 19 Punkte

### 1. Multiplizierer (multi.sh) (4 P.)

```bash
cat > multi.sh <<'EOF'
#!/bin/bash
let "r = $1 * $2"
echo $r
expr $1 \* $2
echo $(( $1 * $2 ))
EOF
chmod u+x multi.sh
```

### 2. Werkstatt-Summe (werkstatt.sh) (5 P.)

```bash
cat > werkstatt.sh <<'EOF'
#!/bin/bash
ausdruck=$(grep Werkstatt klassenkassa.csv | cut -d, -f3 | paste -sd+)
echo $(( ausdruck ))
EOF
chmod u+x werkstatt.sh
```

### 3. Zeitmessung (time_start.sh / time_stop.sh) (5 P.)

```bash
printf '#!/bin/bash\ndate +%%s > .startzeit\n' > time_start.sh
printf '#!/bin/bash\necho $(( $(date +%%s) - $(cat .startzeit) ))\n' > time_stop.sh
chmod u+x time_start.sh time_stop.sh
```

### 4. Challenge: Zufallszahl im Bereich (random.sh) (5 P.)

```bash
printf '#!/bin/bash\necho $(( RANDOM %% ($2 - $1 + 1) + $1 ))\n' > random.sh
chmod u+x random.sh
```

## Bash 04 · test und Exit-Status (Lektion)

Slug: `bash-04-test` · 4 Schritte · Lektion (unbewertet)

### 1. Exit-Status von test

```bash
test 'xyz' = 'xy'; echo $? > status.txt
```

### 2. && mit [ ]

```bash
[ 100 -gt 99 ] && echo "Yes, that's true." > ja.txt
```

### 3. || mit [ ]

```bash
[ 98 -gt 99 ] || echo "No, that's false." > nein.txt
```

### 4. Existiert ein Verzeichnis?

```bash
test -d /etc/gibtsnicht; echo $? > dir.txt
```

## Bash 04 · test und Exit-Status (Übung)

Slug: `bash-04-test-ue` · 4 Schritte · 14 Punkte

### 1. Datei zu groß (groesse.sh) (3 P.)

```bash
cat > groesse.sh <<'EOF'
#!/bin/bash
[ $(stat --printf="%s" "$1") -gt 100 ] && echo "Datei ist zu groß"
EOF
chmod u+x groesse.sh
```

### 2. V1.1: Größe OK (2 P.)

```bash
cat > groesse.sh <<'EOF'
#!/bin/bash
[ $(stat --printf="%s" "$1") -gt 100 ] && echo "Datei ist zu groß" || echo "Größe OK"
EOF
```

### 3. Dir Creator (dircreator.sh) (4 P.)

```bash
cat > dircreator.sh <<'EOF'
#!/bin/bash
[ -d "$1" ] && { echo "Warnung: $1 existiert schon:"; ls "$1"; } || mkdir "$1"
EOF
chmod u+x dircreator.sh
```

### 4. Challenge: Klassenkassa filtern (filter_list.sh) (5 P.)

```bash
cat > filter_list.sh <<'EOF'
#!/bin/bash
while read zeile
do
  betrag=$(echo "$zeile" | cut -d, -f3)
  [ $betrag -ge $2 ] && [ $betrag -le $3 ] && echo "$zeile"
done < "$1"
EOF
chmod u+x filter_list.sh
```

## Bash 05 · Bedingungen (if) (Lektion)

Slug: `bash-05-if` · 4 Schritte · Lektion (unbewertet)

### 1. Eine große Zahl (gross.sh)

```bash
cat > gross.sh <<'EOF'
#!/bin/bash
if [ $1 -gt 100 ]
then
  echo "Hey that's a large number."
fi
EOF
chmod u+x gross.sh
```

### 2. if/else (param3.sh)

```bash
cat > param3.sh <<'EOF'
#!/bin/bash
if [ -n "$3" ]
then
  echo "Parameter #3 is $3"
else
  echo "Parameter #3 fehlt"
fi
EOF
```

### 3. Logisches Und (lesbar.sh)

```bash
cat > lesbar.sh <<'EOF'
#!/bin/bash
if [ -r "$1" ] && [ -s "$1" ]
then
  echo OK
else
  echo "NICHT OK"
fi
EOF
```

### 4. Vergleich mit (( )) (vergleich.sh)

```bash
cat > vergleich.sh <<'EOF'
#!/bin/bash
x=$1
y=$2
if (( x > y ))
then
  echo "$x > $y"
else
  echo "$x <= $y"
fi
EOF
```

## Bash 05 · Bedingungen (if) (Übung)

Slug: `bash-05-if-ue` · 6 Schritte · 21 Punkte

### 1. Maximum (max.sh) (3 P.)

```bash
cat > max.sh <<'EOF'
#!/bin/bash
if [ $1 -gt $2 ]
then
  echo $1
else
  echo $2
fi
EOF
chmod u+x max.sh
```

### 2. Gerade / ungerade (gerade.sh) (3 P.)

```bash
cat > gerade.sh <<'EOF'
#!/bin/bash
if (( $1 % 2 == 0 ))
then
  echo gerade
else
  echo ungerade
fi
EOF
chmod u+x gerade.sh
```

### 3. Directory anlegen oder neu anlegen (makedir.sh) (6 P.)

```bash
cat > makedir.sh <<'EOF'
#!/bin/bash
if [ -d "$1" ]
then
  anzahl=$(ls "$1" | wc -l)
  echo -n "Soll das Directory \"$1\" (mit $anzahl Files) gelöscht werden? [j|n]: "
  read antwort
  if [ "$antwort" != "j" ]
  then
    exit 0
  fi
  rm -r "$1"
fi
mkdir "$1"
echo "$1" > "$1/$1.txt"
EOF
chmod u+x makedir.sh
```

### 4. Challenge: Zeilen nummerieren (number.sh) (4 P.)

```bash
cat > number.sh <<'EOF'
#!/bin/bash
if [ ! -r "$1" ] || [ ! -s "$1" ]
then
  echo "Fehler: $1 existiert nicht, ist nicht lesbar oder leer"
  exit 1
fi
nl "$1" > "$1.tmp"
mv "$1.tmp" "$1"
EOF
chmod u+x number.sh
```

### 5. Challenge: number.sh mit stdin (3 P.)

```bash
cat > number.sh <<'EOF'
#!/bin/bash
if [ -z "$1" ]
then
  nl /dev/stdin
  exit 0
fi
if [ ! -r "$1" ] || [ ! -s "$1" ]
then
  echo "Fehler: $1 existiert nicht, ist nicht lesbar oder leer"
  exit 1
fi
nl "$1" > "$1.tmp"
mv "$1.tmp" "$1"
EOF
```

### 6. Challenge: number.sh -? (2 P.)

```bash
cat > number.sh <<'EOF'
#!/bin/bash
if [ "$1" = "-?" ]
then
  echo "number.sh: number lines of input"
  echo "usage: number.sh [FILE]"
  echo "FILE ... path to readable file of nonzero length"
  echo "if FILE is omitted data is read from standard input"
  exit 0
fi
if [ -z "$1" ]
then
  nl /dev/stdin
  exit 0
fi
if [ ! -r "$1" ] || [ ! -s "$1" ]
then
  echo "Fehler: $1 existiert nicht, ist nicht lesbar oder leer"
  exit 1
fi
nl "$1" > "$1.tmp"
mv "$1.tmp" "$1"
EOF
```

## Bash 06 · Schleifen (Lektion)

Slug: `bash-06-schleifen` · 5 Schritte · Lektion (unbewertet)

### 1. for über $@ (params.sh)

```bash
printf '#!/bin/bash\nfor var in "$@"\ndo\n  echo Param: $var\ndone\n' > params.sh
```

### 2. Schleife mit seq

```bash
for x in $(seq 1 10); do echo "hallo $x"; done > hallo.txt
```

### 3. Wildcards

```bash
for f in /etc/*.conf; do basename "$f"; done > conf.txt
```

### 4. Countdown mit for (( ))

```bash
for (( i=10; i>=1; i-- )); do echo $i; done > countdown.txt
```

### 5. while

```bash
p=1; while (( p < 1000 )); do echo $p; ((p=p*2)); done > potenzen.txt
```

## Bash 06 · Schleifen 1 (Übung)

Slug: `bash-06-schleifen-ue` · 4 Schritte · 15 Punkte

### 1. Summe und Maximum (summax.sh) (4 P.)

```bash
cat > summax.sh <<'EOF'
#!/bin/bash
summe=0
max=0
for z in "$@"
do
  summe=$(( summe + z ))
  if (( z > max )); then max=$z; fi
done
echo "Summe: $summe"
echo "Maximum: $max"
EOF
chmod u+x summax.sh
```

### 2. Minimum (min.sh) (4 P.)

```bash
cat > min.sh <<'EOF'
#!/bin/bash
min=""
for z in $(cat "$1")
do
  if [ -z "$min" ] || (( z < min )); then min=$z; fi
done
echo $min
EOF
chmod u+x min.sh
```

### 3. Summe und Durchschnitt von stdin (avg.sh) (4 P.)

```bash
cat > avg.sh <<'EOF'
#!/bin/bash
summe=0
anzahl=0
for z in $(cat)
do
  summe=$(( summe + z ))
  anzahl=$(( anzahl + 1 ))
done
echo "Summe: $summe"
echo "Durchschnitt: $(( summe / anzahl ))"
EOF
chmod u+x avg.sh
```

### 4. Durchschnitt im Lager (3 P.)

```bash
cut -d, -f2 lager.csv | tail -n +2 | bash avg.sh > lager_avg.txt
```

## Bash 06 · Schleifen 2 (Übung)

Slug: `bash-06-schleifen-2-ue` · 5 Schritte · 21 Punkte

### 1. Armstrong-Zahlen dreistellig (armstrong3.sh) (4 P.)

```bash
cat > armstrong3.sh <<'EOF'
#!/bin/bash
for (( n=100; n<=999; n++ ))
do
  a=$(( n / 100 )); b=$(( n / 10 % 10 )); c=$(( n % 10 ))
  if (( a**3 + b**3 + c**3 == n )); then echo $n; fi
done
EOF
chmod u+x armstrong3.sh
```

### 2. Armstrong-Zahlen vierstellig (armstrong4.sh) (4 P.)

```bash
cat > armstrong4.sh <<'EOF'
#!/bin/bash
for (( n=1000; n<=9999; n++ ))
do
  s=0; x=$n
  while (( x > 0 )); do (( s += (x % 10)**4, x /= 10 )); done
  if (( s == n )); then echo $n; fi
done
EOF
chmod u+x armstrong4.sh
```

### 3. Primzahl (prim.sh) (4 P.)

```bash
cat > prim.sh <<'EOF'
#!/bin/bash
n=$1
if (( n < 2 )); then echo "$n ist keine Primzahl"; exit 1; fi
for (( i=2; i*i<=n; i++ ))
do
  if (( n % i == 0 )); then echo "$n ist keine Primzahl"; exit 1; fi
done
echo "$n ist eine Primzahl"
exit 0
EOF
chmod u+x prim.sh
```

### 4. Primzahlen zählen (primzahlen.sh) (4 P.)

```bash
cat > primzahlen.sh <<'EOF'
#!/bin/bash
anzahl=0
for n in $(seq 1 1000)
do
  bash ./prim.sh $n > /dev/null && anzahl=$(( anzahl + 1 ))
done
echo $anzahl
EOF
chmod u+x primzahlen.sh
```

### 5. ls on steroids (lsx.sh) (5 P.)

```bash
cat > lsx.sh <<'EOF'
#!/bin/bash
[ -d "$1" ] || exit 1
for e in "$1"/*
do
  [ -e "$e" ] || continue
  if [ -d "$e" ]
  then
    echo "$(basename "$e") $(ls "$e" | wc -l)"
  else
    echo "$(basename "$e") $(stat --printf="%s" "$e")"
  fi
done
EOF
chmod u+x lsx.sh
```

## Bash 07 · SSH und SCP (Lektion)

Slug: `bash-07-ssh-scp` · 5 Schritte · Lektion (unbewertet)

### 1. Anmelden

```bash
echo 'ssh admin@10.10.10.11' > ssh1.txt
```

### 2. Befehl remote ausführen

```bash
echo "ssh root@123.123.123.123 'uname -a'" > ssh2.txt
```

### 3. Datei hochladen

```bash
echo 'scp bericht.txt admin@10.10.10.11:/home/admin/backup/' > scp1.txt
```

### 4. Datei herunterladen

```bash
echo 'scp admin@10.10.10.11:/var/log/syslog syslog.txt' > scp2.txt
```

### 5. Ordner rekursiv kopieren

```bash
echo 'scp -r projects admin@10.10.10.11:/home/admin/backup/' > scp3.txt
```

## Bash 08 · Funktionen (Lektion)

Slug: `bash-08-funktionen` · 4 Schritte · Lektion (unbewertet)

### 1. Erste Funktion (hello_fn.sh)

```bash
cat > hello_fn.sh <<'EOF'
#!/bin/bash
myfunction()
{
  echo Hello World
}
myfunction
myfunction
EOF
```

### 2. Parameter sind lokal (functions.sh)

```bash
cat > functions.sh <<'EOF'
#!/bin/bash
echo $1
echo $2
myfunction()
{
  echo $1 $2
}
myfunction Guten Morgen
myfunction Liebe 3AHITS
echo $1
echo $2
EOF
```

### 3. return (gross_fn.sh)

```bash
cat > gross_fn.sh <<'EOF'
#!/bin/bash
ist_gross()
{
  if [ $1 -gt 100 ]; then return 0; fi
  return 1
}
ist_gross $1
if [ $? -eq 0 ]; then echo groß; else echo klein; fi
EOF
```

### 4. Wert über echo zurückgeben (quadrat.sh)

```bash
cat > quadrat.sh <<'EOF'
#!/bin/bash
quadrat()
{
  echo $(( $1 * $1 ))
}
ergebnis=$(quadrat $1)
echo "Quadrat: $ergebnis"
EOF
```

## Bash 08 · Funktionen (Übung)

Slug: `bash-08-funktionen-ue` · 3 Schritte · 18 Punkte

### 1. Funktion passwd (adduser.sh) (6 P.)

```bash
cat > adduser.sh <<'EOF'
#!/bin/bash
ROOT=sysroot

passwd()
{
  uid=$(awk -F: '$3>=1000 && $3<60000 {print $3}' $ROOT/etc/passwd | sort -n | tail -n1)
  uid=$(( ${uid:-999} + 1 ))
  echo "$1:x:$uid:$uid:,,,:/home/$1:/bin/bash" >> $ROOT/etc/passwd
  mkdir -p $ROOT/home/$1
  chmod 700 $ROOT/home/$1
}

for user in "$@"
do
  passwd $user
done
EOF
chmod u+x adduser.sh
```

### 2. Funktion shadow (6 P.)

```bash
cat > adduser.sh <<'EOF'
#!/bin/bash
ROOT=sysroot

passwd()
{
  uid=$(awk -F: '$3>=1000 && $3<60000 {print $3}' $ROOT/etc/passwd | sort -n | tail -n1)
  uid=$(( ${uid:-999} + 1 ))
  echo "$1:x:$uid:$uid:,,,:/home/$1:/bin/bash" >> $ROOT/etc/passwd
  mkdir -p $ROOT/home/$1
  chmod 700 $ROOT/home/$1
}

shadow()
{
  read -p "Passwort wie Benutzername? [j|n]: " antwort
  if [ "$antwort" = "j" ]
  then
    pw=$1
  else
    read -s -p "Passwort: " pw
    echo
  fi
  echo "$1:$(openssl passwd -6 "$pw"):19000:0:99999:7:::" >> $ROOT/etc/shadow
}

for user in "$@"
do
  passwd $user
  shadow $user
done
EOF
```

### 3. Primzahl mit Funktionen (primzahl.sh) (6 P.)

```bash
cat > primzahl.sh <<'EOF'
#!/bin/bash
ist_prim()
{
  local n=$1 i
  (( n < 2 )) && return 1
  for (( i=2; i*i<=n; i++ )); do
    (( n % i == 0 )) && return 1
  done
  return 0
}

echo "1) Ist eine Zahl eine Primzahl?"
echo "2) Alle Primzahlen von 1 bis 3000 anzeigen"
read -p "Auswahl: " auswahl
if [ "$auswahl" = 1 ]
then
  read -p "Zahl: " n
  if ist_prim $n; then echo "$n ist eine Primzahl"; else echo "$n ist keine Primzahl"; fi
elif [ "$auswahl" = 2 ]
then
  for (( n=1; n<=3000; n++ )); do
    ist_prim $n && echo $n
  done
fi
EOF
chmod u+x primzahl.sh
```
