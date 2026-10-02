# Melhorias implementadas — 02/10/2026

Alterações locais no desktop, bridge de áudio, servidor, testes e workflows. Nenhuma release foi publicada e o servidor de produção não foi alterado.

## Interface e uso

- Player ocupa a área disponível, com ajuste sem corte ou preenchimento escolhido pelo espectador.
- Em tela cheia, controles e cursor local somem após três segundos sem atividade. Movimento, toque e teclado revelam os controles; foco de teclado, interação com controles e diagnóstico aberto preservam acesso. Fora de tela cheia o cursor permanece normal.
- Esc sai de tela cheia; F alterna tela cheia e M alterna silêncio quando o foco está no player. Duplo clique no vídeo também alterna tela cheia.
- Diagnóstico fechado acompanha a ocultação dos controles; diagnóstico aberto tem altura limitada e rolagem.
- Prévia da fonte aparece enquanto se aguarda um espectador. Convite e prévia ficam lado a lado em janelas largas; controles e participantes se reorganizam em janelas menores.
- Seleção de telas/janelas possui marca visual, nome completo no tooltip e navegação por setas, Home e End.
- Alterações em andamento têm feedback. O botão de parar permanece disponível. Qualidade, conteúdo, limite de vídeo, áudio e remoção de espectadores podem ser controlados durante a sessão.

## Estabilidade e diagnóstico

- Buffer circular de PCM limitado a 120 ms, descarte dos frames mais antigos e métricas de fila, descartes e underruns; falhas do bridge encerram a faixa de áudio e são comunicadas.
- Troca de fonte preparada antes de substituir a fonte ativa, com rollback de peers e captura em caso de falha. Parâmetros de vídeo são serializados para evitar alterações concorrentes no sender.
- Qualidade considera texto/movimento, pressão de CPU e capacidade dividida entre espectadores. O limite informado cobre vídeo; áudio e overhead são adicionais.
- Estado de espectador ao vivo exige apresentação de frame real. Reconexões sem frames têm prazo limitado.
- Histórico de até uma hora e exportação JSON de métricas/eventos com campos permitidos, sem nomes de participantes, códigos de convite ou identificadores de sessão. A última transmissão pode ser exportada após terminar.

## Servidor e entrega

- Presença restrita a inscrições explícitas; inscrição vazia revoga observação. Reconexão restaura apenas inscrições solicitadas pelo cliente.
- Remoção exige autorização do emissor e bloqueia o dispositivo removido de voltar à mesma sessão.
- Limites de registro/comandos/sinalização e validação de mensagens. Endereço encaminhado só é aceito de proxies explicitamente configurados.
- Validação de configuração TURN no startup, credenciais temporárias e health de configuração sem segredos. Health não afirma conectividade de relay.
- CI de lint, tipos, testes, build e E2E determinístico. Workflow de release exige runner Windows preparado e mídia real; relay forçado é executado quando o TURN de teste estiver configurado.

## Validação local

| Verificação | Resultado |
| --- | --- |
| Desktop: Vitest | 99 testes aprovados em 13 arquivos |
| Backend: .NET | 67 testes aprovados |
| TypeScript, lint e build desktop | Aprovados |
| Build da solução .NET em Release | Aprovado, zero avisos/erros |
| E2E com mídia real | 3 aprovados; carga e relay opt-in omitidos nessa execução |
| E2E TURN obrigatório | 1 aprovado, frames reais e caminho via servidor nos dois lados |
| Carga com 3, 6 e 12 espectadores | Cada cenário aprovado por 60 segundos |

O teste TURN utilizou coturn temporário em Docker, credencial aleatória e sinalização local. Container, servidor de teste e arquivo de credencial foram removidos ao terminar. Esse teste verifica integração do relay; não comprova alcance do TURN de produção em redes externas.

Carga/endurance foi medida com instâncias Electron na mesma máquina, entradas sequenciais e conteúdo predominantemente estático. Os cenários de carga foram executados antes dos últimos ajustes de serialização/rollback e UI; os testes unitários e E2E de integração foram executados depois desses ajustes. Não representa validação de vídeo 1080p60, latência glass-to-glass, áudio audível, sincronização A/V, internet ou estabilidade por uma hora. Evidências locais ficam em `apps/desktop/test-results/load-3-media`, `load-6-media`, `load-12-media`, `media` e `relay` e são ignoradas pelo Git. Não há SHA de release associado, pois o trabalho está na árvore local.

## Configuração para publicação

Os novos controles exigem implantar este backend antes de distribuir o desktop. Configure proxy confiável conforme [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md), TURN de produção, runner interativo de mídia e credenciais de assinatura conforme a política de distribuição. Complete as medições físicas de rede, áudio e endurance em [BENCHMARK.md](BENCHMARK.md). Esses itens dependem de infraestrutura/certificado e não foram declarados concluídos.

Os comandos, variáveis e limites das medições estão em [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md) e [BENCHMARK.md](BENCHMARK.md).
