[CmdletBinding()]
param(
    [string]$ProjectPath,
    [string]$Token,
    [ValidateRange(1, 65535)]
    [int]$Port = 48172,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$blockbenchExe = Join-Path $env:LOCALAPPDATA 'Programs\Blockbench\Blockbench.exe'

if (-not (Test-Path -LiteralPath $blockbenchExe -PathType Leaf)) {
    throw "Blockbench was not found at $blockbenchExe"
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Stop the existing process or choose another port."
}

if (-not $SkipBuild) {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Workspace build failed.' }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $configDirectory = Join-Path $env:LOCALAPPDATA 'BlockbenchCodexStudio'
    $tokenPath = Join-Path $configDirectory 'development-token.txt'
    if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
        $Token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    }
    else {
        New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
        $Token = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
        Set-Content -LiteralPath $tokenPath -Value $Token -NoNewline
    }
}
if ($Token.Length -lt 32) { throw 'Token must contain at least 32 characters.' }

$previousToken = $env:BLOCKBENCH_CODEX_TOKEN
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $blockbenchArguments = @()
    if (-not [string]::IsNullOrWhiteSpace($ProjectPath)) {
        $resolvedProject = (Resolve-Path -LiteralPath $ProjectPath).Path
        $blockbenchArguments += $resolvedProject
    }
    if ($blockbenchArguments.Count -eq 0) {
        $blockbenchProcess = Start-Process -FilePath $blockbenchExe -PassThru
    }
    else {
        $blockbenchProcess = Start-Process -FilePath $blockbenchExe -ArgumentList $blockbenchArguments -PassThru
    }
}
finally {
    if ($null -eq $previousToken) { Remove-Item Env:BLOCKBENCH_CODEX_TOKEN -ErrorAction SilentlyContinue }
    else { $env:BLOCKBENCH_CODEX_TOKEN = $previousToken }
    if ($null -eq $previousElectronMode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
}

[pscustomobject]@{
    BlockbenchPid = $blockbenchProcess.Id
    McpUrl = "http://127.0.0.1:$Port/mcp"
    Token = $Token
    Plugin = Join-Path $repoRoot 'apps\blockbench-plugin\dist\blockbench_codex_studio.js'
}
