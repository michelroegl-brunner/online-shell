# OShellWindows — stand-ins for Windows-only cmdlets on Linux PowerShell.
#
# PowerShell 7 on Linux has no Get-Service, Get-CimInstance or
# Get-ComputerInfo. These functions return Windows-like objects with fake
# but consistent data, so classic Windows exercises work in the Online Shell
# box. Service state changes (Start/Stop) are kept in /run/oshell for the
# lifetime of the box, so check scripts see what the student did.

enum ServiceControllerStatus {
    Stopped = 1
    StartPending = 2
    StopPending = 3
    Running = 4
    ContinuePending = 5
    PausePending = 6
    Paused = 7
}

enum ServiceStartMode {
    Boot = 0
    System = 1
    Automatic = 2
    Manual = 3
    Disabled = 4
}

$script:DefaultServices = @(
    @{ Name = 'AudioSrv';      DisplayName = 'Windows Audio';                              Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'BITS';          DisplayName = 'Background Intelligent Transfer Service';   Status = 'Running'; StartType = 'Manual' }
    @{ Name = 'Dhcp';          DisplayName = 'DHCP Client';                                Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'Dnscache';      DisplayName = 'DNS Client';                                 Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'EventLog';      DisplayName = 'Windows Event Log';                          Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'Fax';           DisplayName = 'Fax';                                        Status = 'Stopped'; StartType = 'Manual' }
    @{ Name = 'LanmanServer';  DisplayName = 'Server';                                     Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'LanmanWorkstation'; DisplayName = 'Workstation';                            Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'MpsSvc';        DisplayName = 'Windows Defender Firewall';                  Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'RemoteRegistry'; DisplayName = 'Remote Registry';                           Status = 'Stopped'; StartType = 'Disabled' }
    @{ Name = 'Schedule';      DisplayName = 'Task Scheduler';                             Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'Spooler';       DisplayName = 'Print Spooler';                              Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'TermService';   DisplayName = 'Remote Desktop Services';                    Status = 'Stopped'; StartType = 'Manual' }
    @{ Name = 'Themes';        DisplayName = 'Themes';                                     Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'W32Time';       DisplayName = 'Windows Time';                               Status = 'Stopped'; StartType = 'Manual' }
    @{ Name = 'WinRM';         DisplayName = 'Windows Remote Management (WS-Management)'; Status = 'Stopped'; StartType = 'Manual' }
    @{ Name = 'WSearch';       DisplayName = 'Windows Search';                             Status = 'Running'; StartType = 'Automatic' }
    @{ Name = 'wuauserv';      DisplayName = 'Windows Update';                             Status = 'Stopped'; StartType = 'Manual' }
)

$script:StateFile = '/run/oshell/services.json'

function Get-OShellServiceState {
    $state = @{}
    foreach ($s in $script:DefaultServices) { $state[$s.Name] = $s.Status }
    if (Test-Path -LiteralPath $script:StateFile) {
        try {
            $saved = Get-Content -LiteralPath $script:StateFile -Raw | ConvertFrom-Json -AsHashtable
            foreach ($k in $saved.Keys) { if ($state.ContainsKey($k)) { $state[$k] = $saved[$k] } }
        } catch { }
    }
    $state
}

function Set-OShellServiceStatus([string]$Name, [string]$Status) {
    $state = Get-OShellServiceState
    $state[$Name] = $Status
    try {
        $state | ConvertTo-Json | Set-Content -LiteralPath $script:StateFile -Encoding utf8
        # Keep it writable for the student when a root check created it.
        if ($IsLinux) { & chown student:student $script:StateFile 2>$null }
    } catch { }
}

function New-OShellService([hashtable]$Def, [string]$Status) {
    $obj = [pscustomobject]@{
        PSTypeName  = 'OShell.ServiceController'
        Status      = [ServiceControllerStatus]$Status
        Name        = $Def.Name
        DisplayName = $Def.DisplayName
        StartType   = [ServiceStartMode]$Def.StartType
        ServiceName = $Def.Name
        MachineName = '.'
        CanStop     = ($Status -eq 'Running')
    }
    $obj
}

Update-TypeData -TypeName 'OShell.ServiceController' -DefaultDisplayPropertySet Status, Name, DisplayName -Force

function Find-OShellServiceDef([string[]]$Name, [string[]]$DisplayName) {
    $defs = $script:DefaultServices
    if ($Name) {
        $out = foreach ($n in $Name) {
            $hit = $defs | Where-Object { $_.Name -like $n }
            if (-not $hit -and -not [WildcardPattern]::ContainsWildcardCharacters($n)) {
                Write-Error -Message "Cannot find any service with service name '$n'." -Category ObjectNotFound -TargetObject $n
            }
            $hit
        }
        return $out
    }
    if ($DisplayName) {
        $byDisplay = foreach ($d in $DisplayName) { $defs | Where-Object { $_.DisplayName -like $d } }
        return $byDisplay
    }
    $defs
}

function Get-Service {
    [CmdletBinding(DefaultParameterSetName = 'Default')]
    param(
        [Parameter(Position = 0, ParameterSetName = 'Default', ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('ServiceName')]
        [string[]] $Name,
        [Parameter(ParameterSetName = 'DisplayName')]
        [string[]] $DisplayName,
        [string[]] $ComputerName
    )
    begin { $state = Get-OShellServiceState }
    process {
        Find-OShellServiceDef -Name $Name -DisplayName $DisplayName |
            Sort-Object { $_.Name } |
            ForEach-Object { New-OShellService -Def $_ -Status $state[$_.Name] }
    }
}

function Set-OShellServiceFromPipeline([object[]]$InputObject, [string[]]$Name, [string]$Status, [switch]$PassThru) {
    $names = @()
    if ($InputObject) { $names += $InputObject | ForEach-Object { $_.Name } }
    if ($Name) { $names += (Find-OShellServiceDef -Name $Name | ForEach-Object { $_.Name }) }
    foreach ($n in $names) {
        $def = $script:DefaultServices | Where-Object { $_.Name -eq $n }
        if (-not $def) { continue }
        if ($Status -eq 'Running' -and $def.StartType -eq 'Disabled') {
            Write-Error "Service '$($def.DisplayName) ($n)' cannot be started due to the following error: Cannot start service $n on computer '.'."
            continue
        }
        Set-OShellServiceStatus -Name $n -Status $Status
        if ($PassThru) { New-OShellService -Def $def -Status $Status }
    }
}

function Start-Service {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Position = 0, ValueFromPipelineByPropertyName)] [Alias('ServiceName')] [string[]] $Name,
        [Parameter(ValueFromPipeline)] [object[]] $InputObject,
        [switch] $PassThru
    )
    process {
        if ($PSCmdlet.ShouldProcess(($Name + ($InputObject | ForEach-Object Name)) -join ', ', 'Start-Service')) {
            Set-OShellServiceFromPipeline -InputObject $InputObject -Name $Name -Status 'Running' -PassThru:$PassThru
        }
    }
}

function Stop-Service {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Position = 0, ValueFromPipelineByPropertyName)] [Alias('ServiceName')] [string[]] $Name,
        [Parameter(ValueFromPipeline)] [object[]] $InputObject,
        [switch] $PassThru,
        [switch] $Force
    )
    process {
        if ($PSCmdlet.ShouldProcess(($Name + ($InputObject | ForEach-Object Name)) -join ', ', 'Stop-Service')) {
            Set-OShellServiceFromPipeline -InputObject $InputObject -Name $Name -Status 'Stopped' -PassThru:$PassThru
        }
    }
}

function Restart-Service {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Position = 0, ValueFromPipelineByPropertyName)] [Alias('ServiceName')] [string[]] $Name,
        [Parameter(ValueFromPipeline)] [object[]] $InputObject,
        [switch] $PassThru,
        [switch] $Force
    )
    process {
        if ($PSCmdlet.ShouldProcess(($Name + ($InputObject | ForEach-Object Name)) -join ', ', 'Restart-Service')) {
            Set-OShellServiceFromPipeline -InputObject $InputObject -Name $Name -Status 'Running' -PassThru:$PassThru
        }
    }
}

# ── CIM / computer info ─────────────────────────────────────────────────────

# Stable pseudo-random numbers per computer name, so every name gets its own
# but repeatable hardware.
function Get-OShellSeed([string]$Computer) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Computer.ToLowerInvariant())
    $hash = [Security.Cryptography.SHA256]::HashData($bytes)
    [BitConverter]::ToUInt32($hash, 0)
}

function Get-OShellMachine([string]$Computer) {
    # localhost / 127.0.0.1 / . / own name are the same machine → same data.
    if ($Computer -in @('localhost', '127.0.0.1', '.', '::1')) { $Computer = [Environment]::MachineName }
    $seed = Get-OShellSeed $Computer
    $ramGb = @(8, 16, 16, 32, 64)[$seed % 5]
    $cpus = @(
        'Intel(R) Core(TM) i5-12500 CPU @ 3.00GHz',
        'Intel(R) Core(TM) i7-12700 CPU @ 2.10GHz',
        'AMD Ryzen 5 PRO 5650G with Radeon Graphics',
        'Intel(R) Core(TM) i5-10500 CPU @ 3.10GHz'
    )
    $name = $Computer.ToUpperInvariant()
    [pscustomobject]@{
        Name       = $name
        Ram        = [uint64]$ramGb * 1GB
        Cpu        = $cpus[($seed -shr 3) % $cpus.Count]
        Cores      = @(4, 6, 8, 12)[($seed -shr 5) % 4]
        LastBoot   = (Get-Date).Date.AddHours(-(($seed % 120) + 7)).AddMinutes(-($seed % 59))
        DiskSize   = [uint64](@(256, 512, 1024)[($seed -shr 7) % 3]) * 1GB
        DiskFree   = [uint64](($seed % 180) + 40) * 1GB
        Serial     = 'HTL' + ($seed % 1000000).ToString('000000')
    }
}

function Get-CimInstance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)] [Alias('Class')] [string] $ClassName,
        [Parameter(ValueFromPipeline)] [Alias('CimSession', 'cn')] [string[]] $ComputerName = @('localhost'),
        [string] $Filter,
        [string[]] $Property
    )
    process {
        foreach ($c in $ComputerName) {
            if ($c -like 'offline*' -or $c -like '*.invalid') {
                Write-Error "WinRM cannot complete the operation. Verify that the specified computer name ($c) is valid, that the computer is accessible over the network, and that a firewall exception for the WinRM service is enabled." -Category ConnectionError -TargetObject $c
                continue
            }
            $m = Get-OShellMachine $c
            $obj = switch -Regex ($ClassName) {
                '^Win32_OperatingSystem$' {
                    [pscustomobject]@{
                        Caption                = 'Microsoft Windows 11 Education'
                        Version                = '10.0.22631'
                        BuildNumber            = '22631'
                        OSArchitecture         = '64-bit'
                        CSName                 = $m.Name
                        LastBootUpTime         = $m.LastBoot
                        InstallDate            = (Get-Date '2025-09-01T08:00:00')
                        TotalVisibleMemorySize = [uint64]($m.Ram / 1KB)
                        FreePhysicalMemory     = [uint64]($m.Ram / 1KB * 0.42)
                        SerialNumber           = $m.Serial
                    }
                }
                '^Win32_ComputerSystem$' {
                    [pscustomobject]@{
                        Name                      = $m.Name
                        Domain                    = 'htl-braunau.int'
                        Manufacturer              = 'LENOVO'
                        Model                     = 'ThinkCentre M70q'
                        TotalPhysicalMemory       = $m.Ram
                        NumberOfProcessors        = 1
                        NumberOfLogicalProcessors = $m.Cores * 2
                        UserName                  = 'HTL\student'
                    }
                }
                '^Win32_Processor$' {
                    [pscustomobject]@{
                        Name                      = $m.Cpu
                        NumberOfCores             = $m.Cores
                        NumberOfLogicalProcessors = $m.Cores * 2
                        MaxClockSpeed             = 3000
                        LoadPercentage            = 7
                    }
                }
                '^Win32_LogicalDisk$' {
                    [pscustomobject]@{
                        DeviceID   = 'C:'
                        DriveType  = 3
                        FileSystem = 'NTFS'
                        Size       = $m.DiskSize
                        FreeSpace  = $m.DiskFree
                        VolumeName = 'Windows'
                    }
                }
                '^Win32_BIOS$' {
                    [pscustomobject]@{
                        Manufacturer      = 'LENOVO'
                        SMBIOSBIOSVersion = 'M4AKT3BA'
                        SerialNumber      = $m.Serial
                    }
                }
                default {
                    Write-Error "Invalid class '$ClassName'. (Online Shell knows Win32_OperatingSystem, Win32_ComputerSystem, Win32_Processor, Win32_LogicalDisk, Win32_BIOS.)" -Category InvalidArgument
                    $null
                }
            }
            if ($obj) {
                $obj | Add-Member -NotePropertyName PSComputerName -NotePropertyValue $m.Name -PassThru |
                    ForEach-Object { if ($Property) { $_ | Select-Object ($Property + 'PSComputerName') } else { $_ } }
            }
        }
    }
}

function Get-ComputerInfo {
    [CmdletBinding()]
    param([Parameter(Position = 0)] [string[]] $Property)
    $m = Get-OShellMachine 'localhost'
    $info = [pscustomobject]@{
        CsName                    = $m.Name
        CsDomain                  = 'htl-braunau.int'
        CsManufacturer            = 'LENOVO'
        CsModel                   = 'ThinkCentre M70q'
        CsProcessors              = $m.Cpu
        CsNumberOfLogicalProcessors = $m.Cores * 2
        CsTotalPhysicalMemory     = $m.Ram
        OsName                    = 'Microsoft Windows 11 Education'
        OsVersion                 = '10.0.22631'
        OsArchitecture            = '64-bit'
        OsLastBootUpTime          = $m.LastBoot
        OsTotalVisibleMemorySize  = [uint64]($m.Ram / 1KB)
        WindowsProductName        = 'Windows 11 Education'
        TimeZone                  = '(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna'
    }
    if ($Property) { $info | Select-Object $Property } else { $info }
}

Set-Alias -Name gsv -Value Get-Service
Set-Alias -Name sasv -Value Start-Service
Set-Alias -Name spsv -Value Stop-Service
Set-Alias -Name gcim -Value Get-CimInstance
Set-Alias -Name Get-WmiObject -Value Get-CimInstance
Set-Alias -Name gwmi -Value Get-CimInstance

Export-ModuleMember -Function Get-Service, Start-Service, Stop-Service, Restart-Service, Get-CimInstance, Get-ComputerInfo -Alias gsv, sasv, spsv, gcim, Get-WmiObject, gwmi
