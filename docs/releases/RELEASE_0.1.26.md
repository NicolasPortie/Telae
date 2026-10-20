# Telae 0.1.26: novo visual, idiomas e configurações

Versão de 19/10/2026. Não altera o protocolo com o servidor: continua compatível com o backend da 0.1.25.

## Para quem usa

- **Visual novo:** tema escuro neutro com acento âmbar, fonte Geist, barra de título integrada, novo ícone e telas inicial, de amigos, de escolha de fonte, de transmissão e do player redesenhadas.
- **Português e inglês:** a interface segue o idioma do Windows ou o escolhido em Configurações.
- **Configurações:** nome, idioma, avisos, início com o Windows, endereço do servidor de sinalização e informações da instalação.
- **Aviso do Windows** quando um amigo começa a transmitir e o Telae não está em foco.
- **Indicador de conexão** no cabeçalho e estado de carregamento na lista de amigos.
- Texto secundário com contraste mínimo de 4,5:1.

## Segurança

- A credencial do dispositivo passa a ficar cifrada com o cofre do sistema (DPAPI). Perfis existentes são migrados na primeira abertura, sem trocar a identidade nem a lista de amigos. Sem cofre disponível, o comportamento anterior é mantido.

## Para quem desenvolve

- `App.tsx` dividido em telas e componentes; estado de amigos no hook `useFriends`; `TelaeRegistry` em arquivos parciais por responsabilidade.
- Camada de tradução `t()` com teste de cobertura (inclui as mensagens de erro do servidor).
- Testes de componentes, Dockerfile e `docker-compose.yml` para o servidor, licença MIT, `CONTRIBUTING`, `SECURITY` e Dependabot.
- Servidor e testes compilam com avisos como erro.

## Validação

157 testes unitários na 0.1.25 passaram a 175, junto com 81 testes de servidor, lint, typecheck e o E2E de duas instâncias com captura real de tela, em Windows 11 com sinalização local. O pipeline do GitHub Actions não pôde ser executado por limite de orçamento da conta; a validação foi feita localmente.

O instalador continua sem assinatura de código do Windows.
