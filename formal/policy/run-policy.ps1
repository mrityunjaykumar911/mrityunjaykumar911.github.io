# Disclosure policy check: the abstract half and the concrete half.
#
#   .\run-policy.ps1                 # regenerate, model-check all instances, check dist/
#   .\run-policy.ps1 -Variant fixed  # check the artifact against the fixed policy
#
# Exit code is non-zero if any instance behaves other than expected, so this is
# usable as a CI gate ahead of the build job.

param(
    [string]$Variant = "current",
    [string]$Heap = "2g"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here "..\..")).Path
$jar  = Join-Path $root ".tools\tla2tools.jar"
if (-not (Test-Path $jar)) { throw "tla2tools.jar not found at $jar. Run 'npm run test:tla' once to fetch it." }

$java = $null
$bundled = Get-ChildItem (Join-Path $root ".tools\java") -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
           Select-Object -First 1
if ($bundled) { $java = $bundled.FullName }
elseif (Get-Command java -ErrorAction SilentlyContinue) { $java = "java" }
else { throw "No java found." }

Push-Location $here
try {
    Write-Host "regenerating policy instances from policy.json"
    python gen_policy_tla.py --policy policy.json --out . | Out-Host

    # instance -> expected outcome. PolicyCurrent is expected to FAIL: it encodes the
    # repository as it is. The three mutants are expected to fail too, which is what
    # makes a passing PolicyFixed mean something.
    $expect = [ordered]@{
        "current"      = "VIOLATION"
        "fixed"        = "PASS"
        "mutunaudited" = "VIOLATION"
        "mutpiiblind"  = "VIOLATION"
        "mutlocalleak" = "VIOLATION"
    }

    $failed = 0
    Write-Host ""
    Write-Host ("{0,-14} {1,-10} {2,-10} {3}" -f "instance", "expected", "actual", "verdict")
    Write-Host ("-" * 62)
    foreach ($v in $expect.Keys) {
        $mod = "Policy" + $v.Substring(0,1).ToUpper() + $v.Substring(1)
        $out = & $java "-Xmx$Heap" -cp $jar tlc2.TLC -deadlock -config "policy$v-safe.cfg" $mod 2>&1 | Out-String
        $actual = if ($out -match "Model checking completed") { "PASS" } else { "VIOLATION" }
        $ok = ($actual -eq $expect[$v])
        if (-not $ok) { $failed++ }
        Write-Host ("{0,-14} {1,-10} {2,-10} {3}" -f $v, $expect[$v], $actual, $(if ($ok) { "ok" } else { "UNEXPECTED" }))
    }

    Write-Host ""
    Write-Host "artifact check against dist/  (variant: $Variant)"
    Write-Host ("-" * 62)
    python check_artifacts.py --repo $root --policy policy.json --variant $Variant | Out-Host
    $artifactCode = $LASTEXITCODE

    Write-Host ""
    if ($failed -gt 0) {
        Write-Host "$failed model instance(s) behaved unexpectedly." -ForegroundColor Red
        exit 1
    }
    Write-Host "model: all instances as expected."
    # The artifact check failing on 'current' is the point, not an error in the runner.
    exit $(if ($Variant -eq "current") { 0 } else { $artifactCode })
}
finally { Pop-Location }
