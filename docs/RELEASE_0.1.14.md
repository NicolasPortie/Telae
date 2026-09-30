# Telae 0.1.14

Corrige o visualizador que mantinha a transmissão em uma coluna estreita ao maximizar a janela e cortava as laterais por padrão. O vídeo agora usa toda a área disponível abaixo do cabeçalho, acompanha o redimensionamento e começa em modo Ajustar, preservando a imagem completa. Preencher continua disponível como escolha do espectador.

O modo tela cheia também ocupa toda a largura e altura disponíveis. Barras pretas continuam possíveis quando a proporção da tela compartilhada difere da janela do espectador; a imagem permanece inteira em Ajustar.

Validação: TypeScript, lint, build, 43 testes do desktop e os três E2E com captura real passaram. O E2E verifica dimensões em janelas largas e verticais, ausência de rolagem, alternância Ajustar/Preencher e tela cheia sem corte por padrão.

Esta atualização altera apenas o desktop e mantém compatibilidade com o backend 0.1.13. O workflow da tag publica o instalador e entrega a atualização Windows ao servidor; não requer reiniciar o serviço de sinalização.
