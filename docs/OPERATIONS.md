# Operação: release, deploy e atualizações

## Perfis de qualidade

Os perfis **2K · 1440p** e **2K · 1440p60** capturam até 2560 × 1440 a 30/60 fps. Aqui, 2K é o nome popular de QHD/1440p, não o formato de cinema 2048 × 1080. Os tetos iniciais são 20/32 Mbps por espectador, sujeitos ao limite total de upload configurado.

- A seleção oferece apenas perfis explícitos, com **1080p30 como padrão**. O protocolo ainda aceita Auto de versões anteriores para preservar compatibilidade.
- Fontes menores continuam menores: o perfil não cria detalhes inexistentes. 1440p processa cerca de 78% mais pixels que 1080p na mesma taxa de quadros.
- A adaptação reduz FPS no modo Texto e resolução no modo Movimento quando há pressão de CPU; no modo Movimento também reduz resolução sob congestionamento.
- Tetos de bitrate são parâmetros iniciais, não requisitos mínimos nem garantia de desempenho. Valide em hardware real com o [benchmark](BENCHMARK.md).
- Para disponibilizar 1440p, atualize o servidor antes de distribuir o desktop: versões anteriores do backend rejeitam os novos perfis.

## Áudio

Compartilhar uma tela inteira exclui automaticamente o áudio do **aplicativo Discord** (incluindo PTB, Canary e Development) usando process loopback do Windows. O filtro acompanha abertura, fechamento e reinício, com detecção a cada 100 ms.

- Discord no navegador não pode ser separado dos outros sons do navegador.
- O filtro exige Windows build 20348 ou superior; sem ele, o vídeo continua sem som, sem voltar à captura geral.
- Com duas instalações independentes do Discord abertas, o áudio transmitido fica silencioso até restar uma: o Windows permite excluir apenas uma árvore de processos por capturador.
- Compartilhar uma janela mantém somente o áudio daquele aplicativo.

Regressão com áudio real, no Windows com saída de áudio disponível:

```bash
dotnet build tests/audio/Telae.Audio.Tests.csproj -c Release
python tests/audio/verify.py
```

O teste usa tons discretos de aplicativos separados e valida exclusão de processos filhos, abertura/reinício, preservação do outro aplicativo e silêncio seguro com duas árvores.

## Versões e publicação

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...). Ao enviar uma tag `v*`, o GitHub Actions valida o servidor, gera o instalador Windows, publica os arquivos em um GitHub Release e os entrega ao servidor de atualizações por um runner dedicado. O backend pode ser atualizado separadamente pela tag:

```bash
git tag v0.1.1
git push origin v0.1.1
ssh usuario@servidor '~/apps/telae/repo/ops/update-server-from-tag.sh v0.1.1'
```

O estado persistente do servidor fica fora da pasta de release e não é versionado. Antes de atualizar o backend a partir da 0.1.13, leia as [notas de migração](RELEASE_0.1.13.md): a versão passou a exigir credencial por dispositivo e convite para novos espectadores.

## Atualização automática do desktop

O aplicativo instalado verifica atualizações ao abrir e a cada 15 minutos, usando o endereço do servidor configurado. O servidor publica os arquivos em `/updates/windows/`.

- Quando há versão nova, o download começa sozinho. Com transmissão ativa, a instalação espera o encerramento.
- O app reinicia e instala em silêncio, sem abrir o assistente. A tela inicial oferece "Buscar atualização" e a versão instalada aparece no cabeçalho.
- O instalador inicial usa instalação com um clique, por usuário. Instalações para todos os usuários podem exigir autorização do Windows na atualização.
- Mudanças só chegam a aplicativos já instalados depois de distribuídas em uma nova versão.

O runner de publicação executa com uma conta dedicada e grava em `/var/lib/telae-updates/windows`. O publicador confere o SHA-512 e troca os arquivos de forma atômica, com `latest.yml` por último. Confira `http://<servidor>:5015/updates/windows/latest.yml` após publicar.

Para republicar manualmente, execute `pwsh ./ops/publish-desktop-update.ps1 -Server usuario@servidor` depois de `npm run dist` em `apps/desktop`, ou depois de baixar os três arquivos do GitHub Release para `apps/desktop/dist`.

Os instaladores atuais não possuem assinatura de código do Windows. Para assinar, defina `CSC_LINK` e `CSC_KEY_PASSWORD` no ambiente de release.

Veja também o [checklist de release](RELEASE.md) e os [requisitos de validação](RELEASE_VALIDATION.md).
