@{
    RootModule        = 'OShellWindows.psm1'
    ModuleVersion     = '1.0.0'
    GUID              = '5f0b9c2e-6d7a-4c1e-9a43-0c1d2e3f4a5b'
    Author            = 'Online Shell'
    Description       = 'Stand-ins for Windows-only cmdlets (services, CIM, computer info) with fake data, for teaching on Linux.'
    PowerShellVersion = '7.2'
    FunctionsToExport = @(
        'Get-Service', 'Start-Service', 'Stop-Service', 'Restart-Service',
        'Get-CimInstance', 'Get-ComputerInfo'
    )
    AliasesToExport   = @('gsv', 'sasv', 'spsv', 'gcim', 'Get-WmiObject', 'gwmi')
    CmdletsToExport   = @()
    VariablesToExport = @()
}
