$ErrorActionPreference = 'Stop'
if ($env:TELAE_MEDIA_RUNNER_READY -ne 'true') {
  throw 'Release bloqueado: prepare um Windows com sessão interativa, display e áudio, registre os labels Windows/X64/telae-media e defina TELAE_MEDIA_RUNNER_READY=true. Veja docs/RELEASE_VALIDATION.md.'
}
if (-not $env:GH_TOKEN) {
  throw 'Release bloqueado: configure MEDIA_RUNNER_STATUS_TOKEN com leitura de runners deste repositório (Administration: read).'
}
$raw = gh api --paginate --slurp "repos/$env:GITHUB_REPOSITORY/actions/runners?per_page=100"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar runners; confira MEDIA_RUNNER_STATUS_TOKEN. Publicação bloqueada.' }
$pages = $raw | ConvertFrom-Json
$eligible = @($pages | ForEach-Object { $_.runners } | Where-Object {
  $labels = @($_.labels | ForEach-Object { $_.name })
  $_.status -eq 'online' -and -not $_.busy -and
  'self-hosted' -in $labels -and 'Windows' -in $labels -and
  'X64' -in $labels -and 'telae-media' -in $labels
})
if ($eligible.Count -eq 0) {
  throw 'Release bloqueado: nenhum runner self-hosted/Windows/X64/telae-media está online e livre. Ligue a sessão interativa e execute novamente o workflow.'
}
Write-Output 'Runner de mídia disponível. Os testes ainda precisam comprovar captura e reprodução.'
