# Política de segurança

## Reportando uma vulnerabilidade

Não abra uma issue pública. Use o recurso **Report a vulnerability** da aba Security deste repositório (relato privado). Responderei assim que possível e coordenaremos a correção antes da divulgação.

## O que está no escopo

- Servidor de sinalização (`apps/server`): autenticação e revogação de contas/dispositivos, autorização entre amigos, prévias de tela, limites de entrada e credenciais TURN.
- Aplicativo desktop (`apps/desktop`): isolamento do renderer, API do preload e atualizações.

O modelo de identidade e as defesas já adotadas estão descritos em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e na [ADR 0003](docs/adr/0003-device-identity.md).

Escolha um servidor de confiança: seu administrador recebe os dados de conta e a senha usada nele. Use uma senha exclusiva. Sessões locais ficam vinculadas ao servidor e dependem da proteção do sistema operacional para persistência. A origem de atualizações é fixada na compilação; instalações sem assinatura de código exigem atualização manual pela página oficial do projeto.

Requisitos de TLS, proxies confiáveis, proteção dos dados persistidos e recomendações opcionais de WAF/Turnstile estão em [docs/OPERATIONS.md](docs/OPERATIONS.md).

Códigos de confirmação e recuperação têm limites por conta e finalidade em uma janela móvel de 24 horas, além do limite por código. Tentativas de senha usam espera exponencial por conta e IP confiável, com um teto global por conta contra tentativas distribuídas. Os históricos ficam no banco e sobrevivem a reinícios. Clientes legados sem conta vêm desativados, inclusive sem configuração explícita.

A chave raiz `Auth:JwtKey` gera chaves independentes por HKDF-SHA-256 para assinatura de JWT e HMAC dos códigos. A adoção dessa derivação invalida tokens de acesso e códigos pendentes anteriores; veja as orientações de atualização em [docs/OPERATIONS.md](docs/OPERATIONS.md).

O desktop empacotado serve o renderer por um protocolo local com CSP em header, restringindo conexões à origem do servidor ativo, ao WebSocket correspondente e aos esquemas STUN/TURN. Navegações e redirecionamentos do renderer são bloqueados. O empacotamento ativa os fuses de isolamento do Electron e exige carregar o aplicativo do ASAR.
