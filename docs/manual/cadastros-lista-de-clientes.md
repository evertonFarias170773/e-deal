# Clientes: lista de cadastros

> **Última revisão:** 06/11/2026
> **Caminho no menu:** Clientes
> **Endereço:** `/cadastros`

## Para que serve

É a lista de todos os cadastros: clientes e transportadoras. Aqui você acha um cliente pelo ID, pelo documento, pelo nome, pelo telefone, pelo WhatsApp ou pelo e-mail, e dali abre, edita ou cria uma proposta para ele.

## Quem acessa

- Qualquer usuário com acesso ao sistema abre a lista.
- **Consultar crédito** aparece só para Administrador e Super Admin.
- **Inativar cadastro** aparece para todos, mas só grava para quem tem permissão de escrita no cadastro; sem ela, aparece um aviso de erro.
- **Inativar** e **Reativar** um contato do cliente: quem pode editar o cadastro (Administrador, Super Admin ou a permissão **Editar Cadastros**).

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Recebidos pelo link** | Topo da tela | Abre a fila dos cadastros que os clientes preencheram pelo link. |
| **+ Novo cliente** | Topo da tela | Abre o formulário de cadastro novo. |
| **Cadastros ativos** | Card no topo | Mostra quantos cadastros ativos existem. |
| **Aniversariantes do dia** | Card no topo (só aparece quando há algum) | Abre a lista dos clientes com data comemorativa hoje. |
| Campo **Buscar por ID do cliente, documento, nome fantasia, nome, telefone, WhatsApp ou e-mail** | Barra de filtros | Busca o cliente. A lista atualiza sozinha depois que você para de digitar. |
| **Tipo** (**Todos**, **Clientes**, **Transportadoras**) | Barra de filtros | Mostra todos os cadastros ou só um tipo. |
| **Mostrar inativos** | Barra de filtros | Inclui na lista os cadastros inativados. |
| **Limpar filtros** | Barra de filtros | Apaga a busca, volta o **Tipo** para **Todos** e desmarca **Mostrar inativos**. |
| **Encontrado por ...** | Abaixo do nome do cliente, na lista | Diz por qual campo o cliente apareceu na busca (veja abaixo). |
| **Acoes** | Coluna **Ações** de cada linha (computador) | Abre o menu da linha. |
| **Ver** | Cartão do cliente (celular) | Abre a ficha do cadastro. |
| **Mais** | Cartão do cliente (celular) | Abre o menu do cartão. |
| **Ver cadastro** | Menu **Acoes** | Abre a ficha do cadastro, só para ver. |
| **Editar cadastro** | Menus **Acoes** e **Mais** | Abre o cadastro para editar. |
| **Criar proposta** | Menus **Acoes** e **Mais** | Abre a Nova proposta já com este cliente. |
| **Consultar crédito** | Menus **Acoes** e **Mais** (só Administrador e Super Admin) | Abre a janela **Conta Corrente** do cliente. |
| **Abrir WhatsApp** | Menus **Acoes** e **Mais** | Ainda não funciona: mostra "Esta ação ainda não está disponível." |
| **Ver financeiro** | Menu **Acoes** | Ainda não funciona: mostra "Esta ação ainda não está disponível." |
| **Inativar cadastro** | Menus **Acoes** e **Mais** | Abre a confirmação **Inativar cadastro**. |
| **Anterior** / **Proxima** | Rodapé da lista | Passa as páginas, de 100 cadastros cada. |
| Lixeira (dica: "Remover contato") | Edição do cadastro, seção **Contatos**, no contato que ainda não foi salvo | Tira o contato do formulário. |
| **Inativar** | Edição do cadastro, seção **Contatos**, no contato já salvo | Passa o contato para o grupo **Inativos**. Grava no **Salvar**. |
| **Inativos (N)** | Edição e ficha do cadastro, seção **Contatos** | Abre e fecha o grupo dos contatos inativados. Começa fechado. |
| **Reativar** | Grupo **Inativos** da edição do cadastro | Devolve o contato à lista de ativos. Grava no **Salvar**. |

Clicar na linha do cliente (fora do menu) abre o cadastro direto para editar.

## Passo a passo

### Buscar um cliente por ID ou documento

1. Digite o número no campo de busca.
2. Se o número for o ID de um cliente, ele aparece em primeiro lugar.
3. Logo abaixo vêm os clientes cujo CPF ou CNPJ contém esse número.
4. O CPF ou CNPJ completo pode ser digitado com pontos, barra e traço.

### Buscar um cliente por nome ou nome fantasia

1. Digite um pedaço do nome, do nome fantasia ou do apelido no campo de busca.
2. Maiúsculas e minúsculas não fazem diferença.
3. A busca por letras também acha pela cidade do cadastro.

### Buscar um cliente por telefone ou WhatsApp

1. Digite só os números, sem parênteses, espaço ou traço. Bastam 4 dígitos.
2. Pode digitar com ou sem o DDD, e com ou sem o 55 na frente.
3. A busca olha o **Telefone**, o **WhatsApp 1** e o **WhatsApp 2** do cadastro, mesmo que o número esteja gravado com parênteses e traço.
4. A lista mostra primeiro o cliente cujo ID é o número digitado, depois os que batem pelo documento e, por último, os que batem pelo telefone ou WhatsApp.
5. Abaixo do nome aparece **Encontrado por**, com o campo e o número que bateram.

### Buscar um cliente por e-mail

1. Digite um pedaço do e-mail no campo de busca (por exemplo, o que vem antes ou depois da @).
2. A busca olha o **E-mail** e o **E-mail de contato** do cadastro.
3. Abaixo do nome aparece **Encontrado por**, com o campo e o e-mail que bateram.

### Entender o "Encontrado por"

1. O rótulo aparece só quando o cliente veio na busca pelo telefone, pelo WhatsApp ou pelo e-mail.
2. Ele diz qual campo bateu: **WhatsApp 1**, **WhatsApp 2**, **Telefone**, **E-mail** ou **E-mail de contato**, seguido do valor gravado.
3. Quando o cliente veio pelo ID, pelo nome ou pelo documento, o rótulo não aparece: o motivo já está à vista na linha.

### Ver só clientes ou só transportadoras

1. No campo **Tipo**, escolha **Clientes** ou **Transportadoras**.
2. Para voltar a ver tudo, escolha **Todos**.
3. O filtro vale junto com a busca: buscar um telefone com **Clientes** escolhido traz só clientes.

### Mostrar cadastros inativos

1. Marque **Mostrar inativos**.
2. Os inativados entram na lista com a etiqueta **Inativo** ao lado do nome.
3. Desmarque para voltar a ver só os ativos. Sem a marcação, a tela avisa **Somente cadastros ativos**.

### Abrir ou editar um cadastro

1. No computador, clique na linha do cliente para abrir o cadastro já em edição.
2. Para só ver, use **Acoes** → **Ver cadastro**.
3. No celular, toque em **Ver** para abrir a ficha, ou em **Mais** → **Editar cadastro**.

### Criar uma proposta para um cliente da lista

1. Ache o cliente.
2. Use **Acoes** (ou **Mais**, no celular) → **Criar proposta**.
3. A Nova proposta abre com o cliente já preenchido. Dá para trocar o cliente lá, se precisar.

### Inativar um cadastro

1. Use **Acoes** (ou **Mais**) → **Inativar cadastro**.
2. Na confirmação **Inativar cadastro**, confira o nome e o ID e clique em **Inativar cadastro**. **Cancelar** fecha sem mudar nada.
3. O cadastro sai da lista de ativos e fica indisponível para novas propostas. Nenhum dado é apagado.

### Inativar ou reativar um contato do cliente

1. Abra o cadastro em edição e vá à seção **Contatos**.
2. No contato que não deve mais ser usado (um repetido ou antigo, por exemplo), clique em **Inativar**. Ele sai da lista e vai para o grupo **Inativos**.
3. Clique em **Salvar**. Só a partir daí o contato deixa de aparecer para escolher.
4. Para trazer de volta, abra **Inativos**, clique em **Reativar** no contato e em **Salvar**.
5. Contato que você acabou de adicionar e ainda não salvou continua com a lixeira: ele sai do formulário sem ser gravado.

## Regras e bloqueios

- A lista abre só com cadastros ativos, os mais recentes primeiro, em páginas de 100.
- Telefone e WhatsApp só são procurados quando você digita só números, a partir de 4 dígitos. Com menos de 4 dígitos, a busca olha só o ID e o documento.
- Número digitado com parênteses, espaço ou traço só é achado se estiver gravado exatamente daquele jeito. Digite só os números.
- A busca olha só os campos do cadastro do cliente. Os telefones e e-mails dos contatos do cliente (as pessoas cadastradas dentro dele) não entram.
- A busca, o **Tipo**, o **Mostrar inativos** e a página ficam no endereço da tela: atualizar a página ou abrir o link copiado mostra a mesma lista.
- Contato já salvo não é apagado: é inativado. O contato inativo não aparece para escolher na proposta nova, na troca de cliente da proposta nem no Maestro, e não recebe os envios automáticos da cobrança (e-mail e WhatsApp).
- Proposta, pedido e nota antigos continuam mostrando o contato que usaram, mesmo inativo. Na edição dessa proposta, ele continua selecionado.
- Contato novo digitado na proposta com o mesmo nome de um contato inativo vira um contato novo e ativo no cadastro.
- O card **Contatos** da ficha do cadastro conta só os ativos.

## O que não confundir

- **Ver cadastro** abre a ficha só para ver; clicar na linha ou **Editar cadastro** abre para editar.
- **Inativar cadastro** não apaga: o cadastro some da lista de ativos e volta a aparecer com **Mostrar inativos**.
- Esta lista e a busca do campo **1. Cliente** da Nova proposta seguem a mesma regra para telefone e WhatsApp, mas são telas diferentes.
- **Total filtrado**, no rodapé, é o total da busca; **Cadastros ativos**, no topo, é o total de ativos, sem filtro.
- **Inativar cadastro** inativa o cliente inteiro; **Inativar**, na seção **Contatos**, inativa só uma pessoa dentro dele.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| **Nenhum cadastro encontrado** | Nada bate com a busca e os filtros. | Confira o **Tipo** e o **Mostrar inativos**, digite o telefone só com números ou clique em **Limpar filtros**. |
| **Não foi possível inativar** com "Sem permissão para inativar este cadastro." | Seu perfil não tem permissão de escrita no cadastro. | Peça a um administrador. |
| "Esta ação ainda não está disponível." | **Abrir WhatsApp** e **Ver financeiro** ainda não funcionam. | Abra o cadastro e use os dados de lá. |

## Veja também

- [Cadastros: Recebidos pelo link](cadastros-recebidos-pelo-link.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Maestro: perguntar ao assistente](maestro.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/cadastros/page.tsx`
- `src/features/cadastros/CadastrosListPage.tsx`
- `src/features/cadastros/components/ConfirmarInativacaoModal.tsx`
- `src/features/cadastros/services/cadastros-read.service.ts`
- `src/features/cadastros/lib/busca-cliente-por-digitos.ts`
- `src/features/cadastros/lib/contatos-ativos.ts`
- `src/features/cadastros/CadastroFormPage.tsx`
- `src/features/cadastros/CadastroDetailPage.tsx`
