# Telaê 0.2.1: instalador público sem servidor embutido

Versão de 24/10/2026. Sem mudança de protocolo com o servidor 0.2.0.

## Para quem usa

- A tela de entrada mostra o servidor em uso e permite trocá-lo (**Servidor > Alterar**) antes de criar a conta.
- O instalador publicado no GitHub é **genérico**: não vem apontado para nenhum servidor. Quem hospeda o próprio servidor informa o endereço na primeira abertura.

## Para quem desenvolve e hospeda

- O endereço padrão do servidor deixou o código: entra na compilação por `TELAE_DEFAULT_SERVER_URL`. Sem a variável, o app não aponta para servidor nenhum.
- O modelo de `app-update.yml` do instalador não cita mais um host real; a verificação de atualizações usa sempre o servidor configurado.
- O instalador oficial do mantenedor é gerado e distribuído fora deste repositório.

## Validação

211 testes unitários e de componentes no desktop, 131 de servidor, lint, typecheck e o E2E determinístico.
