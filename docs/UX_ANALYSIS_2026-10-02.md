# Análise de interface — 02/10/2026

Atualização em 03/10/2026: implementados apenas o acesso permanente à confirmação no seletor e o progresso visual da atualização, além da remoção do Auto já concluída. A lista de fontes rola separadamente; qualidade e botão ficam na base da janela. A atualização exibe barra/percentual, indicador de atividade e aviso antes de reabrir, respeitando movimento reduzido. As demais sugestões abaixo continuam propostas.

Escopo: inspeção do aplicativo Electron aberto nas telas inicial e seleção de fontes, em janela padrão de 1220 × 790 e mínima de 980 × 650; leitura do código dos estados de transmissão, reprodução, diagnóstico e atualização. Não houve redesenho geral nem auditoria completa de acessibilidade. As sugestões abaixo estão propostas; apenas a remoção de Auto foi implementada nesta etapa.

## Mudança aplicada

- Auto removido dos controles compartilhados de qualidade, tanto no seletor inicial como na transmissão.
- 1080p30 como padrão da interface e do estado inicial do controller.
- Perfis disponíveis: 720p60, 1080p30, 1080p60, 1440p30 e 1440p60.
- Clientes antigos que enviam Auto continuam compatíveis; seu perfil aparece como “Adaptativo (versão anterior)” para quem assiste. Novas transmissões da interface não oferecem essa opção.
- A proteção contra sobrecarga de CPU/rede permanece nos perfis explícitos.

Validação: 110 testes unitários do aplicativo, build e lint aprovados. E2E de duas instâncias aprovado, verificando ausência de Auto, cinco opções, 1080p30 selecionado inicialmente e ausência de transbordamento horizontal no seletor em janela mínima.

## O que está funcionando bem

A paleta escura com destaque âmbar, a tipografia nativa do Windows e o foco em duas ações principais dão uma identidade coerente ao produto. Há feedback de foco e pressionamento, mensagens de erro e estados de espera. O player dedica quase toda a janela ao vídeo e tem volume, ajuste e tela cheia. Não vejo necessidade de trocar fontes, cores, biblioteca de ícones ou adicionar efeitos decorativos.

## Melhorias priorizadas

| Prioridade | Evidência atual | Mudança proposta | Como verificar |
| --- | --- | --- | --- |
| Alta | Na janela mínima, com 2 telas e 9 janelas disponíveis, o botão de iniciar aparece ao final de uma página de aproximadamente 1400 px; a área visível tem cerca de 610 px. | Manter qualidade e confirmação em uma área fixa ou sticky, deixando apenas a lista de fontes rolar. Considerar abas Telas/Janelas e pesquisa para muitas janelas. | Abrir 10+ janelas; confirmar que a ação permanece visível, sem cobrir a última fonte nem o foco do teclado. |
| Alta | Atualização mostra percentual como texto; instalação fecha e reabre o app. | Barra de progresso durante download e indicador discreto de instalação/reabertura. Informar quando a atualização aguarda o fim da transmissão. | Simular download lento, atualização pronta durante sessão e falha; verificar leitura por teclado/leitor de tela e preferência por movimento reduzido. |
| Alta | Opções têm nomes mistos: “720p”, “1080p”, “1080p60”, “2K · 1440p” e “2K · 1440p60”. Parte da explicação existe só no atributo title. | Mostrar resolução e FPS em todas: “720p · 60 FPS”, “1080p · 30 FPS”, “1080p · 60 FPS”, “2K · 30 FPS” e “2K · 60 FPS”. Mostrar uma linha de ajuda para a opção selecionada: uso de 30/60 fps e dependência do PC/rede. | Conferir que a escolha é compreensível sem passar o mouse e funciona com teclado. |
| Média | Durante a transmissão, qualidade, conteúdo e limite em Mbps ocupam o mesmo bloco. | Deixar qualidade e áudio à vista; agrupar conteúdo e orçamento de upload em “Ajustes avançados”. | Verificar que iniciar, copiar convite, trocar fonte e parar continuam simples, e que os ajustes avançados preservam seus valores. |
| Média | O estado principal exibe o perfil selecionado. Resolução e FPS efetivos estão apenas nos detalhes. | Mostrar uma indicação compacta dos valores efetivamente enviados/recebidos e explicar redução por sobrecarga quando a telemetria permitir. | Comparar perfil selecionado e `getStats()` com fonte menor e CPU/rede limitadas; não anunciar “2K60” como desempenho garantido. |
| Média | A tela inicial usa título de 30–42 px e cartões grandes antes das ações. | Reduzir o espaço do título e concentrar “Mostrar minha tela” e “Entrar com código” mais perto do topo, sobretudo em janela pequena. | Verificar visualmente as duas ações em 980 × 650, com escala do Windows em 100%, 125% e 150%. |

## Ordem sugerida

Primeiro, acesso ao botão de iniciar no seletor e feedback de atualização. Depois, clareza dos perfis e simplificação dos ajustes da transmissão. Por fim, densidade da tela inicial e indicação da qualidade efetiva. Nenhuma dessas melhorias exige mudar o motor de captura ou o protocolo de mídia.

## Limites da análise

Os estados da sessão/player foram analisados no código; as capturas desta etapa cobrem home e picker. A inspeção atual ocorreu com escala 100%; 125%/150% ainda precisam de teste. As miniaturas foram mascaradas nas capturas de análise para não expor conteúdo das janelas. As medições locais de 2K estão em [VALIDATION_QHD_2026-10-02.md](VALIDATION_QHD_2026-10-02.md).
