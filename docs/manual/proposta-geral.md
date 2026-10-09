# Proposta: aba Geral

> **Última revisão:** 02/10/2026
> **Caminho no menu:** Pedidos → abrir um pedido → aba **Geral**
> **Endereço:** `/orcamentos/<número>/editar` (em proposta nova, `/orcamentos/novo`)

## Para que serve

É onde você diz para quem é a proposta: o cliente, o vendedor, a empresa que vende, o contato que recebe o orçamento, quem paga e sai na nota fiscal, e onde o pedido será entregue. O endereço escolhido aqui é o que o frete usa para cotar.

## Quem acessa

- Quem abre a proposta vê e preenche a aba Geral.
- O campo **Vendedor** só é editável para administrador, gerente ou perfil com a permissão de alterar o vendedor responsável. Para os demais ele aparece cinza, com o vendedor do cadastro do cliente.
- O **Desconto geral**, no bloco **8. Resumo do orçamento**, só é editável para administrador, gerente ou perfil com a permissão de desconto geral.
- Em proposta com cobrança, o botão **+ Adicionar novo sócio** fica travado para quem não tem a permissão de editar proposta paga.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia. Cabeçalho, barra de abas e rodapé estão em [Proposta: visão geral e abas](proposta.md).

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Geral** | Barra de abas | Abre esta aba. |
| **Cliente cadastrado** | Bloco **1. Cliente**, só em proposta nova | Faz a proposta para um cliente do cadastro. |
| **Cliente não cadastrado / orçamento rápido** | Bloco **1. Cliente**, só em proposta nova | Faz a proposta só com nome e CEP, sem cadastro. |
| Campo "Buscar por ID, nome, apelido ou documento do cliente..." | Bloco **1. Cliente** | Procura o cliente; clicar numa linha do resultado escolhe o cliente. |
| Botão **X** (sem dica) | Dentro do campo de busca, com cliente escolhido | Limpa o cliente, o contato, o endereço, o pagador, o vendedor e a empresa. |
| **Vincular cliente cadastrado** | Bloco **1. Cliente**, em orçamento rápido já salvo | Começa a troca do cliente manual por um cadastrado. |
| **Cancelar vinculação** | Bloco **1. Cliente**, durante a vinculação | Desfaz a troca e volta ao que era. |
| **Empresa** (lista: **Ideal**, **Biro**, **E3**) | Bloco **2. Dados da proposta** | Define a empresa que vende. |
| **Vendedor** (lista; primeira opção "Selecione o vendedor") | Bloco **2. Dados da proposta** | Define o vendedor, para quem pode alterar. |
| Linha de **Outros contatos** | Bloco **3. Contato responsável** | Troca o contato selecionado. |
| **+ Adicionar novo contato** | Bloco **3. Contato responsável** | Abre a janela **Adicionar novo contato**. |
| **Adicionar** | Janela **Adicionar novo contato** | Inclui o contato e já o seleciona. |
| Botão de lápis (dica: "Editar") | No contato e no endereço, selecionado ou da lista | Abre a edição do contato ou do endereço. |
| **Salvar** | Janela **Editar contato (Modo Local)** | Aplica a correção do contato na tela. |
| Linha de **Outras opções de pagador** | Bloco **4. Dados para nota fiscal** | Troca o pagador. Em proposta com número, grava na hora. |
| **Copiar dados** | Painel do pagador selecionado | Copia os dados fiscais do pagador. |
| **Abrir cadastro** | Painel do pagador selecionado | Abre o cadastro do pagador em outra aba. |
| **+ Adicionar novo sócio** | Bloco **4. Dados para nota fiscal** | Abre a busca de sócio por CPF ou CNPJ. |
| **Buscar** | Busca de sócio | Procura o documento digitado. |
| **Selecionar como pagador** | Resultado "já é vínculo deste cliente" | Usa o sócio como pagador. |
| **Vincular e usar como pagador** | Resultado "cadastro existente, ainda sem vínculo" | Cria o vínculo e usa o sócio como pagador. |
| **Confirmar e usar como pagador** | Resultado "Sem cadastro — dados da Receita" | Cria o cadastro, o endereço principal e o vínculo, e usa como pagador. |
| Linha de **Outras opções de entrega** | Bloco **5. Endereço de entrega** | Troca o endereço de entrega. |
| Botão de copiar (dica: "Copiar endereço") | No endereço, selecionado ou da lista | Copia o endereço completo. |
| **+ Adicionar novo endereço** / **Salvar endereço** | Bloco **5. Endereço de entrega** | Em proposta nova, abre um endereço em branco. Em proposta existente com endereço escolhido, o nome é **Salvar endereço** e abre o endereço selecionado. Se ele é de entrega, você edita; se é o principal do cliente, o que você alterar vira um endereço de entrega novo. |
| **Validar** | Janela de endereço, ao lado de **CPF / CNPJ do Recebedor** | Consulta o documento e preenche os dados do recebedor. |
| **Adicionar** / **Salvar** | Janela **Adicionar novo endereço** / **Editar endereço** | Grava o endereço na hora. Sobre o endereço principal, **Salvar** cria um endereço de entrega e deixa o principal como está. |
| **Confirmar** | Janela **Atenção** (endereço diferente do da nota) | Confirma o endereço de entrega escolhido. |
| **Ciente, continuar** | Janela **Atenção à Carteira** | Mantém o cliente escolhido, de outra carteira. |
| **Cancelar** | Todas as janelas acima e a busca de sócio | Fecha sem aplicar. Em **Atenção à Carteira**, limpa o cliente escolhido. |
| Botão **X** (dica: "Limpar pesquisa") | Campo de pesquisa das listas com mais de quatro opções | Limpa a pesquisa. |
| **Tipo** (**%** ou **R$**) e **Desconto geral** | Bloco **8. Resumo do orçamento** | Aplicam desconto sobre o subtotal dos produtos. |
| **Copiar resumo para WhatsApp** | Bloco **9. Envio do orçamento** | Copia o texto informal da proposta. |

## Passo a passo

### Escolher o cliente (bloco 1. Cliente)

1. Em proposta nova, escolha entre **Cliente cadastrado** e **Cliente não cadastrado / orçamento rápido**.
2. Para cliente cadastrado, digite no campo de busca o código, o nome, o apelido ou o documento. A busca começa com dois caracteres.
3. Clique no cliente na lista. Cada linha mostra o código, o nome, o documento, a cidade e o vendedor do cadastro.
4. O sistema preenche sozinho o primeiro contato, o endereço de entrega (o do tipo entrega; se não houver, o principal), o vendedor padrão e a empresa padrão do cliente. Confira cada um nos blocos seguintes.
5. Abaixo da busca aparecem três quadros: **Cliente**, **Limite Faturado / Risco** e **Tabela especial**. Este último mostra o percentual da tabela especial do cliente, escrito na tela como "+N% applied nos produtos", ou "Sem acréscimo especial".
6. Para trocar o cliente, clique no **X** do campo de busca e escolha outro.

Quando a proposta é aberta a partir do cadastro do cliente (**Criar proposta**), o cliente já vem escolhido.

Enquanto o cliente não é escolhido numa proposta nova, os outros blocos e abas não aparecem.

### Fazer um orçamento rápido, sem cadastro

1. Marque **Cliente não cadastrado / orçamento rápido**.
2. Preencha **Nome livre do cliente / empresa** e **CEP de entrega**.
3. **Cidade** e **Estado (UF)** são preenchidos pelo CEP. Se o CEP não for encontrado, preencha à mão.
4. O vendedor é você: o campo fica travado com a nota "Orçamento rápido: você é o vendedor responsável."
5. Os blocos de contato, dados para nota fiscal e endereço não aparecem no orçamento rápido.

### Vincular um cliente cadastrado a um orçamento rápido

1. Abra a proposta do orçamento rápido. No bloco **1. Cliente** aparece **Tipo de orçamento: Cliente não cadastrado / Orçamento rápido**.
2. Clique em **Vincular cliente cadastrado**.
3. Busque e escolha o cliente. Preços e frete são recalculados pelo cadastro escolhido.
4. Confira contato, endereço e frete e salve. A troca fica registrada no Histórico.
5. Para desistir antes de salvar, clique em **Cancelar vinculação**: a tela volta ao que era.

### Conferir os dados da proposta (bloco 2. Dados da proposta)

1. **id_int** é o número da proposta. Ele é gerado ao salvar e não pode ser digitado.
2. **Empresa** é a empresa que vende: **Ideal**, **Biro** ou **E3**. Vem do cadastro do cliente e pode ser trocada.
3. **Vendedor**: escolha na lista, se o seu perfil permite. Se o cliente não tem vendedor padrão, a tela avisa **Vendedor não vinculado** e o campo precisa ser preenchido.
4. **Status** mostra o status atual. Ele é definido pelo sistema.

### Escolher ou incluir o contato (bloco 3. Contato responsável)

1. O contato selecionado aparece no painel de cima, com cargo, WhatsApp e e-mail. Os demais ficam em **Outros contatos**.
2. Para trocar, clique em outro contato da lista. Com mais de quatro contatos, a lista ganha um campo de pesquisa.
3. Para incluir, clique em **+ Adicionar novo contato**, preencha **Nome** e **WhatsApp** (obrigatórios), **Cargo** e **E-mail**, e clique em **Adicionar**.
4. Para corrigir um contato, clique no lápis ao lado dele, altere na janela **Editar contato (Modo Local)** e clique em **Salvar**.
5. Salve a proposta para o contato escolhido valer.

O nome do contato é o que aparece na proposta enviada ao cliente.

### Definir quem paga e sai na nota (bloco 4. Dados para nota fiscal)

1. O painel **Pagador selecionado** começa com o próprio cliente (**Cadastro principal**). Ele mostra CNPJ ou CPF, inscrição estadual, contribuinte, e-mail e o endereço fiscal do pagador.
2. Para faturar em nome de um sócio ou vínculo comercial, clique nele em **Outras opções de pagador**. Em proposta que já tem número, a troca grava na hora.
3. Para voltar ao próprio cliente, clique na linha **Cadastro principal** em **Outras opções de pagador**.
4. **Copiar dados** copia os dados fiscais do pagador. **Abrir cadastro** abre o cadastro dele em outra aba.
5. Trocar o pagador não troca o endereço de entrega. Se o endereço que estava escolhido deixar de existir na lista, a seleção fica vazia e você escolhe outro no bloco 5.

### Incluir um sócio como pagador

1. No bloco 4, clique em **+ Adicionar novo sócio**.
2. Digite o **CPF ou CNPJ do sócio** e clique em **Buscar**.
3. Conforme o resultado:
   - "já é vínculo deste cliente": clique em **Selecionar como pagador**.
   - "cadastro existente, ainda sem vínculo": clique em **Vincular e usar como pagador**.
   - "Sem cadastro — dados da Receita" (CNPJ): confira o nome e clique em **Confirmar e usar como pagador**. O sistema cria o cadastro, o endereço principal e o vínculo.
   - "CPF sem cadastro": cadastre a pessoa na tela de Clientes e volte para vinculá-la pelo documento.
4. O sócio vira o pagador e o endereço principal dele fica pré-selecionado para entrega. Troque no bloco 5 se a entrega for em outro lugar.

### Escolher o endereço de entrega (bloco 5. Endereço de entrega)

1. O endereço selecionado aparece no painel de cima, com recebedor, CPF do recebedor, tipo, endereço, complemento, bairro, cidade, CEP e referência.
2. Para trocar, clique em outro endereço em **Outras opções de entrega**. Quando o pagador é um sócio, os endereços dele aparecem com o selo **Endereço de sócio** ou **Endereço de vínculo comercial**.
3. Com pagador diferente do cliente, ao escolher um endereço que não é o principal do pagador a tela pergunta: "Endereço de ENTREGA não corresponde ao endereço constante na Nota Fiscal". Clique em **Confirmar** para seguir. O endereço precisa ter o CPF do recebedor.
4. Se a cidade da entrega for diferente da cidade do endereço principal do pagador, o endereço ganha o selo **REQUER NOTA DE TRANSPORTE**.
5. O ícone de copiar leva o endereço completo para a área de transferência. O lápis abre a edição.
6. Trocar o endereço muda o destino do frete. As cotações são refeitas e a escolha anterior de frete é descartada.

O destino escolhido aparece também no topo do bloco **8. Resumo do orçamento**, em **Entrega em**.

### Incluir ou corrigir um endereço

1. Em proposta nova, clique em **+ Adicionar novo endereço**. Em proposta existente, o botão se chama **Salvar endereço** e abre o endereço selecionado para edição; para editar outro, use o lápis dele.
2. Informe o **CPF / CNPJ do Recebedor** e clique em **Validar** para preencher os dados pelo documento. Com CNPJ, o endereço da Receita substitui o que estava digitado.
3. Preencha **Nome / Razão Social do Recebedor**, **CEP**, **Tipo**, **Logradouro**, **Número**, **Complemento**, **Bairro**, **Cidade** e **UF**. Ao mudar o CEP, logradouro, bairro, cidade e UF são preenchidos sozinhos.
4. Clique em **Adicionar** (endereço novo) ou **Salvar** (edição). O endereço grava na hora no cadastro do cliente.
5. O endereço novo já fica selecionado como entrega.
6. **Entrega em lugar diferente do endereço principal:** abra o principal pelo **Salvar endereço** ou pelo lápis, digite o endereço da entrega e clique em **Salvar**. O sistema cria um endereço de entrega novo e passa o pedido para ele. O endereço principal não muda: ele é o que sai na nota fiscal e só se altera no cadastro do cliente. A janela avisa isso em azul antes de você salvar.
7. Se o cliente já tem um endereço de entrega igual ao digitado (mesmo CEP, rua, número e complemento), o sistema usa esse em vez de criar outro. Se você não mudou nada, nada é gravado.

### Usar os blocos da coluna da direita

1. **8. Resumo do orçamento** mostra **Entrega em**, **Subtotal bruto**, o abatimento da tabela especial, **Subtotal produtos**, **Desconto geral**, **Frete escolhido**, **Peso total** e **Total final**.
2. Para dar desconto na proposta inteira, escolha o **Tipo** (**%** ou **R$**) e digite o valor em **Desconto geral**. O desconto nunca passa do subtotal dos produtos.
3. **9. Envio do orçamento** traz o texto informal da proposta. Clique em **Copiar resumo para WhatsApp**. O botão só libera depois que um frete foi escolhido.
4. **10. Observações e Condições** é o texto comercial da proposta. Ele não chega à produção: a instrução para a bancada fica na aba Produção.

### Proposta avulsa x proposta com produtos

A escolha entre proposta avulsa e proposta com produtos do catálogo não fica na aba Geral. Ela é feita na aba **Orçamento**, na caixa **Proposta avulsa (orçamento sem produtos cadastrados)**. Veja [Proposta: aba Orçamento (produtos)](proposta-produtos.md).

## Regras e bloqueios

- Não dá para salvar proposta de cliente cadastrado sem cliente, contato e endereço de entrega selecionados.
- Não dá para salvar orçamento rápido sem o nome do cliente e sem o CEP.
- Não dá para salvar sem vendedor e sem empresa.
- Quem não pode alterar o vendedor não consegue salvar com vendedor diferente do cadastro do cliente.
- Vendedor que escolhe cliente da carteira de outro vendedor vê o aviso **Atenção à Carteira**. Dá para continuar em **Ciente, continuar**; fechar o aviso limpa o cliente escolhido.
- O sistema nunca escolhe o endereço de entrega no seu lugar depois da primeira seleção. Se o endereço escolhido sair da lista, o campo fica vazio até você escolher outro.
- O modal de endereço não cria endereço do tipo Principal. O tipo de um endereço principal só muda na tela de Clientes.
- A proposta nunca altera o endereço principal do cliente, nem o único endereço que ele tem. Entrega diferente cria um endereço de entrega novo; o principal só muda no cadastro do cliente.
- O complemento do endereço tem limite de 60 caracteres, o mesmo da nota fiscal.
- Editar um endereço de entrega usado por outros pedidos em aberto muda também as etiquetas deles. A tela avisa quantos são.
- Não dá para vincular cliente cadastrado a um orçamento rápido que tenha cobrança ativa ou pagamento confirmado. Cancele as cobranças antes.
- No pedido complementar, contato, pagador e endereço ficam travados com o aviso **Herdado do pedido #<número>**. Um endereço novo cadastrado ali vai para o cadastro do cliente, mas a entrega continua sendo a do pedido principal.
- Com cobrança ativa e sem a permissão de editar proposta paga, alterações de vendedor, empresa, contato e endereço não são gravadas: o salvamento guarda só as observações e a orientação técnica.

## O que não confundir

- Cliente x pagador x recebedor: o cliente (bloco 1) é de quem é a proposta; o pagador (bloco 4) é quem sai na nota fiscal; o recebedor é a pessoa ou empresa do endereço de entrega (bloco 5).
- Contato responsável x recebedor: o contato recebe o orçamento e aparece na proposta enviada; o recebedor é quem recebe a mercadoria.
- Endereço de entrega x endereço fiscal: o de entrega é o escolhido no bloco 5 e é o destino do frete; o fiscal é o endereço principal do pagador, mostrado no bloco 4, e não se escolhe aqui.
- **Cliente não cadastrado / orçamento rápido** x **Proposta avulsa**: o orçamento rápido é proposta sem cliente no cadastro; a avulsa é proposta sem produtos do catálogo, marcada na aba Orçamento. Uma coisa não depende da outra.
- **Salvar endereço** x **Salvar alterações**: **Salvar endereço** só abre a janela do endereço selecionado; quem salva a proposta é **Salvar alterações**, no rodapé.
- **Salvar** da janela de endereço x **Salvar** da janela de contato: o endereço grava na hora no cadastro do cliente; o contato corrigido fica na tela ("Modo Local") e o nome dele só vai para a proposta ao salvar.
- Trocar o pagador x trocar o endereço: trocar o pagador muda a lista de endereços disponíveis, mas não escolhe o endereço de entrega por você.
- Vendedor da proposta x vendedor do cadastro: o campo **Vendedor** nasce com o vendedor padrão do cliente; só quem tem permissão grava um vendedor diferente.
- **Empresa** x cliente: **Empresa** é quem vende (Ideal, Biro ou E3), não a empresa do cliente.
- Quadro **Tabela especial** x **Desconto geral**: a tabela especial vem do cadastro do cliente e entra sozinha em cada item; o desconto geral é digitado na proposta e exige permissão.
- **Limite Faturado / Risco** x **Saldo na Conta Corrente**: o primeiro mostra o limite e o risco que estão no cadastro do cliente; o segundo é crédito que o cliente já tem a usar e aparece em aviso verde no topo da tela.
- Selo **Endereço de sócio** x selo **REQUER NOTA DE TRANSPORTE**: o primeiro só diz de quem é o endereço; o segundo avisa que a entrega é em cidade diferente da do endereço principal do pagador.
- **Observações e Condições** x orientação técnica da aba Produção: a primeira é comercial e não chega à produção.
- **id_int** x código do cliente: **id_int** é o número da proposta; o código do cliente é o número que aparece com `#` ao lado do nome dele.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| **Cliente obrigatório** — "Selecione um cliente para a proposta." | Nenhum cliente escolhido. | Busque e selecione o cliente. |
| **Nome do cliente obrigatório** | Orçamento rápido sem nome. | Preencha **Nome livre do cliente / empresa**. |
| **CEP obrigatório** | Orçamento rápido sem CEP. | Preencha o **CEP de entrega**. |
| **CEP não encontrado** | O CEP digitado não existe na consulta. | Confira o número ou preencha cidade e UF à mão. |
| **Contato obrigatório** | Nenhum contato selecionado. | Selecione um contato ou adicione um novo. |
| **Nome obrigatório** / **WhatsApp obrigatório** | Contato novo sem nome ou sem WhatsApp. | Preencha os dois campos. |
| **Endereço obrigatório** | Nenhum endereço de entrega selecionado. | Selecione um endereço no bloco 5. |
| **Endereço incompleto** — "Preencha CEP, logradouro, número, cidade e UF." | Faltou campo na janela de endereço. | Complete os campos pedidos. |
| **Cliente obrigatório** — "Selecione o cliente da proposta antes de adicionar um novo endereço." | Tentativa de criar endereço sem cliente. | Escolha o cliente primeiro. |
| "O endereço principal é o fiscal e só se altera no cadastro do cliente." | A proposta tentou alterar o endereço principal. | Para entrega em outro lugar, salve o endereço digitado: ele vira um endereço de entrega. Para corrigir o principal, abra o cadastro do cliente. |
| **Ação bloqueada** — "Não posso selecionar este endereço. Precisa incluir CPF do RECEBEDOR." | Endereço diferente do principal do pagador, sem CPF do recebedor. | Edite o endereço pelo lápis e informe o documento do recebedor. |
| **Vendedor não vinculado** | O cliente não tem vendedor padrão no cadastro. | Selecione o vendedor ou peça para quem pode alterar. |
| **Vendedor obrigatório** | Proposta sem vendedor. | Selecione o vendedor antes de salvar. |
| **Vendedor não autorizado** | Seu perfil não pode trocar o vendedor herdado do cliente. | Mantenha o vendedor do cadastro ou peça a troca a um gerente. |
| **Empresa obrigatória** | Campo Empresa vazio. | Escolha a empresa. |
| **Desconto geral não autorizado** | Há desconto geral e seu perfil não pode aplicá-lo. | Zere o desconto ou peça a um gerente ou administrador. |
| **Pagador sem endereço** | O pagador escolhido não tem endereço cadastrado. | Escolha o endereço de entrega no bloco 5 ou cadastre um endereço para o pagador. |
| **Falha ao salvar pagador** | A troca do pagador não foi gravada. | Tente de novo. Se continuar, avise o administrador. |
| **Documento inválido** | CPF ou CNPJ do sócio com dígitos errados. | Confira os dígitos. Nenhuma consulta foi feita. |
| **Vinculação bloqueada** | Orçamento rápido com cobrança ativa ou pagamento confirmado. | Cancele as cobranças antes de vincular o cliente cadastrado. |
| **Cadastro não encontrado** | A proposta foi aberta a partir de um cadastro que não carregou. | Selecione o cliente manualmente. |
| "Nenhum endereço escolhido — sem ele não há para onde cotar o frete." | Aviso do Resumo: falta o endereço de entrega. | Selecione o endereço no bloco 5. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Orçamento (produtos)](proposta-produtos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Pedidos (lista)](pedidos.md)
- [Notas fiscais](notas-fiscais.md)
- [Expedição](expedicao.md)

## Arquivos de origem

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/orcamentos/components/SocioPagadorInline.tsx`
- `src/features/orcamentos/components/ContactEditModal.tsx`
- `src/features/cadastros/components/DocumentoRecebedorFields.tsx`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/orcamentos/lib/endereco-entrega-proposta.ts`
- `src/features/orcamentos/orcamento-utils.ts`
- `src/lib/mocks/empresas.mock.ts`
- `src/features/cadastros/CadastroDetailPage.tsx`
