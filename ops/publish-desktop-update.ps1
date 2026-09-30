param(
    [string]$Server = 'usuario@servidor',
    [string]$DistDir = (Join-Path $PSScriptRoot '..\apps\desktop\dist')
)

$ErrorActionPreference = 'Stop'
$manifest = Join-Path $DistDir 'latest.yml'
if (-not (Test-Path -LiteralPath $manifest)) { throw "Arquivo ausente: $manifest" }
$version = [regex]::Match((Get-Content -Raw -LiteralPath $manifest), '(?m)^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$').Groups[1].Value
if (-not $version) { throw 'Versão inválida em latest.yml' }
$installer = Join-Path $DistDir "Telae-Setup-$version.exe"
$blockmap = "$installer.blockmap"
foreach ($file in @($installer, $blockmap)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Arquivo ausente: $file" }
}

$remoteDir = "/home/usuario/apps/telae/data/updates/staging-$version"
& ssh $Server "mkdir -p '$remoteDir'"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar o servidor.' }
& scp -p $installer $blockmap $manifest "${Server}:$remoteDir/"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível enviar os arquivos.' }
& ssh $Server "bash /home/usuario/apps/telae/repo/ops/publish-desktop-update.sh '$remoteDir'"
if ($LASTEXITCODE -ne 0) { throw 'A publicação falhou.' }

Write-Host "Atualização $version publicada. Os aplicativos verificarão na próxima abertura."
