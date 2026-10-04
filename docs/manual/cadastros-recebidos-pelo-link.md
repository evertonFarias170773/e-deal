# Cadastros: Recebidos pelo link

> **Última revisão:** 04/10/2026
> **Caminho no menu:** Clientes → botão **Recebidos pelo link** (no topo da tela Cadastros)
> **Endereço:** `/cadastros/online`

## Para que serve

É a fila dos cadastros que os próprios clientes preencheram pelo link do atendente. Aqui você pega o seu link para enviar ao cliente, vê o que chegou e decide o que ficou pendente.

A maior parte entra sozinha: o cliente preenche, o cadastro é criado na hora e já aparece na tela Cadastros, vinculado ao vendedor dono do link. Só fica esperando alguém o cadastro de CPF cujo nome não pôde ser confirmado.

## Quem acessa

- Qualquer usuário com acesso ao sistema vê a fila inteira, de todos os vendedores.
- Vendedor comum vê e gera só o próprio link, no quadro **Link de cadastro**.
- Administrador e Super Admin escolhem o vendedor no campo **Vendedor** e geram ou trocam o link dele.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Gerar meu link** | Quadro **Link de cadastro** (vendedor) | Mostra o seu link de cadastro. |
| **Vendedor** (**Selecione o vendedor…**) | Quadro **Link de cadastro** (só Administrador e Super Admin) | Escolhe de quem é o link. |
| **Ver ou gerar o link deste vendedor** | Quadro **Link de cadastro** (só Administrador e Super Admin) | Mostra o link do vendedor escolhido. |
| **Copiar** | Ao lado do endereço do link | Copia o endereço para enviar ao cliente. Vira **Copiado** por um instante. |
| **Gerar link novo e invalidar o atual** | Abaixo do endereço do link | Abre a confirmação **Gerar um link novo?**. |
| **Sim, trocar o link** | Confirmação **Gerar um link novo?** | Cria um link novo. O anterior para de funcionar na hora. |
| **Todos**, **Aprovados (n)**, **Pendentes (n)**, **Recusados (n)** | Acima da lista | Filtram a fila pela situação. O número é a quantidade de cada uma. |
| **Aprovar e criar cliente** | No envio **Pendente** | Abre a janela **Aprovar e criar o cliente?**. Confirmando, cria o cliente. |
| **Recusar envio** | No envio **Pendente** | Abre a janela **Recusar este envio?**, com o campo **Motivo (opcional)**. Nenhum cliente é criado. |
| **Desfazer cadastro** | No envio aprovado | Abre a janela **Desfazer este cadastro?**, com o campo **Motivo (recomendado)**. Deixa o cliente inativo. |
| **Abrir cadastro** | No envio que já tem cliente criado | Abre o cadastro do cliente. |
| **Cancelar** | Nas janelas de confirmação | Fecha sem fazer nada. |

Cada envio mostra o nome, o documento, a situação (**Aprovado automaticamente**, **Aprovado**, **Pendente** ou **Recusado**) e as linhas **Veio do link de**, **Recebido em**, **Contato**, **Endereço**, **Cliente criado**, **Consentimento** e, quando houver, **Motivo**. Nos envios de CPF aparece também **Nome x CPF (CPFHub)**.

## Passo a passo

### Enviar o link para o cliente

1. No quadro **Link de cadastro**, clique em **Gerar meu link**.
2. Clique em **Copiar** e envie o endereço para o cliente.
3. O link é fixo: pode ser usado quantas vezes quiser, e tudo o que entrar por ele fica atribuído a você.

### Conferir o que chegou

1. Abra **Recebidos pelo link**. Os envios mais recentes aparecem primeiro.
2. Envio com **Aprovado automaticamente** já é cliente: clique em **Abrir cadastro** para ver ou completar os dados.
3. Envio com **Pendente** espera você. Use o filtro **Pendentes** para ver só esses.

### Aprovar um cadastro de CPF pendente

1. No envio, leia a linha **Nome x CPF (CPFHub)**.
2. Se estiver **NOME NÃO CONFERE — verifique antes de aprovar**, confirme com a pessoa o nome e o CPF antes de seguir.
3. Clique em **Aprovar e criar cliente** e confirme na janela **Aprovar e criar o cliente?**.
4. O cliente é criado ativo, com o endereço e o contato do envio, vinculado ao vendedor do link. O envio passa para **Aprovado**, em seu nome.

### Recusar um envio pendente

1. Clique em **Recusar envio**.
2. Escreva o motivo, se quiser, e confirme em **Recusar envio**.
3. O envio fica na fila como **Recusado**, com o motivo.

### Desfazer um cadastro que entrou

1. No envio aprovado, clique em **Desfazer cadastro**.
2. Leia o quadro **O que isto NÃO desfaz**, escreva o motivo e confirme em **Desfazer cadastro**.
3. O cliente fica inativo e some da lista de ativos. O envio passa para **Recusado**.

## Regras e bloqueios

- Cadastro de CNPJ entra direto: o cliente é criado na hora e o envio aparece como **Aprovado automaticamente**.
- Cadastro de CPF também entra direto quando o nome informado confere com o nome do CPF. Na fila ele aparece como **Aprovado automaticamente**, com **Nome confere**.
- Cadastro de CPF fica **Pendente** quando o nome não confere (**NOME NÃO CONFERE — verifique antes de aprovar**) ou quando a consulta não pôde ser feita (**Não verificado**). Enquanto estiver pendente, o cliente não existe em Cadastros.
- O nome confere quando é igual ao do CPF, ou quando o primeiro e o último nome são os mesmos e os nomes do meio informados existem no nome completo, na mesma ordem. Apelido e nome social não conferem.
- O cliente que preenche vê sempre a mesma mensagem de recebido, entre direto ou fique pendente. Ele não é avisado se o nome conferiu.
- Documento que já tem cadastro, ativo ou inativo, não cria outro, e nada novo aparece na fila. No CNPJ, o cliente vê **Você já tem cadastro**. No CPF, ele vê a mesma mensagem de recebido de qualquer envio, sem aviso de que já é cliente.
- Quem já tem um envio pendente e envia de novo o mesmo documento não gera um segundo envio.
- Desfazer não apaga: o cliente continua existindo, inativo, o número dele não é reaproveitado, e o endereço e o contato criados permanecem.
- Recusar não cria nem apaga nada: o envio continua na fila, com o motivo.
- Gerar um link novo invalida o anterior na hora. Quem tiver o link antigo vê apenas "link indisponível". Os cadastros que já entraram não mudam.
- Vendedores que dividem o mesmo código de vendedor dividem um link só: trocar o link de um troca o de todos.
- O link funciona quando ao menos uma pessoa daquele código está marcada como vendedora no cadastro de usuário. O nome que o cliente vê na página é o dessa pessoa. Se mais de uma estiver marcada, vale a dona do código e, depois, a ordem alfabética.
- Na página o cliente vê só o primeiro nome do vendedor. No cadastro criado e na fila, o vendedor é gravado com o nome comercial completo (por exemplo "Emily Boeira"), o mesmo das propostas e do ranking.
- Quem é diretor ou administrador e também vende recebe a marca de vendedor sem perder nada: continua vendo todos os pedidos e o Dashboard. A marca só serve para a pessoa aparecer nas listas de vendedores e ter link de cadastro.
- A fila mostra os 200 envios mais recentes.

## O que não confundir

- **Aprovado automaticamente** e **Aprovado**: o primeiro entrou sozinho, sem ninguém decidir; o segundo foi aprovado por um usuário em **Aprovar e criar cliente**.
- **Recusar envio** e **Desfazer cadastro**: recusar vale para o envio pendente, que ainda não virou cliente; desfazer vale para o envio que já criou cliente, e deixa esse cliente inativo.
- **Não verificado** e **NOME NÃO CONFERE**: no primeiro a consulta não respondeu ou o CPF não foi encontrado; no segundo a consulta respondeu um nome diferente do informado.
- **Nome confere** não é a marca de cadastro verificado: o cliente criado pelo link nasce sem essa marca, até um atendente conferir o cadastro.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Nenhum cadastro recebido por link até agora." | Não há envio na situação filtrada, ou nada chegou ainda. | Troque o filtro para **Todos**. |
| "Não foi possível concluir" com "Ja existe o cadastro #N com este documento (...). Recuse o envio ou use o cadastro existente." | Enquanto o envio esperava, o cliente foi cadastrado por outro caminho. | Abra o cadastro #N. Se for a mesma pessoa, recuse o envio. |
| "Não foi possível concluir" com "Este envio ja foi decidido. Recarregue a fila." | Outra pessoa aprovou ou recusou o mesmo envio antes. | Recarregue a tela. |
| "Não foi possível concluir" com "O cliente #N foi criado, mas a fila nao foi atualizada. Nao aprove de novo..." | O cliente foi criado, mas o envio continuou pendente. | Não aprove de novo. Abra o cadastro #N e recuse o envio com o motivo. |
| "Não foi possível concluir" com "Sessão expirada. Entre novamente." | A sessão venceu. | Entre de novo e repita. |
| "Este link **não vai funcionar**..." | Ninguém com aquele código de vendedor está marcado como vendedor, ou a única pessoa marcada está com o acesso pendente. | Peça a um administrador para marcar a pessoa como vendedora antes de enviar o link. |
| "Este código de vendedor é compartilhado." | Mais de uma pessoa usa o mesmo código de vendedor. | Saiba que o link é um só para todas, e que trocá-lo troca o de todas. |
| "Não foi possível copiar" | O navegador bloqueou a cópia. | Selecione o endereço no campo e copie manualmente. |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Geral](proposta-geral.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/cadastros/online/page.tsx`
- `src/features/cadastros/CadastrosOnlineFilaPage.tsx`
- `src/features/cadastros/components/MeuLinkCadastro.tsx`
- `src/features/cadastros/services/cadastros-online.service.ts`
- `src/features/cadastros/services/cadastro-online-cliente.server.ts`
- `src/features/cadastros/services/cpfhub-nome.server.ts`
- `src/app/api/cadastro-online/`
- `src/app/c/[token]/`
