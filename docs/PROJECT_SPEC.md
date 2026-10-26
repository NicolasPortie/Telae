# Especificação do Telaê

## O que o aplicativo faz

O Telaê compartilha uma tela ou janela do Windows com amigos, com áudio sincronizado e baixa latência. Quem está transmitindo aparece na lista de amigos; o espectador entra com um clique.

A captura, a codificação, a rede e a reprodução introduzem atraso. A meta é manter esse atraso baixo e estável, reduzindo a qualidade quando necessário em vez de acumular um buffer longo.

## Funcionamento

O aplicativo usa Electron, React, TypeScript e Tailwind. O Chromium fornece a implementação de WebRTC. O servidor ASP.NET Core, com SignalR, cuida de contas, amigos, presença e negociação das conexões.

Imagem e som seguem diretamente entre os computadores quando possível. TURN retransmite a mídia criptografada quando a conexão direta não funciona. Cada transmissão aceita até 12 espectadores, com uma conexão independente para cada um. O consumo de envio cresce com esse número; o limite não garante a mesma qualidade em qualquer máquina ou rede.

A identidade é uma conta com e-mail, senha e `@usuário` único. As amizades são mútuas e ficam no servidor. A decisão está registrada na [ADR 0004](adr/0004-user-accounts.md).

## Tarefas de quem usa

Quem transmite precisa conseguir:

- escolher uma tela ou janela e saber o que está sendo compartilhado;
- enviar o áudio do sistema ou do aplicativo escolhido;
- restringir o acesso aos amigos;
- acompanhar quem está entrando, assistindo ou se reconectando;
- encerrar a captura imediatamente;
- trocar a fonte e a qualidade durante a transmissão.

Quem assiste precisa conseguir:

- encontrar os amigos ao vivo e entrar sem trocar códigos;
- usar o espaço da janela e a tela cheia sem perder os controles;
- ajustar volume e silenciamento localmente;
- receber imagem e som sincronizados;
- recuperar uma queda breve sem abrir outra sessão;
- entender o estado da conexão pelas estatísticas e pelos avisos do app.

Para investigar problemas, os testes coletam dados reais do WebRTC: resolução, quadros, taxa de envio, perdas, latência de rede e rota selecionada. Esses dados não substituem a medição física do atraso entre a tela de origem e a de destino.

## Decisões de implementação

- Windows é a plataforma suportada nesta etapa.
- O processo de interface não tem acesso direto ao Node. O preload expõe somente `window.telae`, com IPC restrito ao documento principal e argumentos validados.
- Sinalização usa HTTPS/WSS. WebRTC fornece a criptografia da mídia; ICE usa STUN e TURN para estabelecer a rota.
- O servidor de sinalização não decodifica nem grava o fluxo de áudio e vídeo. As pequenas prévias de tela passam pelo servidor e ficam apenas na memória da transmissão.
- O app usa Opus para áudio. Processamento voltado a microfone, como cancelamento de eco, não deve alterar o áudio do sistema sem necessidade.
- A fonte é escolhida em cada transmissão. O app não começa a compartilhar silenciosamente.
- Amigos, presença, autorização, captura, transporte e qualidade têm responsabilidades separadas. A captura pode ser substituída por uma implementação nativa sem exigir outra interface de produto.
- Aplicativos protegidos por DRM ou HDCP podem recusar captura. O Telaê não contorna essas proteções.
- Português do Brasil é o idioma padrão. Inglês e a seleção pelo idioma do sistema continuam disponíveis nas configurações.
- O instalador oficial tem servidor e chave pública de atualização definidos na compilação. Atualizações são verificadas antes da instalação; uma transmissão ativa adia o reinício.

## Metas de qualidade

São metas para medições em hardware e redes reais, não garantias para todas as configurações.

| Medição | Meta inicial |
| --- | --- |
| Qualidade visual | Sustentar 1080p60 quando emissor, receptor e rede permitirem. O perfil inicial selecionado na interface é 1080p30. |
| Conteúdo de vídeo | Priorizar estabilidade e sincronização; usar 30 quadros por segundo quando 60 não trouxer benefício. |
| Atraso entre as telas em rede local | p95 de até 180 ms em hardware suportado. |
| Atraso entre as telas pela internet | p95 de até 400 ms nas condições de RTT e perda declaradas no teste. |
| Entrada até a primeira imagem | p95 de até 5 s. |
| Recuperação após uma queda breve | Até 5 s quando a recuperação ICE for bem-sucedida. |
| Sincronização de áudio e vídeo | Manter alinhamento perceptível e medir o desvio ao longo de sessões extensas. |
| Congestionamento | Reduzir qualidade antes de acumular atraso de reprodução. |

O procedimento e os limites de medição estão em [BENCHMARK.md](BENCHMARK.md). Os resultados registrados ficam em [validation](validation).

## Testes

- Testes unitários cobrem os estados de transmissão, a escolha de qualidade e as regras de segurança.
- Testes de integração usam clientes reais de sinalização para oferta e resposta SDP, candidatos ICE, entrada, saída e reconexão.
- Testes de ponta a ponta abrem duas instâncias do Electron. Cenários determinísticos rodam no CI; captura e áudio reais exigem Windows com monitor e dispositivo de áudio.
- Testes físicos devem incluir gráficos integrados e GPU dedicada, conexões diretas e TURN, vários espectadores e sessões extensas.
- Instalação inicial e atualização automática são verificadas separadamente. Arquivos adulterados, assinaturas inválidas e reinícios durante uma transmissão devem ser recusados.

## Fora do escopo atual

Controle remoto de mouse ou teclado, mensagens, comunidades, canais, gravação, vídeo sob demanda e clientes para navegador, celular, macOS ou Linux não fazem parte desta versão. Uma SFU continua como opção futura, caso o custo de enviar uma conexão por espectador justifique a mudança.
