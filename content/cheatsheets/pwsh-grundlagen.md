---
slug: pwsh-grundlagen
title: PowerShell-Grundlagen
shell: PWSH
tags: [powershell, grundlagen, prozesse, services, export, dateien, skripte, csv, funktionen, functions, param, automatisierung, try-catch, pipes]
order: 10
---

## Hilfe & Erkunden

| Befehl | Bedeutung |
|---|---|
| `Get-Help Get-ChildItem -Examples` | Hilfe mit Beispielen |
| `Get-Command *service*` | Cmdlets suchen |
| `Get-Member` (`gm`) | Eigenschaften / Methoden eines Objekts |
| `Get-Alias ls` | was hinter einem Alias steckt |

```powershell
Get-Process | Get-Member
```

## Dateien & Ordner

| Cmdlet | Alias | Bedeutung |
|---|---|---|
| `Get-Location` | `pwd` | aktueller Ordner |
| `Set-Location ordner` | `cd` | wechseln |
| `Get-ChildItem -Recurse -Filter *.log` | `ls`, `gci` | auflisten |
| `New-Item a.txt -ItemType File` | | Datei anlegen |
| `New-Item dir -ItemType Directory` | `mkdir` | Ordner anlegen |
| `Copy-Item` / `Move-Item` / `Remove-Item` | `cp` / `mv` / `rm` | kopieren / verschieben / löschen |
| `Get-Content a.txt` | `cat` | lesen |
| `Set-Content` / `Add-Content` | | schreiben / anhängen |
| `Test-Path a.txt` | | existiert? (`$true` / `$false`) |

## Pipeline (Objekte!)

```powershell
Get-Process |
  Where-Object { $_.CPU -gt 10 } |
  Sort-Object CPU -Descending |
  Select-Object -First 5 Name, CPU
```

| Cmdlet | Zweck |
|---|---|
| `Where-Object { $_.X -eq 1 }` | filtern (`$_` = aktuelles Objekt) |
| `Select-Object Name, Id` / `-First 3` | Spalten / Anzahl |
| `Sort-Object Name -Descending` | sortieren |
| `Measure-Object -Sum Length` | zählen / summieren |
| `Group-Object Status` | gruppieren |
| `ForEach-Object { $_.Name }` | für jedes Objekt |

## Vergleichsoperatoren

| | | | |
|---|---|---|---|
| `-eq` | = | `-ne` | ≠ |
| `-gt` / `-ge` | > / ≥ | `-lt` / `-le` | < / ≤ |
| `-like "*.txt"` | Wildcard | `-match "^a"` | Regex |
| `-and` / `-or` / `-not` | logisch | `-contains` | in Liste |

## Variablen

```powershell
$name = "Anna"
$zahlen = 1, 2, 3
$person = @{ Name = "Anna"; Alter = 17 }
"Hallo $name, du bist $($person.Alter)"
$zahlen.Count
```

## Bedingungen & Schleifen

```powershell
if ($n -gt 5) { "groß" } elseif ($n -eq 5) { "fünf" } else { "klein" }
foreach ($f in Get-ChildItem *.txt) { $f.Name }
for ($i = 0; $i -lt 3; $i++) { $i }
```

## Funktionen mit param()

```powershell
function Get-Gruss {
  param(
    [Parameter(Mandatory)][string]$Name,
    [int]$Anzahl = 1
  )
  1..$Anzahl | ForEach-Object { "Hallo $Name" }
}
Get-Gruss -Name Anna -Anzahl 2
```

Aufruf **ohne** Klammern und Kommas: `Get-Gruss -Name Anna`, nicht `Get-Gruss("Anna", 2)`.

## Fehler abfangen

```powershell
try {
  Get-Content fehlt.txt -ErrorAction Stop
} catch {
  Write-Warning "Fehler: $($_.Exception.Message)"
}
```

## Export

```powershell
Get-Service | Export-Csv dienste.csv -NoTypeInformation
Import-Csv dienste.csv | Where-Object Status -eq Running
Get-Process | ConvertTo-Json | Out-File p.json
```

## Dienste & Prozesse

```powershell
Get-Service | Where-Object Status -eq Running
Restart-Service -Name spooler
Get-Process -Name pwsh
Stop-Process -Id 1234
```
