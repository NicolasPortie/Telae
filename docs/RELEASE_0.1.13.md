# Telae 0.1.13

Inclui todas as correções de segurança, reconexão, áudio, qualidade, atualizador e persistência descritas na [versão preparada 0.1.12](RELEASE_0.1.12.md), além da localização correta do bridge de áudio no checkout limpo e em builds com runtime `win-x64`.

A tag 0.1.12 foi bloqueada pelo E2E do GitHub antes de gerar um GitHub Release ou alterar produção. A tag 0.1.13 preserva esse histórico e inclui o reparo do build limpo. O aplicativo instalado continua usando exclusivamente o bridge incluído nos recursos do instalador.

## Migração e publicação

Os clientes anteriores à correção de credenciais precisam atualizar para a 0.1.13 antes de registrar no backend novo. A atualização automática é independente da conexão SignalR. Perfis legados recebem novo identificador e credencial; nome e lista local de amigos são preservados, e o código próprio de amigo muda.

```powershell
git push origin main refs/tags/v0.1.13
ssh nicolas@192.168.15.3 '~/apps/telae/repo/ops/update-server-from-tag.sh v0.1.13'
```

O workflow da tag valida os testes, compila o instalador e executa o E2E do Electron antes de publicar o GitHub Release e entregar a atualização Windows ao runner. Faça a troca do backend somente depois que `/updates/windows/latest.yml` apresentar `version: 0.1.13`. Preserve perfis e configurações de TURN, mantenha a release anterior para recuperação e verifique `/health`, registro com credencial, recusa de entrada sem convite, entrada por convite e encerramento.

O teste prolongado e as medições de latência e sincronização em redes diferentes continuam seguindo `BENCHMARK.md`.
