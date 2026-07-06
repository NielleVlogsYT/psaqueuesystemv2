$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectDir = Join-Path $repoRoot "tools\android-kiosk"
$buildDir = Join-Path $projectDir "build"
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$platformDir = Get-ChildItem -LiteralPath (Join-Path $sdkRoot "platforms") -Directory | Sort-Object Name -Descending | Select-Object -First 1
$buildToolsDir = Get-ChildItem -LiteralPath (Join-Path $sdkRoot "build-tools") -Directory | Sort-Object Name -Descending | Select-Object -First 1
$javaHome = "C:\Program Files\Android\Android Studio\jbr"

if (-not $platformDir) {
    throw "No Android SDK platform found under $sdkRoot\platforms"
}

if (-not $buildToolsDir) {
    throw "No Android build-tools found under $sdkRoot\build-tools"
}

$androidJar = Join-Path $platformDir.FullName "android.jar"
$aapt2 = Join-Path $buildToolsDir.FullName "aapt2.exe"
$d8 = Join-Path $buildToolsDir.FullName "d8.bat"
$zipalign = Join-Path $buildToolsDir.FullName "zipalign.exe"
$apksigner = Join-Path $buildToolsDir.FullName "apksigner.bat"
$javac = Join-Path $javaHome "bin\javac.exe"
$keytool = Join-Path $javaHome "bin\keytool.exe"

foreach ($tool in @($androidJar, $aapt2, $d8, $zipalign, $apksigner, $javac, $keytool)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Missing required build tool: $tool"
    }
}

$env:JAVA_HOME = $javaHome
$env:PATH = (Join-Path $javaHome "bin") + [System.IO.Path]::PathSeparator + $env:PATH

$resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
$resolvedBuildDir = [System.IO.Path]::GetFullPath($buildDir)
if (-not $resolvedBuildDir.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a build directory outside the repository: $resolvedBuildDir"
}

if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path `
    (Join-Path $buildDir "compiled"), `
    (Join-Path $buildDir "gen"), `
    (Join-Path $buildDir "classes"), `
    (Join-Path $buildDir "dex"), `
    (Join-Path $projectDir "keys") | Out-Null

$compiledZip = Join-Path $buildDir "compiled\resources.zip"
$unsignedApk = Join-Path $buildDir "unsigned.apk"
$unalignedApk = Join-Path $buildDir "unaligned.apk"
$alignedApk = Join-Path $buildDir "aligned.apk"
$finalApk = Join-Path $repoRoot "executables\PSA_Kiosk.apk"
$legacyApk = Join-Path $repoRoot "executables\app-debug.apk"
$keystore = Join-Path $projectDir "keys\psa-kiosk-release.jks"
$keyAlias = "psa-kiosk-release"
$keyPassword = if ($env:PSA_KIOSK_KEYSTORE_PASS) { $env:PSA_KIOSK_KEYSTORE_PASS } else { "psa-kiosk-local" }
$minSdkVersion = "21"
$targetSdkVersion = "36"

& $aapt2 compile --dir (Join-Path $projectDir "res") -o $compiledZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $aapt2 link `
    -I $androidJar `
    --manifest (Join-Path $projectDir "AndroidManifest.xml") `
    --java (Join-Path $buildDir "gen") `
    --min-sdk-version $minSdkVersion `
    --target-sdk-version $targetSdkVersion `
    --version-code 2 `
    --version-name "1.0.1" `
    -o $unsignedApk `
    $compiledZip `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

[string[]]$javaFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectDir "src") -Recurse -Filter "*.java" | ForEach-Object { $_.FullName })
[string[]]$generatedJavaFiles = @(Get-ChildItem -LiteralPath (Join-Path $buildDir "gen") -Recurse -Filter "*.java" | ForEach-Object { $_.FullName })
$javacArgs = @(
    "-source",
    "8",
    "-target",
    "8",
    "-bootclasspath",
    $androidJar,
    "-d",
    (Join-Path $buildDir "classes")
) + $javaFiles + $generatedJavaFiles

& $javac @javacArgs
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

[string[]]$classFiles = @(Get-ChildItem -LiteralPath (Join-Path $buildDir "classes") -Recurse -Filter "*.class" | ForEach-Object { $_.FullName })
& $d8 --min-api $minSdkVersion --lib $androidJar --output (Join-Path $buildDir "dex") @classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

Copy-Item -LiteralPath $unsignedApk -Destination $unalignedApk -Force
[System.IO.Compression.ZipFile]::Open($unalignedApk, [System.IO.Compression.ZipArchiveMode]::Update).Dispose()
$apkZip = [System.IO.Compression.ZipFile]::Open($unalignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $existingDex = $apkZip.GetEntry("classes.dex")
    if ($existingDex) {
        $existingDex.Delete()
    }

    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $apkZip,
        (Join-Path $buildDir "dex\classes.dex"),
        "classes.dex",
        [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
finally {
    $apkZip.Dispose()
}

& $zipalign -p -f 4 $unalignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool -genkeypair `
        -keystore $keystore `
        -storepass $keyPassword `
        -keypass $keyPassword `
        -alias $keyAlias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=PSA Kiosk,O=PSA Queue,C=PH" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

& $apksigner sign `
    --ks $keystore `
    --ks-pass "pass:$keyPassword" `
    --key-pass "pass:$keyPassword" `
    --v4-signing-enabled false `
    --out $finalApk `
    $alignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

& $apksigner verify --verbose $finalApk
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }

Copy-Item -LiteralPath $finalApk -Destination $legacyApk -Force
Write-Host "Built Android kiosk APK: $finalApk"
Write-Host "Updated legacy APK path: $legacyApk"
