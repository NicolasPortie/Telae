# Telaê 0.3.0: nova interface, prévias ao vivo e proteção de contas

Versão de 24/10/2026.

## Para quem usa

- Nova marca verde e telas de entrada, início, transmissão e configurações redesenhadas.
- Prévias de quem está transmitindo na tela inicial, disponíveis apenas para amigos mútuos.
- Escolha entre Telas e Janelas por abas e ajuste a qualidade no rodapé do seletor.
- O botão Escolher tela mantém a área de clique estável após redimensionar a janela.
- Demonstrações em GIF e capturas em português e inglês atualizadas.
- Após a atualização do servidor, entre novamente na conta. A senha e a lista de amigos são preservadas.

## Para quem hospeda

Atualize o backend antes de distribuir o desktop. O novo renderer usa a origem `telae://app`; o backend desta versão já a aceita. Faça backup do PostgreSQL e dos arquivos de configuração antes do deploy.

As migrações `SessionRevocation` e `AccountAbuseBudgets` são aplicadas na inicialização. Sessões anteriores são revogadas, e tokens de acesso e códigos pendentes anteriores deixam de valer. Não misture instâncias antigas e novas. Bancos SQLite de desenvolvimento com esquema antigo exigem atualização explícita ou recriação somente quando descartáveis.

O renderer tem CSP restrita ao servidor ativo; IPC, sinalização, envio de e-mail, limites de autenticação e revogação de sessões receberam proteções adicionais. As prévias ficam apenas em memória.

A origem das atualizações passa a ser fixada na compilação. O atualizador exige a identidade do publicador no instalador assinado. Os instaladores desta entrega são **sem assinatura Authenticode** e exigem atualização manual; a publicação no feed não habilita atualização automática segura nesses builds. O instalador público continua genérico; o oficial, com servidor embutido, fica na distribuição privada.

## Validação local

- Build desktop (incluindo TypeScript) e lint aprovados.
- 287 testes unitários/de componentes do desktop e 223 testes do servidor aprovados.
- E2E padrão: 3 aprovados, 6 cenários opt-in omitidos.
- E2E de duas instâncias com mídia real: 4 aprovados, relay omitido.
- GIFs nos dois idiomas regravados e inspecionados.

Os resultados acima comprovam os fluxos exercitados nesta máquina; não são benchmark de Internet, TURN, carga ou endurance. Esses cenários não foram executados nesta validação. O workflow de release repete os testes do servidor, lint, TypeScript, testes do desktop e E2E determinístico na tag publicada.
