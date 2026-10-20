# ADR 0003: identidade por dispositivo, sem contas

**Status:** substituída pela [ADR 0004](0004-user-accounts.md)

## Contexto

O Telae precisa saber quem é cada pessoa para listar amigos, mostrar presença e autorizar quem pode assistir a uma transmissão. A alternativa convencional seria cadastro com e-mail e senha (ou login social).

## Decisão

Cada instalação gera uma credencial aleatória de 256 bits e um identificador de dispositivo. O servidor guarda apenas o hash SHA-256 da credencial e a compara em tempo constante. O código de amigo de 6 caracteres é público e serve só para pedir amizade; a amizade só vale quando os dois lados se declaram. Não há e-mail, senha nem dado pessoal além do nome de exibição.

## Por que não contas

- **Fricção:** o produto existe para abrir e mostrar a tela em segundos.
- **Superfície e responsabilidade:** contas exigem recuperação de senha, verificação de e-mail, proteção contra força bruta e tratamento de dados pessoais (LGPD).
- **Valor entregue:** com amigos mútuos e uma credencial por dispositivo, já se garante que ninguém assista sem ser aceito.

## Consequências

- Perder o computador ou reinstalar o Windows sem copiar `profile.json` significa perder identidade e lista de amigos.
- Não há uso em vários dispositivos com a mesma identidade.
- Bloquear um abusador é por dispositivo; ele pode gerar outra identidade.

## Quando revisitar

Se surgirem multi-dispositivo, recuperação de perfil ou moderação, o caminho preferido é **login social opcional** (por exemplo Discord ou GitHub via OAuth) vinculado à identidade de dispositivo existente, e não um cadastro próprio com senha. Uma etapa intermediária mais barata é exportar e importar o perfil local como arquivo.
