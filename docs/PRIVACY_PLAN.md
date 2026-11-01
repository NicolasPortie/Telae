# Plano: controle de quem assiste

Quem transmite escolhe quem pode assistir e receber a prévia. A decisão e o motivo de cada escolha estão na [ADR 0005](adr/0005-share-audience.md); os detalhes técnicos, em [ARCHITECTURE.md](ARCHITECTURE.md#quem-pode-ver).

O público pode ser todos os amigos ou apenas os escolhidos. Dá para mudar a qualquer momento, inclusive durante a transmissão.

## Recursos

1. **Quem pode ver:** todos os amigos ou amigos escolhidos, antes e durante a transmissão.
2. **Prévia:** a miniatura só vai para quem pode ver e acompanha a escolha de público.
3. **Ocultar transmissões:** um amigo deixa de ver suas transmissões sem que a amizade seja desfeita.

A lista de amigos mantém quem está ao vivo e oferece a ação Assistir. Os formulários de adicionar amigo e os pedidos de amizade ficam na mesma lista.

O acesso exige amizade mútua, sem link de convite ou pedido de aprovação por transmissão. O motivo está na ADR 0005.

## Regra de acesso

| # | Situação | Resultado |
| --- | --- | --- |
| 1 | É quem transmite | Não vê |
| 2 | Está oculto por quem transmite | Não vê |
| 3 | Foi removido desta transmissão | Não vê |
| 4 | Não é amigo mútuo | Não vê |
| 5 | Modo "escolhidos" e não está na lista | Não vê |
| 6 | Qualquer outro caso | Vê e pode entrar |

## Mudar a escolha durante a transmissão

| Mudança | O que acontece |
| --- | --- |
| Todos → escolhidos | Quem assiste já vem marcado ("Assistindo"). Quem você desmarcar sai ao aplicar, e o app diz o nome antes. |
| Marcar alguém que não assiste | A pessoa passa a ver o cartão ao vivo e pode entrar. Ninguém entra sozinho. |
| Desmarcar quem assiste | A pessoa sai ao aplicar. |
| Escolhidos → todos | Ninguém sai. |

## O que foi feito

### Servidor

- [TelaeRegistry.Access.cs](../apps/server/Core/TelaeRegistry.Access.cs): regra única, reavaliação, público e ocultos.
- Presença calculada por observador em [PresenceSubscriptions.cs](../apps/server/Core/PresenceSubscriptions.cs). A prévia só vai para quem pode ver.
- Tabela `HiddenViewers` e [HiddenViewersService.cs](../apps/server/Accounts/HiddenViewersService.cs).
- Hub: `UpdateShareAudience`, `GetHiddenViewers`, `HideShares` e `UnhideShares`. Evento novo: `SharePreviewRemoved`.
- Convites legados removidos.

### Desktop

- [AudiencePicker.tsx](../apps/desktop/src/components/AudiencePicker.tsx): escolha antes de transmitir, com duas opções e a lista de amigos.
- [AudienceEditor.tsx](../apps/desktop/src/components/AudienceEditor.tsx): mudança durante a transmissão, com quem assiste já marcado e o aviso por nome.
- [audience.ts](../apps/desktop/src/services/audience.ts): as regras de "quem já assiste" e de "quem sairia".
- [FriendsRail.tsx](../apps/desktop/src/components/FriendsRail.tsx): amigo ao vivo na lista (grupo "Ao vivo" no alto, com "Assistir"), ações de ocultar e remover sobre a linha ao passar o mouse. [AddFriendForm.tsx](../apps/desktop/src/components/AddFriendForm.tsx) e [FriendRequests.tsx](../apps/desktop/src/components/FriendRequests.tsx) redesenhados.
- Na aba Privacidade das Configurações, a lista de ocultos com a opção de desfazer.

### Testes

- Servidor: a regra de acesso e as mudanças no meio da transmissão ([ShareAccessTests.cs](../tests/server/ShareAccessTests.cs)) e o hub real com presença por observador e ocultos no banco ([PrivacyHubTests.cs](../tests/server/PrivacyHubTests.cs)).
- Desktop: controlador, sinalização, componentes, regras de "quem já assiste" e traduções.
- Ponta a ponta, no app real com três instâncias: todos os amigos, escolhidos (inclusive marcar alguém no meio), mudar para escolhidos com gente assistindo, prévia só para o público permitido, ocultar e amigo ao vivo na lista.

## O que os testes não cobrem

- dois computadores de verdade, em redes diferentes;
- ocultar alguém que está assistindo no momento pela interface: durante a transmissão o app não mostra a lista de amigos. O servidor já remove a pessoa (coberto nos testes do servidor), mas a interface hoje só alcança isso pelo editor de quem pode ver (desmarcar a pessoa).
