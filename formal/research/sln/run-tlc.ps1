# Run TLC on the FlexFacets model, on Windows, with real resources.
#
#   .\run-tlc.ps1                                  # soundness check
#   .\run-tlc.ps1 -Cfg flexfacets-complete.cfg     # completeness witnesses
#   .\run-tlc.ps1 -Heap 24g -Workers 16            # bigger box, bigger model
#
# Soundness should PASS. Completeness is written as a deliberately false
# invariant, so a violation there is the wanted output: it names an item that
# IS independent but the candidate condition misses, i.e. a facet we have not
# written down yet.

param(
    [string]$Cfg     = "flexfacets-sound.cfg",
    [string]$Spec    = "FlexFacets",
    [string]$Heap    = "8g",
    [string]$Workers = "auto"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$jar  = Join-Path $root ".tools\tla2tools.jar"
if (-not (Test-Path $jar)) { throw "tla2tools.jar not found at $jar" }

$java = $null
$bundled = Get-ChildItem (Join-Path $root ".tools\java") -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
           Select-Object -First 1
if ($bundled) {
    $java = $bundled.FullName
} elseif (Get-Command java -ErrorAction SilentlyContinue) {
    $java = "java"
} else {
    throw "No java found. Expected one under $root\.tools\java or on PATH."
}

Write-Host "java    : $java"
Write-Host "jar     : $jar"
Write-Host "config  : $Cfg"
Write-Host "heap    : $Heap   workers: $Workers"
Write-Host ("-" * 60)

$sw = [Diagnostics.Stopwatch]::StartNew()
& $java "-Xmx$Heap" "-XX:+UseParallelGC" -cp $jar tlc2.TLC `
    -deadlock -workers $Workers -config $Cfg $Spec
$code = $LASTEXITCODE
$sw.Stop()

Write-Host ("-" * 60)
Write-Host ("exit {0}  elapsed {1:n1}s" -f $code, $sw.Elapsed.TotalSeconds)
