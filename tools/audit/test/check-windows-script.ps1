<#
.SYNOPSIS
    Static checks for audit-windows.ps1 (runs on any OS with PowerShell 7,
    or on Windows PowerShell 5.1):
      1. the script parses,
      2. the embedded C# helper compiles as C# 5 (what Windows PowerShell 5.1 uses),
      3. PSScriptAnalyzer (if available) finds no syntax, command or type that
         Windows PowerShell 5.1 lacks.
    Exit code 0 means all checks that could run passed.
#>
param([string]$ModulePath)

$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path -Parent $PSScriptRoot) 'audit-windows.ps1'
$failed = 0

$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    $failed++
    foreach ($e in $parseErrors) { Write-Host "FAIL  parse: line $($e.Extent.StartLineNumber): $($e.Message)" }
} else { Write-Host 'PASS  script parses' }

$assign = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$HelperSource' }, $true)
$helper = $assign.Right.Expression.Value
if (-not $helper) { $failed++; Write-Host 'FAIL  could not find $HelperSource' }
else {
    try {
        $name = 'DrashtiCheck' + [Guid]::NewGuid().ToString('N')
        $src = $helper -replace 'namespace DrashtiAudit', "namespace $name"
        if ($PSVersionTable.PSVersion.Major -ge 6) { Add-Type -TypeDefinition $src -Language CSharp -CompilerOptions '-langversion:5' -ErrorAction Stop }
        else { Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop }
        Write-Host 'PASS  C# helper compiles as C# 5'
    } catch { $failed++; Write-Host "FAIL  C# helper: $($_.Exception.Message)" }
}

if ($ModulePath) { $env:PSModulePath = $ModulePath + [IO.Path]::PathSeparator + $env:PSModulePath }
if (Get-Module -ListAvailable -Name PSScriptAnalyzer) {
    Import-Module PSScriptAnalyzer
    $profile51 = 'win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework'
    $settings = @{
        IncludeRules = @('PSUseCompatibleSyntax', 'PSUseCompatibleCommands', 'PSUseCompatibleTypes', 'PSAvoidUsingCmdletAliases', 'PSUseDeclaredVarsMoreThanAssignments', 'PSAvoidAssignmentToAutomaticVariable', 'PSPossibleIncorrectComparisonWithNull', 'PSAvoidUsingEmptyCatchBlock')
        Rules = @{
            PSUseCompatibleSyntax   = @{ Enable = $true; TargetVersions = @('5.1') }
            PSUseCompatibleCommands = @{ Enable = $true; TargetProfiles = @($profile51) }
            PSUseCompatibleTypes    = @{ Enable = $true; TargetProfiles = @($profile51) }
        }
    }
    $found = @(Invoke-ScriptAnalyzer -Path $target -Settings $settings)
    $blocking = @($found | Where-Object { $_.RuleName -match 'Compatible|AutomaticVariable|IncorrectComparison' })
    foreach ($f in $found) { Write-Host ("{0}  {1} line {2}: {3}" -f $(if ($blocking -contains $f) { 'FAIL' } else { 'NOTE' }), $f.RuleName, $f.Line, $f.Message) }
    if ($blocking.Count -gt 0) { $failed++ } else { Write-Host 'PASS  PSScriptAnalyzer: nothing Windows PowerShell 5.1 lacks' }
} else { Write-Host 'SKIP  PSScriptAnalyzer not installed' }

exit $failed
