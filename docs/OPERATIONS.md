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

## Acesso ao servidor

- O cadastro vem fechado. Para liberar alguém, acrescente o e-mail em `Auth__AllowedEmails` (separados por vírgula) no ambiente do servidor e reinicie o serviço. `Auth__RegistrationOpen=true` abre para qualquer pessoa.
- Clientes sem conta ficam desligados (`Auth__AllowLegacyDevices=false`).
- O servidor não deve escutar em endereço público: use `ASPNETCORE_URLS=http://127.0.0.1:5015` atrás de um túnel ou proxy reverso com TLS (veja o [unit de exemplo](../ops/telae-server.service)).

## Repositórios e CI

O código fica neste repositório público e roda só em runners da GitHub, sem segredos de infraestrutura. A parte que mexe em máquinas próprias vive num repositório de operação **privado**: os runners `self-hosted`, a entrega do instalador ao servidor, a validação física de mídia e os scripts de deploy com o layout do servidor.

O repositório privado consulta a Release pública mais recente. O público nunca o chama e não guarda segredos dele, então um PR de fora não alcança as máquinas de operação. Mantenha em Settings > Actions a aprovação de workflows para contribuidores externos, só ações oficiais liberadas e permissão de leitura por padrão. As tags `v*` têm regra de proteção: só o mantenedor cria.

## Versões e publicação

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...):

```bash
git tag v0.1.1
git push origin v0.1.1
```

Ao enviar a tag, o `release.yml` valida, gera o instalador do Windows e cria a Release pública com o instalador, o blockmap e o `latest.yml`. A entrega ao servidor de atualizações e a atualização do backend são feitas pelo repositório de operação.

Quem hospeda o próprio servidor pode implantar o backend de qualquer forma que preferir (veja o `docker-compose.yml` e o [unit de exemplo](../ops/telae-server.service)). O estado persistente fica fora da pasta de release e não é versionado.

## Atualização automática do desktop

O aplicativo instalado verifica atualizações ao abrir e a cada 15 minutos, usando o endereço do servidor configurado. O servidor publica os arquivos em `/updates/windows/` (`Updates__Path`).

- Quando há versão nova, o download começa sozinho. Com transmissão ativa, a instalação espera o encerramento.
- O app reinicia e instala em silêncio, sem abrir o assistente. A tela inicial oferece "Buscar atualização" e a versão instalada aparece no cabeçalho.
- O instalador inicial usa instalação com um clique, por usuário. Instalações para todos os usuários podem exigir autorização do Windows na atualização.
- Mudanças só chegam a aplicativos já instalados depois de distribuídas em uma nova versão.

O publicador confere o SHA-512 do instalador contra o `latest.yml` e troca os arquivos de forma atômica, com o `latest.yml` por último. Confira `/updates/windows/latest.yml` após publicar.

Os instaladores atuais não possuem assinatura de código do Windows. Para assinar, defina `CSC_LINK` e `CSC_KEY_PASSWORD` no ambiente de release.

Veja também o [checklist de release](RELEASE.md) e os [requisitos de validação](RELEASE_VALIDATION.md).
