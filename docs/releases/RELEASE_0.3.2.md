# Telaê 0.3.2: atualizações automáticas do instalador oficial

O instalador oficial passa a baixar as próximas versões automaticamente, verificar a assinatura do projeto e instalar em silêncio quando não houver transmissão ativa. O app reinicia após a instalação. A consulta acontece ao abrir e a cada 15 minutos.

A assinatura Ed25519 cobre a versão, o nome, o tamanho e o SHA-512 do instalador. A chave pública é fixada na compilação; a privada não fica no cliente nem no servidor de downloads. O app confere arquivos recém-baixados e do cache, e repete a verificação antes de executar. Uma assinatura ausente, inválida ou um arquivo alterado impede a instalação. Instalação automática pela rotina de saída da biblioteca fica desligada nesse fluxo, evitando execução antes da verificação do projeto.

O link `/download/windows` do servidor oficial sempre entrega a versão publicada mais recente. É o link de instalação inicial que o mantenedor pode compartilhar com amigos; o endereço do servidor já vem configurado no instalador oficial.

Esta proteção não é um certificado Authenticode do Windows: o aviso de reputação do Windows na instalação inicial ainda pode aparecer. Builds genéricos sem feed/chave de confiança próprios continuam independentes da distribuição oficial.

Quem já está nas versões 0.3.0 ou 0.3.1 precisa instalar esta versão de transição uma vez, porque aquelas versões não incluem a chave e o novo fluxo. Depois dessa instalação, as próximas atualizações oficiais são automáticas.
