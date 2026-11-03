# Telaê 0.4.0

Versão de 04/11/2026.

Quem transmite pode escolher todos os amigos ou apenas algumas pessoas para assistir. A escolha vale para a transmissão, a presença ao vivo e a prévia, e pode ser alterada enquanto a tela está sendo compartilhada.

- Ao mudar de todos os amigos para amigos escolhidos, quem já assiste vem marcado. O aplicativo informa quem sairá antes de aplicar a mudança.
- É possível ocultar suas transmissões de alguém sem desfazer a amizade. A lista fica salva na conta e pode ser alterada em Configurações > Privacidade.
- Amigos ao vivo continuam na lista, com o botão Assistir. Os formulários de adicionar amigo e responder a pedidos também foram revisados.
- A transmissão aceita vários espectadores, sem um teto fixo no servidor. Cada espectador usa uma conexão própria; o limite prático depende do upload e da CPU de quem transmite.
- A documentação, as capturas de tela e a demonstração foram atualizadas.

## Atualização do servidor

Atualize o servidor antes de distribuir o desktop. Esta versão adiciona a tabela `HiddenViewers` e os métodos de sinalização usados para alterar o público e a privacidade. Faça backup do banco antes da migração.

Clientes anteriores com contas continuam transmitindo para todos os amigos por padrão. Os convites por código dos clientes legados foram removidos; entrar em uma transmissão exige amizade mútua e permissão de quem transmite.

O instalador desta página é genérico, sem servidor predefinido. Informe o endereço em Servidor > Alterar na tela de entrada. O instalador oficial continua usando o canal de atualização com assinatura Ed25519 do projeto.
