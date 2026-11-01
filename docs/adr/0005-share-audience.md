# ADR 0005: quem transmite escolhe quem vê

**Status:** aceita

## Contexto

Até aqui, ser amigo e poder ver a tela eram a mesma coisa. Qualquer amigo mútuo entrava na transmissão, e todos os amigos online recebiam a prévia da tela a cada poucos segundos, mesmo sem entrar. Quem transmite só conseguia tirar alguém depois que a pessoa já tinha entrado, e o bloqueio valia só para aquela sessão.

A [ADR 0004](0004-user-accounts.md) já deixava bloqueio e privacidade para uma etapa seguinte.

## Decisão

Quem transmite escolhe entre todos os amigos e uma lista de amigos específicos. Pode mudar a escolha a qualquer momento, inclusive com a transmissão no ar.

- **Quem pode ver:** todos os amigos ou só os amigos escolhidos.
- **Prévia:** uma miniatura da tela no Início de quem pode ver. O público e a prévia seguem a mesma escolha.
- **Ocultar:** cada conta mantém uma lista de pessoas que nunca veem suas transmissões, sem desfazer a amizade.

As regras ficam no servidor, em uma única função (`CanWatchLocked`). Entrada, reconexão, prévia e presença passam por ela. O app só oferece as opções.

### Mudar a escolha com gente assistindo

O servidor é estrito: quem não está na lista escolhida sai da transmissão. O app torna isso previsível:

- **De "todos" para "escolhidos":** quem está assistindo já vem marcado, com a etiqueta "Assistindo". Ninguém sai até você desmarcar alguém, e antes de aplicar o app diz pelo nome quem sairia ("Caio sai da transmissão ao aplicar").
- **Marcar alguém que não assiste:** a pessoa passa a ver o cartão ao vivo e pode entrar. O app não a coloca na transmissão sozinho.
- **De "escolhidos" para "todos":** ninguém sai.
- **Quem você removeu com o X** continua fora daquela transmissão, mesmo que a lista o inclua. O X vale só para a transmissão atual e não mexe na lista.

### Padrões

- Sem escolha, vale o comportamento anterior: todos os amigos, com prévia. Clientes antigos continuam funcionando assim.
- O app lembra a última escolha neste computador.
- Ocultar é silencioso: a pessoa continua vendo quem a ocultou como online e não recebe aviso.

### Privacidade

Quem não pode ver a transmissão recebe a mesma resposta de "não está transmitindo", vê o amigo apenas como online e não recebe prévia nem aviso de "ao vivo". A ordem da lista de amigos também não denuncia a transmissão.

## Alternativas descartadas

- **Pedir para entrar (aprovação).** Foi implementada e retirada. Duplicava a escolha de quem pode ver: se você já escolheu quem vê, aprovar de novo cada pessoa é um segundo mecanismo para o mesmo objetivo. Quem quer controlar escolhe os amigos, e dá para adicionar alguém no meio da transmissão.
- **Link de convite para quem não é amigo.** Quem recebe precisaria instalar o app e criar uma conta do mesmo jeito, então o link só economizaria o passo de adicionar como amigo.
- **Público "ninguém".** Sem link, ninguém conseguiria entrar.
- **Bloquear usuário** (esconder até a presença e impedir pedidos de amizade). É outro recurso; ocultar resolve o caso das transmissões sem mexer na amizade.

## Consequências

- A presença deixou de ser igual para todos os amigos: `PresenceChanged` é calculado por observador e enviado em grupos.
- `StartShareRequest` ganhou `Audience`, opcional.
- Os convites por código dos clientes legados (até a 0.1.20) foram removidos.
- Uma tabela nova, `HiddenViewers`, com migração para PostgreSQL. No SQLite de desenvolvimento, a tabela é criada na inicialização se faltar.
