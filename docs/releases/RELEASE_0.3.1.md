# Telaê 0.3.1

Correção de 24/10/2026.

- O app não apresenta mais o aviso permanente de que a instalação não atualiza sozinha. Instalações oficiais sem assinatura consultam o feed e ficam silenciosas quando estão em dia. Quando há versão nova, mostram **Baixar atualização**, que abre o instalador no navegador para instalação manual.
- Corrigida a inicialização do atualizador para preservar o feed HTTPS definido na compilação após carregar a configuração local, sem voltar ao endereço de exemplo do pacote.
- Builds assinados continuam com verificação de assinatura e instalação automática. Builds sem assinatura não baixam nem executam atualizações automaticamente, inclusive ao fechar o aplicativo.
- Builds genéricos sem um servidor de atualizações definido na compilação oferecem a página pública de releases sem apresentar erro ao iniciar.
- O instalador oficial aceita uma migração do endereço padrão anterior para o novo. A migração só substitui a correspondência exata do padrão anterior; servidores personalizados permanecem selecionados. A sessão vinculada ao endereço antigo exige novo login.

Instale esta correção manualmente se estiver na 0.3.0: o bloqueio daquela versão não pode ser corrigido pelo servidor de atualizações. O endereço oficial é fornecido pelo mantenedor e não faz parte do código público.

Validação: lint, TypeScript, testes do desktop, E2E determinístico e smoke do aplicativo empacotado. A correção mantém bloqueadas instalações automáticas sem publicador confiável e testa a preservação de servidores personalizados durante a migração.
