---
slug: c-grundlagen
title: C-Grundlagen
shell: C
tags: [c, gcc, crun, printf, scanf, schleifen, arrays, strings, funktionen, zeiger, gdb, valgrind]
order: 60
---

## Kompilieren & Starten

| Befehl | Bedeutung |
|---|---|
| **Run** (Editor) / `crun` | alle `*.c` im Ordner → `./main` kompilieren und starten |
| `crun -- 3 4` | mit Argumenten starten |
| `gcc -std=c11 -Wall -Wextra -o main main.c` | selbst kompilieren (Warnungen an!) |
| `gcc -o main main.c util.c -lm` | mehrere Dateien, `-lm` für `math.h` |
| `./main` / `./main < eingabe.txt` | starten / Eingabe aus Datei |
| `echo "3 4" \| ./main` | Eingabe per Pipe |
| `echo $?` | Rückgabewert von `main` |

## Grundgerüst

```c
#include <stdio.h>

int main(void) {
    printf("Hallo Welt!\n");
    return 0;
}
```

## Datentypen

| Typ | Beispiel | printf / scanf |
|---|---|---|
| `int` | `int n = 42;` | `%d` |
| `long` | `long g = 1L << 40;` | `%ld` |
| `double` | `double x = 3.14;` | `%f` / `%.2f` · scanf: `%lf` |
| `char` | `char c = 'A';` | `%c` |
| `char[]` | `char name[50];` | `%s` |
| `unsigned` / `size_t` | `size_t n = sizeof(a);` | `%u` / `%zu` |

## Ein- und Ausgabe

```c
int a, b;
if (scanf("%d %d", &a, &b) != 2) {      // & nicht vergessen!
    printf("Ungültige Eingabe\n");
    return 1;
}
printf("Summe: %d\n", a + b);
printf("%5.2f|%-10s|\n", 3.14159, "links"); // Breite, Nachkommastellen
```

Ganze Zeile lesen: `fgets(zeile, sizeof zeile, stdin);`

## Kontrollstrukturen

```c
if (x > 0) { … } else if (x == 0) { … } else { … }

for (int i = 0; i < n; i++) { … }
while (n > 0) { n--; }
do { … } while (bedingung);

switch (op) {
    case '+': r = a + b; break;
    default:  printf("?\n");
}
```

`break` verlässt die Schleife, `continue` springt zum nächsten Durchlauf.

## Arrays & Strings

```c
int zahlen[5] = {3, 1, 4, 1, 5};
int n = sizeof zahlen / sizeof zahlen[0];   // 5 (nur beim echten Array!)

#include <string.h>
char s[20] = "Hallo";
strlen(s);            // 5 (ohne '\0')
strcpy(ziel, s);      // kopieren (Ziel groß genug!)
strcmp(a, b) == 0     // gleich?
```

Indizes gehen von `0` bis `n - 1` – `zahlen[5]` ist schon außerhalb!

## Funktionen

```c
int quadrat(int x);            // Prototyp (z. B. in util.h)

int quadrat(int x) {           // Definition (z. B. in util.c)
    return x * x;
}
```

Header einbinden: `#include "util.h"` · kompilieren: `gcc -o main main.c util.c`

## Zeiger

```c
int x = 5;
int *p = &x;    // p zeigt auf x
*p = 7;         // x ist jetzt 7

void tausche(int *a, int *b) { int t = *a; *a = *b; *b = t; }
tausche(&x, &y);
```

Speicher anfordern: `int *a = malloc(n * sizeof *a);` … `free(a);` (`#include <stdlib.h>`)

## Häufige Fehler

| Meldung / Verhalten | Ursache |
|---|---|
| `Segmentation fault` | ungültiger Zeiger, Array-Index außerhalb, `&` bei `scanf` vergessen |
| `implicit declaration of function` | `#include` oder Prototyp fehlt |
| `undefined reference to 'sqrt'` | `-lm` fehlt |
| `undefined reference to 'main'` | keine `main`-Funktion / falsche Datei |
| Programm „hängt“ | Endlosschleife oder wartet auf Eingabe (`Strg+C` beendet) |
| `if (x = 5)` ist immer wahr | `=` statt `==` |
| Ganzzahl-Division `7 / 2 == 3` | `7.0 / 2` oder `(double)a / b` |

## Fehlersuche

| Befehl | Bedeutung |
|---|---|
| `gdb ./main` → `run`, `bt`, `print x`, `break 12`, `next` | Debugger (mit `-g` kompilieren, `crun` macht das) |
| `valgrind ./main` | Speicherfehler und Lecks finden |
| `printf("x=%d\n", x);` | der Klassiker |
