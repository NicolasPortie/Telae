param(
    [string]$Server = $env:TELAE_UPDATE_SERVER,
    [string]$DistDir = (Join-Path $PSScriptRoot '..\apps\desktop\dist')
)

$ErrorActionPreference = 'Stop'
if (-not $Server) { throw 'Informe -Server ou defina TELAE_UPDATE_SERVER (usuario@host).' }
$manifest = Join-Path $DistDir 'latest.yml'
if (-not (Test-Path -LiteralPath $manifest)) { throw "Arquivo ausente: $manifest" }
$version = [regex]::Match((Get-Content -Raw -LiteralPath $manifest), '(?m)^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$').Groups[1].Value
if (-not $version) { throw 'Versão inválida em latest.yml' }
$installer = Join-Path $DistDir "Telae-Setup-$version.exe"
$blockmap = "$installer.blockmap"
$publisher = Join-Path $PSScriptRoot 'publish-desktop-update.sh'
foreach ($file in @($installer, $blockmap, $publisher)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Arquivo ausente: $file" }
}

$remoteDir = "/home/usuario/apps/telae/data/updates/staging-$version"
& ssh $Server "mkdir -p '$remoteDir'"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar o servidor.' }
& scp -p $installer $blockmap $manifest $publisher "${Server}:$remoteDir/"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível enviar os arquivos.' }
& ssh $Server "bash '$remoteDir/publish-desktop-update.sh' '$remoteDir'"
if ($LASTEXITCODE -ne 0) { throw 'A publicação falhou.' }

Write-Host "Atualização $version publicada. Os aplicativos verificarão na próxima abertura."
