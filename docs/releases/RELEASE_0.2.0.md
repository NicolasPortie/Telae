# Telaê 0.2.0: contas, amigos pelo @usuário e visual novo

Versão de 23/10/2026. **Exige atualizar o servidor e o desktop juntos:** o servidor passa a recusar clientes sem conta, e o desktop novo precisa de uma conta para entrar.

## Para quem usa

- **Contas:** e-mail, @usuário único e senha, com verificação por código de 6 dígitos, recuperação de senha, sessões com rotação e exclusão de conta. Os tokens ficam no cofre do sistema.
- **Amigos pelo @usuário, sem código.** A lista, os pedidos e as dispensas ficam no servidor e acompanham a conta em qualquer computador.
- **Visual novo ("sala escura"):** início com amigos agrupados em Ao vivo, Online e Offline, e um palco com quem está transmitindo. Entrar e criar conta redesenhados, com medidor de força da senha e código de verificação em seis casas.
- **Textos reescritos em tom de conversa**, em português e inglês. O nome do produto passa a ser escrito **Telaê**.

## Segurança

- **Cadastro fechado por padrão** no servidor: só e-mails liberados em `Auth__AllowedEmails` criam conta. `Auth__RegistrationOpen=true` abre para qualquer pessoa.
- **Clientes sem conta desligados por padrão** (`Auth__AllowLegacyDevices=false`).
- Limites por IP do cadastro e das demais chamadas de conta, configuráveis.

## Para quem hospeda

- Defina `Auth__JwtKey` e, em produção, a conexão com o PostgreSQL (veja `.env.example`). O Docker Compose já traz as variáveis de acesso.
- O servidor escuta só em `127.0.0.1` no unit de exemplo; publique por um túnel ou proxy com TLS.

## Para quem desenvolve

- O repositório público roda só em runners da GitHub; deploy e validação física de mídia ficaram num repositório de operação privado.
- Novo `release.yml`: a tag `v*` valida, gera o instalador e cria a Release.

## Validação

207 testes unitários e de componentes no desktop, 131 testes de servidor, lint, typecheck e o E2E determinístico de duas instâncias. O instalador continua sem assinatura de código do Windows, então o SmartScreen pode avisar na primeira execução.
