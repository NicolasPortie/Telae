# Telaê 0.1.15

Player com ocultação do cursor local em tela cheia, saída por Esc, atalhos F/M e controles acessíveis por teclado. Interface de transmissão reorganizada, prévia enquanto aguarda espectadores e seleção de fontes pelas setas.

Controles de qualidade, conteúdo, limite de vídeo, silêncio e remoção de espectadores durante a sessão. Troca de fonte com rollback, recuperação limitada pela apresentação de frames, PCM com fila limitada e histórico de diagnóstico exportável.

Backend com presença restrita, remoção autorizada e bloqueio de retorno à sessão, limites de mensagens e validação TURN. O backend precisa ser atualizado antes do desktop. Para cloudflared local, configurar `ClientAddress__KnownProxies` para os endereços loopback utilizados e `ClientAddress__HeaderName=CF-Connecting-IP`.

Validação anterior à release: 99 testes desktop, 67 testes backend, builds/lint/tipos, E2E de mídia e TURN local aprovados. Carga de 3/6/12 espectadores por 60 segundos em uma máquina. Essas medições não afirmam sincronização acústica, 1080p60, alcance em redes externas ou endurance de uma hora.

Instalador sem assinatura Authenticode enquanto nenhum certificado de distribuição estiver configurado. Consulte [a validação de publicação](../RELEASE_VALIDATION.md).
