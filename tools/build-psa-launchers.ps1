$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "tools\psa-launcher\PsaQueueLauncher.cs"
$browserIcon = Join-Path $repoRoot "tools\psa-launcher\PSA.ico"
$outputDir = Join-Path $repoRoot "executables"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "Could not find the .NET Framework C# compiler."
}

$commonArgs = @(
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll"
)

function Build-Launcher($outputPath, $iconPath = $null) {
    $buildArgs = $commonArgs + @("/out:$outputPath")
    if ($iconPath) {
        $buildArgs += "/win32icon:$iconPath"
    }

    & $compiler @buildArgs $source
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build $outputPath"
    }
}

Build-Launcher (Join-Path $outputDir "PSA_Queue_Browser.exe") $browserIcon
Build-Launcher (Join-Path $outputDir "PSA_Queue_SecondMonitor.exe")
Build-Launcher (Join-Path $outputDir "PSA_Queuing_Browser.exe") $browserIcon
Build-Launcher (Join-Path $outputDir "PSA_Queuing_SecondMonitor.exe")

Write-Host "Built PSA queue launcher executables in $outputDir"
