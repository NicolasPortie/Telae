# Publicação de uma versão

## Verificações do aplicativo

- Conferir isolamento do processo de interface, sandbox, CSP e validação de IPC.
- Confirmar que só amigos autorizados conseguem assistir e receber prévias.
- Verificar parada da captura, remoção de espectadores e recuperação de quedas breves.
- Rodar os testes de desktop e servidor descritos em [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md).

## Instalador para Windows

1. Rodar `npm run build` e gerar o instalador com `npm run dist`.
2. No canal oficial, embutir o servidor e a chave pública, assinar a atualização com `npm run sign:update` e conferir o arquivo `.exe.sig.json`.
3. Se houver certificado Authenticode, conferir também sua assinatura e a cadeia esperada.
4. Testar instalação limpa, escolha de fonte, transmissão e entrada de um amigo.
5. Testar a atualização a partir de uma versão anterior, incluindo download, verificação, espera por uma transmissão ativa e reinício.

O instalador público é genérico. O instalador oficial e a publicação no servidor são produzidos no repositório privado de operação. O processo completo está em [OPERATIONS.md](OPERATIONS.md).

## Qualidade de transmissão

As medições físicas seguem [BENCHMARK.md](BENCHMARK.md), em conexão direta e por TURN. Guarde as amostras e o relatório com as condições do teste. Um teste de interface aprovado não comprova, por si só, atraso entre telas, som audível ou sincronização ao longo de uma sessão extensa.

## Tags e notas

A versão do `package.json`, a tag `vX.Y.Z` e as notas em `docs/releases/RELEASE_X.Y.Z.md` precisam corresponder. As notas devem explicar a mudança para quem usa ou hospeda o aplicativo, com limitações relevantes e validação realizada.

Tags e instaladores já publicados não devem ser substituídos por outra compilação da mesma versão. Correções do aplicativo recebem uma versão nova.
