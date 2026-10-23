# Telaê 0.1.12

Esta tag foi bloqueada antes da publicação: o E2E no checkout limpo do GitHub revelou que o app em desenvolvimento não encontrava o bridge publicado em `build/audio-bridge`. A correção e a publicação seguem em [0.1.13](RELEASE_0.1.13.md); os comandos abaixo registram o preparo da 0.1.12 e não devem ser usados para implantar a versão que falhou.

## Correções

- Credencial aleatória de 256 bits por dispositivo; servidor armazena somente o hash. Registro com identificador conhecido e credencial incorreta é recusado.
- Entrada de novos espectadores exige convite. Sinalização permanece restrita aos participantes autorizados.
- Parar encerra captura e conexões imediatamente, mesmo com servidor sem resposta. Preparação pendente e fechamento da janela capturada também encerram os recursos locais.
- Reconexão de cada espectador possui três tentativas e prazo de dez segundos por tentativa. Credenciais TURN são renovadas antes das tentativas; ofertas simultâneas têm tratamento de colisão.
- Auto adapta cada conexão separadamente. Perda no transmissor usa o relatório remoto e diferenças entre amostras.
- Atualização agendada é cancelada quando uma sessão começa, inclusive na preparação.
- Perfis do servidor e desktop são gravados com substituição atômica.
- Áudio isolado identifica cada captura, encerra o bridge em falhas/cancelamento e recompõe amostras e quadros PCM fragmentados. Trocar janelas do mesmo processo não permite à limpeza antiga parar o bridge novo.
- Playback mantém vídeo e áudio juntos quando a troca de fonte adiciona uma faixa com outro identificador de stream.

## Compatibilidade e implantação

Esta versão altera o registro no backend. Os clientes anteriores à 0.1.12 não conseguem registrar dispositivos no backend novo. A atualização automática usa HTTP independentemente da sinalização, portanto os clientes instalados com atualizador continuam podendo baixar a versão nova.

No primeiro uso da 0.1.12, um perfil legado recebe novo identificador e credencial. Nome e lista local de amigos são preservados; o código de amigo próprio muda. Perfis antigos do servidor permanecem como histórico offline e não podem ser reclamados por terceiros.

Depois de revisar e commitar as alterações:

```powershell
git tag v0.1.12
git push origin HEAD
git push origin v0.1.12
```

O workflow da tag valida servidor e desktop, gera o instalador, publica o GitHub Release e entrega a atualização Windows ao runner `telae-updates`. A implantação do backend continua sendo a etapa explícita já existente:

```powershell
ssh usuario@servidor '~/apps/telae/ops/update-server-from-tag.sh v0.1.12'
```

Faça a troca do backend depois que a atualização Windows 0.1.12 estiver disponível, em uma janela de manutenção que permita reiniciar as sessões. Preserve o arquivo de perfis e as configurações de TURN; não apague dados para realizar a migração. Confirme `/health`, a versão `0.1.12` em `/updates/windows/latest.yml`, registro dos clientes atualizados e entrada por convite. Teste também a recusa de entrada por ID sem convite.

Ao voltar para um backend anterior, os clientes novos podem registrar com o protocolo antigo, mas a proteção de credenciais deixa de ser aplicada. Prefira corrigir a versão nova e publicar outra tag em vez de manter o backend antigo exposto.

## Validação

Validação local em 30/09/2026: TypeScript e lint aprovados; 40 testes do desktop, 29 testes do servidor em Release e os três E2E do Electron aprovados, sem testes ignorados. Os E2E incluem captura real de janela com áudio, convite inválido e transmissão real para dois espectadores com áudio, troca de fonte, saída e encerramento. O instalador Windows, o blockmap, o manifesto de atualização e o publish do servidor foram gerados.

Os testes automatizados cobrem autorização, reconexão, cancelamento, áudio, qualidade, atualizador e persistência. O roteiro de desempenho e endurance de `BENCHMARK.md` continua necessário para medir latência, sincronização A/V, consumo de recursos e comportamento com vários espectadores em máquinas e redes diferentes. O limite de 12 espectadores não garante a qualidade máxima em todas as conexões.
