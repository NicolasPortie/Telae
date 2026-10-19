# Política de segurança

## Reportando uma vulnerabilidade

Não abra uma issue pública. Use o recurso **Report a vulnerability** da aba Security deste repositório (relato privado). Responderei assim que possível e coordenaremos a correção antes da divulgação.

## O que está no escopo

- Servidor de sinalização (`apps/server`): autenticação de dispositivos, autorização entre amigos, limites de entrada e credenciais TURN.
- Aplicativo desktop (`apps/desktop`): isolamento do renderer, API do preload e atualizações.

O modelo de identidade e as defesas já adotadas estão descritos em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e na [ADR 0003](docs/adr/0003-device-identity.md).
