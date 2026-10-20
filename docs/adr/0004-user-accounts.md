# ADR 0004: contas de usuário com e-mail e senha

**Status:** aceita

## Contexto

A [ADR 0003](0003-device-identity.md) identificava cada instalação por uma credencial local, sem conta. Isso foi simples, mas deixa lacunas para um produto: perder o computador significa perder a identidade e os amigos, não há uso em mais de um dispositivo, não dá para bloquear um abusador nem encontrar alguém pelo nome.

## Decisão

Contas com e-mail, nome de usuário único e senha:

- **Armazenamento:** PostgreSQL via EF Core (migrações versionadas). SQLite só em desenvolvimento e testes.
- **Senha:** hash do ASP.NET Core Identity (PBKDF2 com sal), mínimo de 10 caracteres, lista de senhas óbvias, bloqueio por tentativas e custo de verificação igual para contas inexistentes.
- **Verificação e recuperação:** código de 6 dígitos por e-mail (SMTP configurável), válido por 15 minutos, com limite de tentativas e intervalo entre reenvios. O código é guardado como HMAC, não em texto.
- **Sessão:** token de acesso JWT de 15 minutos e refresh token de 30 dias, guardado somente como hash, com rotação a cada uso e revogação de todas as sessões se um token já trocado for reutilizado.
- **App:** os tokens ficam no processo principal do Electron, cifrados com o cofre do sistema; a interface só recebe o token de acesso para o SignalR.
- **Privacidade:** o e-mail nunca é exposto a outros usuários; a conta pode ser excluída pelo app (remoção definitiva).
- **Anti-enumeração:** cadastro, recuperação e reenvio respondem igual para contas existentes e inexistentes.

## Compatibilidade

Clientes até a 0.1.26 continuam funcionando enquanto `Auth:AllowLegacyDevices` estiver ligado (padrão). Perfis de conta e perfis legados nunca se confundem no servidor.

## Próximos passos

Amizades por nome de usuário (busca, pedidos e bloqueio no banco), convite por link, login social opcional e migração de quem já usava o código de amigo.
