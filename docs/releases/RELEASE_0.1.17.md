# Telaê 0.1.17

- Seleção de fontes com lista rolável e qualidade/ação de compartilhar sempre acessíveis, inclusive na janela mínima de 980 × 650.
- Atualização automática silenciosa com barra de download, percentual, indicador de atividade e aviso de reabertura. A instalação aguarda o fim da sessão; a animação respeita movimento reduzido.
- Perfis 1440p30 e 1440p60 disponíveis na captura, controles e servidor, com limites de bitrate e adaptação à sobrecarga. Auto removido da seleção; padrão 1080p30, preservando compatibilidade com clientes antigos.

Validação local: 110 testes desktop e 69 testes servidor; build, lint e E2E determinístico aprovados. Teste real QHD e limites da medição em [VALIDATION_QHD_2026-10-02.md](../validation/VALIDATION_QHD_2026-10-02.md). O teste da interface simula eventos de atualização para verificar barra e mensagens; não comprova a instalação completa de um pacote NSIS em outra máquina.

Atualizar o servidor antes de distribuir o desktop, pois versões anteriores rejeitam os novos perfis QHD. A tag dispara o workflow existente, que exige runner Windows interativo para mídia real antes de publicar o instalador. Criar/enviar a tag não confirma publicação nem implantação do backend.

Dos ajustes de layout propostos, somente acesso permanente à confirmação e feedback visual de atualização foram implementados. Os outros permanecem propostas.
