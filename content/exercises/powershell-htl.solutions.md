# PowerShell-Serien – Musterlösungen

Referenzlösungen zu `powershell-htl.json` (für Lehrkräfte, wird nicht importiert). Alle Lösungen laufen im Übungsordner der jeweiligen Übung und wurden gegen die automatischen Checks getestet.

## PowerShell Serie 1: Prozesse und Services

`ps-serie-1-prozesse-services` · 40 Punkte

### 1. Prozesse nach CPU sortieren (5 P.)

```powershell
Get-Process | Sort-Object CPU -Descending | Select-Object Name, Id, CPU | Export-Csv prozesse.csv -NoTypeInformation
```

### 2. Top 10 nach CPU-Zeit (5 P.)

```powershell
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, CPU | Export-Csv top10.csv -NoTypeInformation
```

### 3. Variable $P in eine Textdatei (5 P.)

```powershell
$P = Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
$P | Out-File A4.txt
```

### 4. $P als CSV und XML exportieren (5 P.)

```powershell
$P = Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
$P | Export-Csv .\A4.csv -NoTypeInformation
$P | Export-Clixml .\A4.xml
```

### 5. Services nach Status sortieren (5 P.)

```powershell
Get-Service | Sort-Object Status | Select-Object Name, Status | Export-Csv services.csv -NoTypeInformation
```

### 6. Name und Status in roter Schrift (5 P.)

```powershell
@'
Get-Service | ForEach-Object {
  Write-Host ("{0,-20} {1}" -f $_.Name, $_.Status) -ForegroundColor Red
}
'@ | Set-Content rot.ps1
```

### 7. Färben per if-Abfrage (5 P.)

```powershell
@'
Get-Service | ForEach-Object {
  if ($_.Status -eq 'Running') {
    Write-Host "$($_.Name) $($_.Status)" -ForegroundColor Green
  } else {
    Write-Host "$($_.Name) $($_.Status)" -ForegroundColor Red
  }
}
'@ | Set-Content farbe.ps1
```

### 8. Services als HTML (5 P.)

```powershell
Get-Service | ConvertTo-Html | Out-File services.html
```

## PowerShell Serie 2: Dateien, Skripte und Daten

`ps-serie-2-dateien-skripte-daten` · 40 Punkte

### 1. Dateien auflisten (5 P.)

```powershell
@'
Get-ChildItem /usr/bin -File | Select-Object Name, Length, CreationTime | Format-Table -AutoSize
'@ | Set-Content dateien.ps1
```

### 2. Verzeichnis mit Datum erstellen (5 P.)

```powershell
@'
$name = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$pfad = Join-Path ./Temp $name
if (-not (Test-Path $pfad)) {
  New-Item -ItemType Directory -Path $pfad -Force | Out-Null
  "Erstellt: $pfad"
} else {
  "Existiert bereits: $pfad"
}
'@ | Set-Content ordner.ps1
```

### 3. Textdatei erstellen (5 P.)

```powershell
Set-Content nachricht.txt 'Hallo aus der PowerShell! Heute lernen wir Dateien.'
```

### 4. Inhalt einer Datei lesen (5 P.)

```powershell
'Get-Content ./nachricht.txt' | Set-Content lesen.ps1
```

### 5. Dateien kopieren (5 P.)

```powershell
New-Item -ItemType Directory ziel -Force | Out-Null
Copy-Item quelle/*.txt ziel/
```

### 6. Systeminformationen abrufen (5 P.)

```powershell
@'
$ci = Get-ComputerInfo
"Computername:   $($ci.CsName)"
"Betriebssystem: $($ci.OsName)"
"RAM:            $([math]::Round($ci.CsTotalPhysicalMemory / 1GB)) GB"
'@ | Set-Content sysinfo.ps1
```

### 7. Eigene Funktion (5 P.)

```powershell
@'
function Get-Summe {
  param([double]$a, [double]$b)
  return $a + $b
}
"3 + 4 = $(Get-Summe 3 4)"
'@ | Set-Content summe.ps1
```

### 8. CSV-Datei verarbeiten (5 P.)

```powershell
@'
Vorname;Nachname;Geburtsdatum
Anna;Huber;2007-05-14
Lukas;Mayer;2006-11-02
Sara;Leitner;2008-01-21
Jonas;Gruber;2005-07-30
Lena;Wagner;2007-02-09
'@ | Set-Content benutzer.csv
Import-Csv benutzer.csv -Delimiter ';' |
  Sort-Object { [datetime]$_.Geburtsdatum } |
  Export-Csv sortiert.csv -Delimiter ';' -NoTypeInformation
```

## PowerShell Serie 3: Fortgeschrittene Automatisierung

`ps-serie-3-automatisierung` · 60 Punkte

### 1. Log-Analyse mit Fehlerbericht (10 P.)

```powershell
@'
param(
  [string]$LogPfad = './app.log',
  [string]$Ausgabe = '.'
)

function Get-LevelAnzahl([string[]]$Zeilen, [string]$Level) {
  @($Zeilen | Where-Object { $_ -match "\b$Level\b" }).Count
}

try {
  $zeilen = Get-Content -Path $LogPfad -ErrorAction Stop
  $bericht = foreach ($lvl in 'ERROR', 'WARNING', 'INFO') {
    [pscustomobject]@{ Level = $lvl; Anzahl = Get-LevelAnzahl $zeilen $lvl }
  }
  $bericht | Format-Table -AutoSize
  $datei = Join-Path $Ausgabe ("bericht_{0}.csv" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
  $bericht | Export-Csv $datei -NoTypeInformation
  "Bericht gespeichert: $datei"
  exit 0
} catch {
  Write-Error "Analyse fehlgeschlagen: $_"
  exit 1
}
'@ | Set-Content loganalyse.ps1
```

### 2. Service-Monitor mit Protokollierung (10 P.)

```powershell
@'
param(
  [string[]]$Dienste = @('Spooler', 'wuauserv', 'BITS'),
  [string]$LogDatei = './monitor.log'
)

function Write-Log([string]$Text) {
  Add-Content -Path $LogDatei -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text)
}

$fehler = $false
foreach ($name in $Dienste) {
  try {
    $s = Get-Service -Name $name -ErrorAction Stop
    if ($s.Status -eq 'Stopped') { Write-Log "!!! STOPPED !!! $name" }
    else { Write-Log "OK $name ($($s.Status))" }
  } catch {
    Write-Log "FEHLER $name nicht gefunden"
    $fehler = $true
  }
}
if ($fehler) { exit 1 } else { exit 0 }
'@ | Set-Content monitor.ps1
```

### 3. Backup mit Rotation (10 P.)

```powershell
@'
param(
  [string]$Quelle = './daten',
  [string]$Ziel = './backups',
  [int]$Behalten = 5
)

function Remove-AlteBackups([string]$Pfad, [int]$Anzahl) {
  Get-ChildItem $Pfad -Directory -Filter 'backup_*' |
    Sort-Object Name -Descending |
    Select-Object -Skip $Anzahl |
    Remove-Item -Recurse -Force
}

try {
  $neu = Join-Path $Ziel ("backup_{0}" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
  New-Item -ItemType Directory -Path $neu -Force | Out-Null
  Copy-Item -Path (Join-Path $Quelle '*') -Destination $neu -Recurse -ErrorAction Stop
  Remove-AlteBackups $Ziel $Behalten
  "Backup erstellt: $neu"
  exit 0
} catch {
  Write-Error "Backup fehlgeschlagen: $_"
  exit 1
}
'@ | Set-Content backup.ps1
```

### 4. Datei-Integrity-Check (10 P.)

```powershell
@'
param(
  [string]$Pfad = './daten',
  [string]$Referenz = './referenz.csv'
)
try {
  Get-ChildItem $Pfad -File -Recurse |
    ForEach-Object { [pscustomobject]@{ Datei = $_.Name; Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash } } |
    Export-Csv $Referenz -NoTypeInformation
  "Referenz gespeichert: $Referenz"
  exit 0
} catch {
  Write-Error "Fehler: $_"
  exit 1
}
'@ | Set-Content hash-referenz.ps1
@'
param(
  [string]$Pfad = './daten',
  [string]$Referenz = './referenz.csv'
)

function Get-Stand([string]$Ordner) {
  $h = @{}
  Get-ChildItem $Ordner -File -Recurse | ForEach-Object { $h[$_.Name] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
  $h
}

try {
  $alt = @{}
  Import-Csv $Referenz -ErrorAction Stop | ForEach-Object { $alt[$_.Datei] = $_.Hash }
  $neu = Get-Stand $Pfad
  $aenderungen = 0
  foreach ($n in $neu.Keys) {
    if (-not $alt.ContainsKey($n)) { "NEU:       $n"; $aenderungen++ }
    elseif ($alt[$n] -ne $neu[$n]) { "VERÄNDERT: $n"; $aenderungen++ }
  }
  foreach ($n in $alt.Keys) { if (-not $neu.ContainsKey($n)) { "GELÖSCHT:  $n"; $aenderungen++ } }
  if ($aenderungen -eq 0) { 'Keine Änderungen.' }
  exit 0
} catch {
  Write-Error "Fehler: $_"
  exit 1
}
'@ | Set-Content hash-pruefen.ps1
```

### 5. Parameterisiertes Admin-Skript (10 P.)

```powershell
@'
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [ValidateSet('List', 'Archive', 'Delete')]
  [string]$Mode,
  [string]$Path = '.'
)

function Get-Dateien([string]$Ordner) { Get-ChildItem $Ordner -File }

try {
  if (-not (Test-Path $Path -PathType Container)) { throw "Der Pfad '$Path' existiert nicht." }
  switch ($Mode) {
    'List' { Get-Dateien $Path | Select-Object Name, Length | Format-Table -AutoSize }
    'Archive' {
      $ordner = Get-Item $Path
      $zip = Join-Path $ordner.Parent.FullName ($ordner.Name + '.zip')
      Compress-Archive -Path (Join-Path $ordner.FullName '*') -DestinationPath $zip -Force
      "Archiv erstellt: $zip"
    }
    'Delete' {
      foreach ($f in Get-Dateien $Path) {
        if ($PSCmdlet.ShouldProcess($f.FullName, 'Löschen')) { Remove-Item $f.FullName }
      }
    }
  }
  exit 0
} catch {
  Write-Error "Fehler: $_"
  exit 1
}
'@ | Set-Content admin.ps1
```

### 6. CIM-Inventarisierung mehrerer Rechner (10 P.)

```powershell
@'
param(
  [string]$Liste = './rechnerliste.txt',
  [string]$Csv = './inventar.csv',
  [string]$Html = './inventar.html'
)

function Get-Inventar([string]$Name) {
  $os = Get-CimInstance Win32_OperatingSystem -ComputerName $Name -ErrorAction Stop
  $cpu = Get-CimInstance Win32_Processor -ComputerName $Name -ErrorAction Stop
  [pscustomobject]@{
    Computer   = $Name
    OS         = $os.Caption
    RAM_GB     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    CPU        = $cpu.Name
    LetzterBoot = $os.LastBootUpTime
  }
}

$fehler = 0
$daten = foreach ($name in Get-Content $Liste | Where-Object { $_.Trim() }) {
  try { Get-Inventar $name.Trim() }
  catch { Write-Warning "$name nicht erreichbar: $_"; $fehler++ }
}
$daten | Export-Csv $Csv -NoTypeInformation
$daten | ConvertTo-Html -Title 'Inventar' | Out-File $Html
"Inventar: $(@($daten).Count) Rechner, $fehler nicht erreichbar"
if ($fehler) { exit 1 } else { exit 0 }
'@ | Set-Content inventar.ps1
```
