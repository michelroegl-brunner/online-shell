# Online Shell: prompt + command log for interactive pwsh sessions.
# Appends "<epoch>\t<exit>\t<cwd>\t<command>" to /run/oshell/cmd.log, the
# same format as the bash hook, so the runner/web can ingest it.
# (Students can tamper with it; it is a learning aid, not an audit log.)

if ($Host.Name -ne 'ConsoleHost') { return }

$global:__oshellLastHistoryId = 0

function global:prompt {
    # Must be first: the success state of the previous command.
    $ok = $?
    $code = if ($ok) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }

    $h = Get-History -Count 1
    if ($h -and $h.Id -ne $global:__oshellLastHistoryId) {
        $global:__oshellLastHistoryId = $h.Id
        $cmd = $h.CommandLine -replace "`r?`n", ' '
        $line = '{0}{1}{2}{1}{3}{1}{4}' -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), "`t", $code, $PWD.ProviderPath, $cmd
        try { [IO.File]::AppendAllText('/run/oshell/cmd.log', $line + "`n") } catch { }
    }

    $path = $PWD.ProviderPath -replace '^/home/student', '~'
    "$($PSStyle.Foreground.BrightGreen)PS$($PSStyle.Reset) $($PSStyle.Foreground.BrightBlue)$path$($PSStyle.Reset)> "
}
