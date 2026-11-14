# Proposta: aba Geral

> **Última revisão:** 14/11/2026 (bloco 3 vira **Contatos do pedido**: uma ou mais conversas do ChatGuru, uma principal que é o Comprador; sai a lista de contatos do cadastro; contato exigido no Enviar para arte e na Liberação para produção. Antes, 11/11/2026: endereço com a rua gravada como "[object Object]" aparece como **Rua com erro no cadastro (corrija pelo lápis)** e abre com a rua em branco. Antes, no mesmo dia: campo **Observação para a nota fiscal** no fim do bloco 4, que sai impresso na NF-e e na NFS-e; o bloco 10 continua interno. Antes, no mesmo dia: bloco **Conversa do WhatsApp** no Contato responsável: escolhe a conversa do ChatGuru, a mesma do Comprador da aba Artes)
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
| Campo "Buscar por ID, nome, apelido, documento, telefone, WhatsApp ou e-mail do cliente..." | Bloco **1. Cliente** | Procura o cliente; clicar numa linha do resultado escolhe o cliente. |
| Botão **X** (sem dica) | Dentro do campo de busca, com cliente escolhido | Limpa o cliente, o contato, o endereço, o pagador, o vendedor e a empresa. |
| **Vincular cliente cadastrado** | Bloco **1. Cliente**, em orçamento rápido já salvo | Começa a troca do cliente manual por um cadastrado. |
| **Cancelar vinculação** | Bloco **1. Cliente**, durante a vinculação | Desfaz a troca e volta ao que era. |
| **Empresa** (lista: **Ideal**, **Biro**, **E3**) | Bloco **2. Dados da proposta** | Define a empresa que vende. |
| **Vendedor** (lista; primeira opção "Selecione o vendedor") | Bloco **2. Dados da proposta** | Define o vendedor, para quem pode alterar. |
| Caixa ao lado da conversa | Bloco **3. Contatos do pedido**, lista **Conversas do WhatsApp** | Marca ou desmarca a conversa como contato do pedido. Proposta salva: grava na hora. |
| **Tornar principal** | Na conversa marcada que não é a principal | Torna a conversa a **Principal · Comprador**, que recebe a arte e os avisos. É a mesma escolha do **Comprador** da aba Artes. |
| Selo **Principal · Comprador** | Na conversa principal | Mostra qual conversa é a principal. |
| Botão de lápis (dica: "Editar") | No endereço, selecionado ou da lista | Abre a edição do endereço. |
| Linha de **Outras opções de pagador** | Bloco **4. Dados para nota fiscal** | Troca o pagador. Em proposta com número, grava na hora. |
| **Copiar dados** | Painel do pagador selecionado | Copia os dados fiscais do pagador. |
| **Abrir cadastro** | Painel do pagador selecionado | Abre o cadastro do pagador em outra aba. |
| **+ Adicionar novo sócio** | Bloco **4. Dados para nota fiscal** | Abre a busca de sócio por CPF ou CNPJ. |
| Campo **Observação para a nota fiscal** | Bloco **4. Dados para nota fiscal**, no fim | Texto que sai impresso nas Informações Complementares da NF-e e da NFS-e do pedido. É o mesmo campo da aba **Produção / Expedição / Notas**. |
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
2. Para cliente cadastrado, digite no campo de busca o código, o nome, o apelido, o documento, o telefone, o WhatsApp ou o e-mail. A busca começa com dois caracteres. Só números, a partir de quatro, acham o código exato (sempre em primeiro), o documento e trechos de telefone fixo, WhatsApp 1 e WhatsApp 2, com ou sem pontuação no cadastro e sem precisar do 55. Quando o cliente aparece pelo telefone, WhatsApp ou e-mail, a linha mostra qual deles bateu, como "Encontrado por WhatsApp 2: ...".
3. Clique no cliente na lista. Cada linha mostra o código, o nome, o documento, a cidade e o vendedor do cadastro.
4. O sistema preenche sozinho o endereço de entrega (o do tipo entrega; se não houver, o principal), o vendedor padrão e a empresa padrão do cliente. Confira cada um nos blocos seguintes e marque os contatos do pedido no bloco 3.
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

### Escolher os contatos do pedido (bloco 3. Contatos do pedido)

Desde 14/11/2026 os contatos do pedido são conversas do cliente no WhatsApp da Ideal (ChatGuru), e não mais a lista de contatos do cadastro. O bloco **Conversas do WhatsApp**, com o selo "WhatsApp · ChatGuru", lista as conversas do cliente: as que têm o código do cliente no nome, abertas pelo atendimento, com o nome da conversa e o número.

1. Marque a caixa de uma ou mais conversas. Cada conversa marcada é um contato do pedido.
2. Uma delas é a **Principal · Comprador**: recebe a arte e os avisos do pedido e é o **Comprador** da aba Artes. A primeira marcada vira a principal. Para trocar, clique em **Tornar principal** em outra conversa marcada.
3. Desmarcar a principal passa a principal para a próxima marcada. Deixe pelo menos uma marcada.
4. Proposta já salva: cada clique grava na hora. Proposta nova, ou cliente trocado e ainda não salvo: a escolha fica marcada e é gravada no **Salvar**, junto com a proposta ("A escolha é gravada ao salvar a proposta."). Se a proposta salvar e a escolha não, aparece o aviso "Proposta salva, mas a conversa do WhatsApp não foi gravada"; marque de novo.
5. Com uma conversa só, ela já vem marcada como principal e é gravada no próximo **Salvar**.
6. Sem conversa, aparece **Cadastre a conversa no ChatGuru.** com a orientação: peça ao atendimento para abrir a conversa com o código do cliente no nome e depois reabra a proposta.

O que a escolha faz:

- **Salvar** não é barrado sem conversa. A exigência fica no primeiro **Enviar para arte** (aba Artes) e na **Liberação para produção**, inclusive a automática de prateleira, que deixa o pedido em REVISAO ATENDENTE e avisa no chat.
- A Expedição mostra as conversas marcadas no despacho e não oferece a lista de conversas de novo. O aviso de pedido pronto vai para a principal.
- O nome da principal é o que aparece na proposta enviada ao cliente ("Orçamento para:").
- O pedido também pode guardar um contato do cadastro. Ao gravar a principal, se o pedido não tem um contato ativo do cliente, ele passa a usar o contato do cliente com o mesmo telefone da principal; se não houver nenhum, o pedido fica sem contato do cadastro e os avisos do ChatGuru vão para a principal. A aba Geral nunca cria contato no cadastro de contatos. Um contato ativo que o pedido já tem fica.
- E-mail e telefone da cobrança não vêm mais do contato: veja a ficha de Pagamentos.

Pedido antigo sem conversa escolhida continua como estava. Abaixo do bloco aparece "Contato anterior (cadastro)" com o nome e o WhatsApp do contato que ele já tinha, só para leitura. Os contatos do cadastro continuam existindo e se editam no cadastro do cliente.

### Definir quem paga e sai na nota (bloco 4. Dados para nota fiscal)

1. O painel **Pagador selecionado** começa com o próprio cliente (**Cadastro principal**). Ele mostra CNPJ ou CPF, inscrição estadual, contribuinte, e-mail e o endereço fiscal do pagador.
2. Para faturar em nome de um sócio ou vínculo comercial, clique nele em **Outras opções de pagador**. Em proposta que já tem número, a troca grava na hora.
3. Para voltar ao próprio cliente, clique na linha **Cadastro principal** em **Outras opções de pagador**.
4. **Copiar dados** copia os dados fiscais do pagador. **Abrir cadastro** abre o cadastro dele em outra aba.
5. Trocar o pagador não troca o endereço de entrega. Se o endereço que estava escolhido deixar de existir na lista, a seleção fica vazia e você escolhe outro no bloco 5.

### Escrever o que sai impresso na nota (Observação para a nota fiscal)

Use quando a nota precisa levar um texto do pedido, por exemplo o nome do projeto e o número de captação da Lei Rouanet ("Projeto Festival de Inverno - PRONAC 123456").

1. No fim do bloco **4. Dados para nota fiscal**, escreva o texto em **Observação para a nota fiscal**.
2. Clique em **Salvar alterações**. O campo grava também quando a proposta tem cobrança ativa (salvamento parcial).
3. O mesmo campo aparece na aba **Produção / Expedição / Notas**, no quadro **Notas fiscais**. Editar num lugar muda o outro: é um texto só por pedido.
4. Embaixo do campo, a tela mostra quantos caracteres o texto ocupa em cada nota: **NF-e** até 5.000 (contando o "Pedido N" que já sai) e **NFS-e** até 2.000. Passou, a linha fica vermelha.

O que acontece depois:

- **NF-e:** o rascunho criado pelo **Faturar** nasce com "Pedido N" e, na linha de baixo, a observação, nas **Informações Complementares (Impresso na DANFE)**. O faturamento revisa antes de emitir. Rascunho que já existia antes de você escrever não muda sozinho: a tela da nota mostra o texto e o botão **Incluir nas Informações Complementares**.
- **NFS-e:** a janela **NFS-e · Pedido** abre com a observação nas **Informações complementares**, para revisar antes de criar o rascunho.
- **Fila de faturamento:** o pedido ganha o selo roxo **Obs. para a NF**.
- Nota já emitida não muda.

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

1. O endereço selecionado e cada opção de **Outras opções de entrega** aparecem no mesmo cartão, todos com os mesmos campos: **Endereço** (rua e número), **Complemento**, **Bairro**, **Cidade / UF**, **CEP** e **Tipo**, mais **Recebedor**, **CPF do recebedor**, **IE do recebedor** e **Referência** quando o endereço tem. Campo vazio aparece como "—"; o **Tipo** vazio aparece como "Tipo não informado". O selecionado vem em destaque, com fundo escuro e texto claro; a única diferença entre os cartões é essa.
2. Para trocar, clique no cartão de outro endereço em **Outras opções de entrega**. Quando o pagador é um sócio, os endereços dele aparecem com o selo **Endereço de sócio** ou **Endereço de vínculo comercial**.
3. Com pagador diferente do cliente, ao escolher um endereço que não é o principal do pagador a tela pergunta: "Endereço de ENTREGA não corresponde ao endereço constante na Nota Fiscal". Clique em **Confirmar** para seguir. O endereço precisa ter o CPF do recebedor.
4. Se a cidade da entrega for diferente da cidade do endereço principal do pagador, o endereço ganha o selo **REQUER NOTA DE TRANSPORTE**. Os selos ficam numa linha própria, logo abaixo do título do cartão, um por linha quando o espaço é curto (na lateral da aba Fretes e no celular) e lado a lado quando cabem (na aba Geral). Ninguém muda de cor nem de texto: só o formato, em retângulo arredondado, com a mesma altura e a mesma fonte.
5. O ícone de copiar leva o endereço completo para a área de transferência. O lápis, que existe no cartão selecionado e em cada opção, abre a edição.
   Endereço com a rua gravada errada no cadastro ("[object Object]") aparece como **Rua com erro no cadastro (corrija pelo lápis)**. O lápis abre a edição com a rua em branco: digite a rua e salve. Bairro, complemento ou cidade com o mesmo erro aparecem vazios (—).
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

Aqui na aba Geral aparecem os blocos 8, 9 e 10. As outras abas mostram só alguns deles (o quadro completo está em [Proposta](proposta.md)). O bloco 5, **Endereço de entrega**, fica no corpo desta aba e também aparece na lateral da aba Fretes, como o mesmo bloco.

1. **8. Resumo do orçamento** mostra **Entrega em**, **Subtotal bruto**, o abatimento da tabela especial, **Subtotal produtos**, **Desconto geral**, **Frete escolhido**, **Peso total** e **Total final**. O total é calculado em centavos exatos, com a mesma conta da trava de despacho da Expedição e da Conta Corrente: cada item é arredondado ao centavo, o desconto da tabela especial sai da soma dos itens, e o total é arredondado ao centavo (meio centavo para cima). O desconto da tabela especial mostrado é o subtotal bruto menos o total, então o resumo sempre fecha. Exemplo: subtotal bruto R$ 1.006,95 com 10% dá total R$ 906,26 e desconto R$ 100,69.
2. Para dar desconto na proposta inteira, escolha o **Tipo** (**%** ou **R$**) e digite o valor em **Desconto geral**. O desconto nunca passa do subtotal dos produtos.
3. **9. Envio do orçamento** traz o texto informal da proposta. Clique em **Copiar resumo para WhatsApp**. O botão só libera depois que um frete foi escolhido.
4. **10. Observações e Condições** é o texto comercial da proposta. Ele é interno: não chega à produção (a instrução para a bancada fica na aba Produção / Expedição / Notas) e **não vai para a nota fiscal**. O que precisa sair na nota vai em **Observação para a nota fiscal**, no bloco 4. Quem fatura vê o bloco 10 sem abrir a proposta: na Fila de faturamento e nas janelas das notas, o pedido com texto aqui ganha o selo âmbar **Obs. interna**.

### Proposta avulsa x proposta com produtos

A escolha entre proposta avulsa e proposta com produtos do catálogo não fica na aba Geral. Ela é feita na aba **Orçamento**, na caixa **Proposta avulsa (orçamento sem produtos cadastrados)**. Veja [Proposta: aba Orçamento (produtos)](proposta-produtos.md).

## Regras e bloqueios

- Não dá para salvar proposta de cliente cadastrado sem cliente e endereço de entrega selecionados. O contato do pedido (conversa do ChatGuru) não barra o Salvar; ele é exigido no primeiro **Enviar para arte** e na **Liberação para produção**.
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
- No pedido complementar, os contatos do pedido, o pagador e o endereço ficam travados com o aviso **Herdado do pedido #<número>**. Um endereço novo cadastrado ali vai para o cadastro do cliente, mas a entrega continua sendo a do pedido principal.
- Com cobrança ativa e sem a permissão de editar proposta paga, alterações de vendedor, empresa, contato e endereço não são gravadas: o salvamento guarda só as observações (inclusive a **Observação para a nota fiscal**), a orientação técnica e as instruções de entrega.
- A **Observação para a nota fiscal** não é copiada quando a proposta é duplicada ou vira pedido complementar.

## O que não confundir

- Cliente x pagador x recebedor: o cliente (bloco 1) é de quem é a proposta; o pagador (bloco 4) é quem sai na nota fiscal; o recebedor é a pessoa ou empresa do endereço de entrega (bloco 5).
- Contato do pedido x recebedor: o contato do pedido é a conversa do WhatsApp que recebe o orçamento, a arte e os avisos; o recebedor é quem recebe a mercadoria.
- Endereço de entrega x endereço fiscal: o de entrega é o escolhido no bloco 5 e é o destino do frete; o fiscal é o endereço principal do pagador, mostrado no bloco 4, e não se escolhe aqui.
- **Cliente não cadastrado / orçamento rápido** x **Proposta avulsa**: o orçamento rápido é proposta sem cliente no cadastro; a avulsa é proposta sem produtos do catálogo, marcada na aba Orçamento. Uma coisa não depende da outra.
- **Salvar endereço** x **Salvar alterações**: **Salvar endereço** só abre a janela do endereço selecionado; quem salva a proposta é **Salvar alterações**, no rodapé.
- Trocar o pagador x trocar o endereço: trocar o pagador muda a lista de endereços disponíveis, mas não escolhe o endereço de entrega por você.
- Vendedor da proposta x vendedor do cadastro: o campo **Vendedor** nasce com o vendedor padrão do cliente; só quem tem permissão grava um vendedor diferente.
- **Empresa** x cliente: **Empresa** é quem vende (Ideal, Biro ou E3), não a empresa do cliente.
- Quadro **Tabela especial** x **Desconto geral**: a tabela especial vem do cadastro do cliente e entra sozinha em cada item; o desconto geral é digitado na proposta e exige permissão.
- **Limite Faturado / Risco** x **Saldo na Conta Corrente**: o primeiro mostra o limite e o risco que estão no cadastro do cliente; o segundo é crédito que o cliente já tem a usar e aparece em aviso verde no topo da tela.
- Selo **Endereço de sócio** x selo **REQUER NOTA DE TRANSPORTE**: o primeiro só diz de quem é o endereço; o segundo avisa que a entrega é em cidade diferente da do endereço principal do pagador.
- **Observações e Condições** x orientação técnica da aba Produção / Expedição / Notas: a primeira é comercial e não chega à produção.
- **Observação para a nota fiscal** (bloco 4) x **Observações e Condições** (bloco 10): a primeira sai impressa na NF-e e na NFS-e; a segunda é interna e nunca vai para a nota. Não existe outro campo de observação no bloco 4.
- **id_int** x código do cliente: **id_int** é o número da proposta; o código do cliente é o número que aparece com `#` ao lado do nome dele.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| **Cliente obrigatório** — "Selecione um cliente para a proposta." | Nenhum cliente escolhido. | Busque e selecione o cliente. |
| **Nome do cliente obrigatório** | Orçamento rápido sem nome. | Preencha **Nome livre do cliente / empresa**. |
| **CEP obrigatório** | Orçamento rápido sem CEP. | Preencha o **CEP de entrega**. |
| **CEP não encontrado** | O CEP digitado não existe na consulta. | Confira o número ou preencha cidade e UF à mão. |
| **Nome obrigatório** / **WhatsApp obrigatório** | Contato novo sem nome ou sem WhatsApp. | Preencha os dois campos. |
| **Contato não gravado no cadastro** | O contato novo não pôde ser gravado no cadastro do cliente ao salvar (o motivo vem no aviso). | Nada foi salvo e o que você digitou continua na tela. Tente salvar de novo; se repetir, avise o suporte com o motivo. |
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
- [Proposta: abas Produção / Expedição / Notas, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Pedidos (lista)](pedidos.md)
- [Notas fiscais](notas-fiscais.md)
- [Expedição](expedicao.md)

## Arquivos de origem

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/orcamentos/components/CartaoEndereco.tsx`
- `src/features/orcamentos/lib/campos-do-endereco.ts`
- `src/features/orcamentos/lib/boxes-da-lateral.ts`
- `src/features/orcamentos/components/SocioPagadorInline.tsx`
- `src/features/orcamentos/components/ContactEditModal.tsx`
- `src/features/cadastros/components/DocumentoRecebedorFields.tsx`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/orcamentos/lib/endereco-entrega-proposta.ts`
- `src/features/orcamentos/orcamento-utils.ts`
- `src/lib/mocks/empresas.mock.ts`
- `src/features/cadastros/CadastroDetailPage.tsx`
- `src/features/orcamentos/components/ArtesCompradorCard.tsx`
- `src/features/orcamentos/lib/conversa-whatsapp.ts`
- `src/features/orcamentos/services/conversa-whatsapp.client.ts`
- `src/app/api/orcamentos/conversa-whatsapp/route.ts`
- `src/features/orcamentos/components/CampoObservacaoNotaFiscal.tsx`
- `src/features/fiscal/lib/observacao-nota-fiscal.ts`
