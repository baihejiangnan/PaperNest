# $handoff is decoded from a JSON data envelope by update.rs. No paths are code.
$ErrorActionPreference = 'Stop'
[Console]::Out.WriteLine('PaperNest update helper ready')
$oldProcess = Get-Process -Id $handoff.parentPid -ErrorAction SilentlyContinue
if ($oldProcess -and -not $oldProcess.WaitForExit(30000)) {
    # Never install over a running reader, nor launch back into its single instance.
    exit 1
}

try {
    $newExecutable = $handoff.executable
    if ($handoff.mode -eq 'installed') {
        # Explicit quotes are needed: Start-Process joins ArgumentList values.
        $arguments = '/i "' + $handoff.artifact + '" /passive /norestart AUTOLAUNCHAPP=0'
        $installer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/msiexec.exe') `
            -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
        if ($installer.ExitCode -notin @(0, 3010)) {
            throw "Windows Installer exited with code $($installer.ExitCode)"
        }
        $marker = Get-ItemProperty -LiteralPath 'HKLM:\Software\PaperNest' -ErrorAction Stop
        if ($marker.InstallType -ne 'MSI' -or -not (Test-Path -LiteralPath $marker.ExecutablePath -PathType Leaf)) {
            throw 'Cannot locate the installed PaperNest executable'
        }
        $newExecutable = $marker.ExecutablePath
    }
    Start-Process -FilePath $newExecutable -ArgumentList '--papernest-resume-after-update' -WindowStyle Hidden | Out-Null
} catch {
    try {
        [IO.File]::AppendAllText($handoff.errorLog, ([DateTime]::UtcNow.ToString('o') + ' ' + $_.Exception.Message + "`r`n"))
    } catch { }
    # Cancellation/UAC refusal/installation failure returns to the old reader.
    if (Test-Path -LiteralPath $handoff.fallback -PathType Leaf) {
        Start-Process -FilePath $handoff.fallback `
            -ArgumentList '--papernest-resume-after-update --papernest-update-failed' -WindowStyle Hidden | Out-Null
    }
}
