---
status: accepted
---

# ADR 0001: usar o WebRTC do Chromium antes de criar um motor nativo

O Telaê usa Electron/Chromium para captura, transporte WebRTC, controle de congestionamento, negociação de codecs, criptografia e reprodução.

Uma interface de captura separada permite substituir a captura e a codificação por uma implementação nativa do Windows, se as medições mostrarem que o Chromium é o limitador. Isso evita assumir o custo de uma solução própria em C#, C++ ou Rust antes de haver evidência da necessidade.
