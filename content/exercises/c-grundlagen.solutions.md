# C-Grundlagen – Musterlösungen

Zu `content/exercises/c-grundlagen.json`; wird nicht importiert. Jeder Schritt zeigt den
Stand der Dateien, mit dem er besteht (im Übungsordner `~/exercises/<slug>`).

## C 01 · Hallo Welt

Slug: `c-01-hallo-welt`

### 1. Hallo Welt!

**main.c**
```c
#include <stdio.h>

int main(void) {
    printf("Hallo Welt!\n");
    return 0;
}
```

### 2. Mehrere Zeilen

**main.c**
```c
#include <stdio.h>

int main(void) {
    printf("Hallo Welt!\n");
    printf("Ich lerne C.\n");
    return 0;
}
```

## C 02 · Rechnen mit Eingaben

Slug: `c-02-rechnen`

### 1. Summe

**main.c**
```c
#include <stdio.h>

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) {
        return 1;
    }
    printf("Summe: %d\n", a + b);
    return 0;
}
```

### 2. Alle Grundrechnungsarten

**main.c**
```c
#include <stdio.h>

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) {
        return 1;
    }
    printf("Summe: %d\n", a + b);
    printf("Differenz: %d\n", a - b);
    printf("Produkt: %d\n", a * b);
    if (b == 0) {
        printf("Quotient: nicht definiert\n");
    } else {
        printf("Quotient: %.2f\n", (double)a / b);
    }
    return 0;
}
```

## C 03 · Schleifen

Slug: `c-03-schleifen`

### 1. Summe 1 bis n

**main.c**
```c
#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) {
        return 1;
    }
    long summe = 0;
    for (int i = 1; i <= n; i++) {
        summe += i;
    }
    printf("%ld\n", summe);
    return 0;
}
```

### 2. FizzBuzz

**main.c**
```c
#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) {
        return 1;
    }
    for (int i = 1; i <= n; i++) {
        if (i % 15 == 0) {
            printf("FizzBuzz\n");
        } else if (i % 3 == 0) {
            printf("Fizz\n");
        } else if (i % 5 == 0) {
            printf("Buzz\n");
        } else {
            printf("%d\n", i);
        }
    }
    return 0;
}
```

## C 04 · Kommandozeilen-Argumente

Slug: `c-04-argumente`

### 1. Alle begrüßen

**main.c**
```c
#include <stdio.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("Niemand da.\n");
        return 1;
    }
    for (int i = 1; i < argc; i++) {
        printf("Hallo %s!\n", argv[i]);
    }
    return 0;
}
```

### 2. Längster Name

**main.c**
```c
#include <stdio.h>
#include <string.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("Niemand da.\n");
        return 1;
    }
    int laengster = 1;
    for (int i = 1; i < argc; i++) {
        printf("Hallo %s!\n", argv[i]);
        if (strlen(argv[i]) > strlen(argv[laengster])) {
            laengster = i;
        }
    }
    printf("Längster Name: %s\n", argv[laengster]);
    return 0;
}
```

## C 05 · Arrays

Slug: `c-05-arrays`

### 1. Minimum, Maximum, Durchschnitt

**main.c**
```c
#include <stdio.h>

#define MAX 100

int main(void) {
    int zahlen[MAX];
    int n;
    if (scanf("%d", &n) != 1 || n < 1 || n > MAX) {
        printf("Ungültige Anzahl\n");
        return 1;
    }
    for (int i = 0; i < n; i++) {
        scanf("%d", &zahlen[i]);
    }
    int min = zahlen[0], max = zahlen[0];
    long summe = 0;
    for (int i = 0; i < n; i++) {
        if (zahlen[i] < min) min = zahlen[i];
        if (zahlen[i] > max) max = zahlen[i];
        summe += zahlen[i];
    }
    printf("Min: %d\n", min);
    printf("Max: %d\n", max);
    printf("Schnitt: %.2f\n", (double)summe / n);
    return 0;
}
```

### 2. Rückwärts und sortiert

**main.c**
```c
#include <stdio.h>

#define MAX 100

int main(void) {
    int zahlen[MAX];
    int n;
    if (scanf("%d", &n) != 1 || n < 1 || n > MAX) {
        printf("Ungültige Anzahl\n");
        return 1;
    }
    for (int i = 0; i < n; i++) {
        scanf("%d", &zahlen[i]);
    }
    int min = zahlen[0], max = zahlen[0];
    long summe = 0;
    for (int i = 0; i < n; i++) {
        if (zahlen[i] < min) min = zahlen[i];
        if (zahlen[i] > max) max = zahlen[i];
        summe += zahlen[i];
    }
    printf("Min: %d\n", min);
    printf("Max: %d\n", max);
    printf("Schnitt: %.2f\n", (double)summe / n);

    printf("Rueckwaerts:");
    for (int i = n - 1; i >= 0; i--) {
        printf(" %d", zahlen[i]);
    }
    printf("\n");

    for (int i = 0; i < n - 1; i++) {          // Bubblesort
        for (int j = 0; j < n - 1 - i; j++) {
            if (zahlen[j] > zahlen[j + 1]) {
                int t = zahlen[j];
                zahlen[j] = zahlen[j + 1];
                zahlen[j + 1] = t;
            }
        }
    }
    printf("Sortiert:");
    for (int i = 0; i < n; i++) {
        printf(" %d", zahlen[i]);
    }
    printf("\n");
    return 0;
}
```

## C 06 · Funktionen und mehrere Dateien

Slug: `c-06-funktionen`

### 1. ggT als Funktion

**main.c**
```c
#include <stdio.h>

int ggt(int a, int b) {
    while (b != 0) {
        int r = a % b;
        a = b;
        b = r;
    }
    return a;
}

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) {
        return 1;
    }
    printf("ggT: %d\n", ggt(a, b));
    return 0;
}
```

### 2. Eigene Datei: mathe.c / mathe.h

**mathe.h**
```c
#ifndef MATHE_H
#define MATHE_H

int ggt(int a, int b);
int kgv(int a, int b);

#endif
```

**mathe.c**
```c
#include "mathe.h"

int ggt(int a, int b) {
    while (b != 0) {
        int r = a % b;
        a = b;
        b = r;
    }
    return a;
}

int kgv(int a, int b) {
    return a / ggt(a, b) * b;
}
```

**main.c**
```c
#include <stdio.h>
#include "mathe.h"

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) {
        return 1;
    }
    printf("ggT: %d\n", ggt(a, b));
    printf("kgV: %d\n", kgv(a, b));
    return 0;
}
```
