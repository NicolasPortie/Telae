---
status: accepted
---

# ADR 0002: priorizar conexão direta, com TURN como alternativa

A primeira versão do Telaê foi planejada para um emissor e um espectador, usando WebRTC direto quando ICE encontrasse uma rota e TURN quando a retransmissão fosse necessária. Vários espectadores ficaram inicialmente para uma etapa com SFU, devido ao custo de envio de uma conexão por pessoa.

O app passou a aceitar até 12 espectadores por transmissão, com uma conexão independente para cada um. A prioridade por conexão direta e a alternativa por TURN foram mantidas. Uma SFU continua como opção futura. Os limites do modelo atual estão em [Arquitetura](../ARCHITECTURE.md#conexão-e-vários-espectadores).
