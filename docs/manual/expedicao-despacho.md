# Expedição: despachar e entregar

> **Última revisão:** 25/11/2026 (a troca de modalidade na proposta chega ao **Despachar** e à etiqueta enquanto o pedido não foi despachado; antes, o que tinha sido gravado na modalidade antiga seguia valendo). 19/11/2026 (reenvio aberto: o card e o **Despachar** mostram o envio do reenvio — tipo, transportadora, frete —, sem o rastreio do envio que voltou, sem **Recotar frete** nem trava de frete; prepostagem dos Correios recusada quando o reenvio sai por outro tipo). 18/11/2026 (reenvio: escolher como cobrar o frete do reenvio — **diferença**, **frete cheio** ou **sem cobrança**, só administrador; o valor a cobrar é o que trava o redespacho e vira o PIX; quadro **Pedido reenviado** na aba Fretes da proposta). 18/11/2026 (reenvio de pedido devolvido com diferença de frete: cotar o frete na janela **Reenviar**, PIX da diferença ou abono, nota nova quando o tipo de envio muda e trava do redespacho). 14/11/2026 (quadro **Contatos do pedido** no Despachar, com as conversas do ChatGuru escolhidas na aba Geral). 10/11/2026 (aviso de pedido pronto pelo WhatsApp sai no Confirmar despacho)
> **Caminho no menu:** Expedição → card do pedido → **Despachar** (os outros passos saem do menu de ações do card)
> **Endereço:** `/expedicao`

## Para que serve

É a segunda metade da bancada de saída: o que acontece do despacho até a entrega. O pedido já foi conferido e etiquetado na tela de [Expedição](expedicao.md); aqui ele é despachado, tem o frete recotado ou corrigido, sai para a coleta, para a retirada no balcão ou pelos Correios, recebe o rastreio e termina como Entregue — ou volta um passo e é reenviado, quando a entrega não deu certo.

## Quem acessa

- Para agir (despachar, confirmar coleta, retirada e entrega, voltar status, editar dados de expedição, recotar frete) é preciso a permissão **Processar Envio / Retirada**, além de Administrador e Super Administrador. O perfil Expedidor já nasce com ela.
- Só o administrador da Expedição (permissão **Configurar Expedição**, ou Administrador) libera a aplicação de uma recotação, libera um despacho travado pela diferença de frete, libera a retirada no balcão de um pedido CIF e marca uma prepostagem como cancelada.
- **Corrigir frete** aparece para quem tem a permissão **Editar Proposta Paga** (ou Administrador).
- **Reenviar (pedido devolvido)** aparece para quem tem a permissão **Reenviar Pedido Devolvido** (ou Administrador). Nenhum perfil nasce com ela: quem administra os perfis concede.
- Quem só tem **Visualizar Expedição** acompanha a tela e consulta o rastreio, mas não despacha.

## Botões e ações da tela

Nomes exatamente como aparecem na tela. A tabela completa da tela está em [Expedição](expedicao.md); aqui ficam os botões destes passos.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Despachar** | Card do pedido Na Expedição | Abre a janela **Despachar pedido** |
| **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)** | Caixa de marcar no aviso vermelho de pedido sem nota | Libera o botão de confirmar |
| **Fone** (telefone do destinatário) | Quadro de conferência, ao lado do bairro | Mostra e, com permissão de editar cadastros, troca ou corrige o telefone que vai na etiqueta e na prepostagem |
| **Recotar frete** | Bloco "Recotar frete", em pedido CIF Na Expedição | Cota de novo e registra o resultado. Não altera a proposta |
| **Aplicar** | Ao lado de cada opção recotada | Grava o frete novo na proposta. Fica apagado sem liberação ou quando a opção encarece |
| **Liberar despacho (ADM)** | Quadro vermelho da trava de frete; só administrador da Expedição | Libera um despacho, com motivo obrigatório |
| **Cancelar liberação** | Quadro verde "Despacho liberado", e no menu abaixo de "Recotação já liberada" | Desfaz a liberação ainda não usada |
| **Liberar aplicação da recotação** | Menu de ações; só administrador da Expedição, pedido Na Expedição | Autoriza uma aplicação de recotação na proposta |
| **Cliente vai retirar no balcão** | Caixa de marcar no topo do **Despachar**; só ADM pelo cadastro, em pedido CIF | Despacha o pedido CIF como retirada (A Retirar), sem mudar frete, total, modalidade da proposta nem nota |
| **Regravar frete** | Janela **Frete subsidiado** | Confirma a regravação do frete em cliente com **Pode editar valor do frete** |
| **Desvincular e despachar separado** | Caixa de marcar no quadro do pedido complementar | Separa o complemento, com motivo obrigatório |
| **Salvar sem despachar** | Rodapé, só no despacho | Guarda o que foi preenchido; o pedido segue Na Expedição |
| **Avisar o cliente pelo WhatsApp** | Caixa de marcar acima dos botões do rodapé, já marcada | Com ela marcada, o aviso de pedido pronto sai logo depois do despacho. Regra completa em [Expedição](expedicao.md), "Avisar o cliente que o pedido está pronto" |
| **Confirmar despacho** | Rodapé, no despacho por transporte | Despacha o pedido e, com a caixa marcada, envia o aviso logo depois |
| **Confirmar: aguardando retirada** | Rodapé, no despacho de retirada | Leva o pedido para A Retirar |
| **Corrigir frete** | Menu de ações; quem pode editar proposta paga, sem nota autorizada, sem despacho confirmado | Abre a janela **Corrigir frete** |
| **Rodoviário** / **Aéreo** | Janela **Corrigir frete**, pergunta "Como vai o transporte?" | Define a coluna do Kanban quando o sistema não reconhece a transportadora |
| **Confirmar correção** | Rodapé da janela **Corrigir frete** | Grava a correção. Vira **Nada a corrigir** (apagado) quando nada mudou |
| **Revisar o crédito** → **Gravar e escolher o destino** | Mesmo botão, quando sobra valor a favor do cliente | Mostra o crédito e, no segundo clique, grava a correção |
| **Manter crédito para uso futuro** / **Devolver ao cliente (solicitar ao Financeiro)** / **Abater débito existente** | Janela "Diferença Financeira — Crédito ao Cliente", depois da correção | Escolhe o destino do crédito. **Confirmar** registra |
| **Confirmar coleta** | Card do pedido despachado, aguardando coleta | Passa o pedido para Em Trânsito |
| **Marcar entregue** | Card do pedido Em Trânsito | Abre a janela **Confirmar entrega** |
| **Confirmar retirada** | Card do pedido A Retirar | Abre a janela da retirada, com **Quem retirou?** |
| **Confirmar entrega** | Janelas **Confirmar entrega** e **Confirmar retirada** | Conclui a entrega ou a retirada |
| **Código de rastreio (manual)** / **Conhecimento** | Janela **Despachar pedido** e **Editar dados de expedição** | O código dos Correios, ou o número do conhecimento da transportadora e do motoboy |
| **Rastrear objeto** | Menu de ações; só em envio pelos Correios com código de rastreio | Abre a janela **Rastreamento** |
| **Correios confirmam a entrega — marcar ENTREGUE no sistema** | Rodapé da janela **Rastreamento**, quando os Correios acusam a entrega de um pedido Em Trânsito | Abre a confirmação de entrega |
| **Voltar status** | Menu de ações; pedido que já chegou à Expedição | Abre a janela **Voltar status**, com **Voltar 1 passo** |
| **Reenviar (pedido devolvido)** | Menu de ações; pedido Em Trânsito já despachado, sem entrega registrada, que não é complemento nem tem complemento; só com a permissão **Reenviar Pedido Devolvido** | Abre a janela **Reenviar** |
| **Endereço de entrega do reenvio** / **Tipo de envio** / **Motivo** | Janela **Reenviar** | Escolhe o endereço (do cliente ou do pagador), o envio e o motivo, que fica na trilha |
| **Cotar frete** / **Cotar de novo** | Quadro **Frete do reenvio**, na janela **Reenviar**, quando o pedido é CIF e o endereço ou o tipo de envio mudam | Cota o frete para o endereço escolhido e lista as opções do tipo de envio, com o valor de cada uma |
| **Diferença** / **Frete cheio** / **Sem cobrança** | Quadro **Cobrança do frete do reenvio**, na janela **Reenviar** (CIF) | Escolhe como cobrar o frete do reenvio, com o valor a cobrar de cada modo. **Sem cobrança** só para administrador, com motivo |
| Campo do frete (só administrador da Expedição) | Quadro **Frete do reenvio**, quando a cotação não trouxe o tipo de envio escolhido | O administrador digita o frete combinado; fica registrado em nome dele |
| **Voltar para a Expedição** | Rodapé da janela **Reenviar** | Registra o reenvio e põe o pedido Na Expedição. Fica apagado sem motivo |
| **Editar dados de expedição** | Menu de ações; pedido com etiqueta gerada ou já despachado | Abre a mesma janela do despacho em modo de edição, com **Salvar dados** |
| **Marcar prepostagem como cancelada** | Menu de ações; só administrador da Expedição, com prepostagem ainda não marcada | Registra que a prepostagem foi cancelada no portal dos Correios |
| **Declaração de conteúdo** | Menu de ações; pedido que já chegou à Expedição e não tem nota autorizada | Abre o PDF da declaração |

## Passo a passo

### Despachar

1. No pedido com status Na Expedição, clique em **Despachar** e faça a conferência.
   No topo da janela, o quadro **Contatos do pedido · WhatsApp (ChatGuru)** mostra as conversas marcadas na aba Geral (bloco **3. Contatos do pedido**), com nome e número; a principal traz o selo **Principal · recebe o aviso**. A Expedição usa essas conversas e não oferece a lista de conversas de novo: o aviso de pedido pronto vai para a principal. Pedido antigo sem conversa marcada não mostra o quadro e segue como antes (desde 14/11/2026).
2. Se o pedido não tem nota autorizada, marque **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)**.
3. Se aparecer um quadro sobre o frete, resolva-o antes (veja "Recotar o frete").
4. Se o telefone do destinatário estiver errado, escolha em **Fone** o telefone certo entre os do cadastro (o seletor só aparece quando há mais de um) ou corrija o número no campo (só números, com DDD, mínimo 10 dígitos; telefone inválido bloqueia o botão). O número novo é gravado no cadastro do destinatário ao confirmar, antes do despacho. Se a gravação falhar, o pedido não é despachado e a tela mostra o erro. O número vai sempre para o WhatsApp 1; o Telefone fixo e o WhatsApp 2 do cadastro não são alterados. Sem alteração (inclusive só abrir e confirmar), nada é gravado no cadastro. Quem não pode editar cadastros vê o telefone, mas não edita nem troca o seletor, e o despacho segue com o número cadastrado. Uma prepostagem dos Correios já gerada mantém o telefone antigo.
5. Confira a caixa **Avisar o cliente pelo WhatsApp** (modelo e conversa) ou desmarque para não enviar. Clique em **Confirmar despacho**. Em retirada, o botão se chama **Confirmar: aguardando retirada**. O despacho é gravado primeiro e o aviso sai logo depois; se o aviso falhar, o despacho continua valendo, a janela mostra o motivo e o reenvio fica no menu, em **Avisar cliente**.
6. O destino depende de como o pedido sai:
   - Correios — vai direto para Em Trânsito;
   - transportadora ou motoboy — continua Na Expedição como "aguardando coleta", com o card laranja, até o carro passar;
   - retirada — vai para A Retirar.

### Recotar o frete

O bloco **Recotar frete** aparece em **Despachar** quando o pedido é CIF e está Na Expedição.

1. Clique em **Recotar frete**. Qualquer expedidor pode recotar; isso não altera a proposta.
2. O sistema lista as opções com o valor e a diferença para o frete da proposta.
3. Veja o quadro que aparece acima dos botões:
   - **Recotação dentro do limite de R$ 4,00** — é só um aviso; o despacho segue. O frete e o total da proposta não mudam.
   - **Recotação acima do limite de R$ 4,00** — o despacho fica bloqueado até um administrador liberar.
   - **Recote o frete antes de despachar** — o endereço ou o transporte não são os cotados; é preciso recotar para medir a diferença.
4. Para liberar o despacho bloqueado, o administrador da Expedição abre o mesmo pedido em **Despachar**, escreve o motivo e clica em **Liberar despacho (ADM)**. A liberação vale para um despacho e pode ser desfeita em **Cancelar liberação**.
5. Para gravar o frete novo na proposta, o administrador usa antes **Liberar aplicação da recotação** no menu do pedido. Depois o expedidor recota e clica em **Aplicar** na opção desejada. A liberação vale para uma aplicação e pode ser desfeita em **Cancelar liberação**, no menu.
6. Ao aplicar, o frete e o total do pedido mudam pelo mesmo valor e o fato fica registrado na timeline do pedido. A diferença não é lançada na conta do cliente.
7. Se o cliente do pedido tem **Pode editar valor do frete** ligado no cadastro, antes de gravar aparece a janela **Frete subsidiado**: "Este cliente tem frete subsidiado (valor atual: R$ X). Confirma que quer regravar para R$ Y?". **Regravar frete** grava; **Cancelar** não grava nada. O valor atual é o que está gravado no pedido agora.

### Despachar como retirada um pedido CIF (ADM)

Quando o cliente de um pedido CIF decide buscar no balcão, inclusive com a NF-e já autorizada:

1. Abra o pedido em **Despachar**. A **Modalidade do frete** aparece como **CIF** e não muda.
2. Marque **Cliente vai retirar no balcão**. Só aparece para ADM pelo cadastro. O bloco de envio some, a **Forma de envio** passa a **RETIRA BALCÃO** e o botão vira **Confirmar: aguardando retirada**.
3. Aparece o quadro vermelho **Retirada no balcão: precisa da liberação de um ADM**. O administrador da Expedição escreve o motivo e clica em **Liberar despacho (ADM)**. A liberação vale para um despacho.
4. Clique em **Confirmar: aguardando retirada**. O pedido vai para A Retirar; o histórico registra quem fez e o motivo "cliente retira no balcão".
5. Quando o cliente buscar, use **Confirmar retirada**, como em qualquer retirada.

O frete, o total, a modalidade CIF da proposta e a nota ficam como estavam. O frete cobrado e não usado não vira crédito. Com a caixa marcada, **Salvar sem despachar** e a etiqueta não gravam nada: a retirada só se grava no despacho.

### Corrigir frete

Serve para trocar a modalidade (quem paga) e a transportadora de um pedido que já saiu do orçamento.

1. No menu do pedido, clique em **Corrigir frete**.
2. Escolha a **Modalidade do frete** e, fora de retirada, a **Transportadora** (obrigatória em FOB, opcional em CIF).
3. Se aparecer **Como vai o transporte?**, escolha **Rodoviário** ou **Aéreo**. Serve só para definir a coluna do Kanban; em branco, o pedido fica em **Extras**.
4. Confira o quadro com **Total atual**, **Total novo** e **Frete**. Em FOB e em retirada a proposta não cobra frete, então o total cai; em CIF vale o frete cotado.
5. Clique em **Confirmar correção**.
6. Se sobrar dinheiro a favor do cliente, o botão vira **Revisar o crédito** e depois **Gravar e escolher o destino**. A correção é gravada, o crédito é aberto na Conta Corrente do cliente e você escolhe o destino: **Manter crédito para uso futuro**, **Devolver ao cliente (solicitar ao Financeiro)** ou **Abater débito existente**.
7. Se ficar valor a receber, a correção grava direto. O saldo continua sendo da proposta e é cobrado na aba Pagamentos.
8. Se o cliente do pedido tem **Pode editar valor do frete** ligado no cadastro, antes de gravar aparece a janela **Frete subsidiado**, com o frete atual e o novo. **Regravar frete** segue a gravação (incluindo o passo do crédito, se houver); **Cancelar** não grava nada.

### Confirmar a coleta

1. No pedido laranja (despachado, aguardando coleta), clique em **Confirmar coleta** quando a transportadora ou o motoboy levar o volume.
2. Confirme. O pedido passa para Em Trânsito.
3. Se um pedido de transportadora ou motoboy voltar para Na Expedição e for despachado de novo, a coleta anterior é descartada e o pedido volta a ficar laranja (aguardando coleta), pronto para uma nova **Confirmar coleta**.

### Informar o rastreio e rastrear

1. O código de rastreio entra pela prepostagem ou pelo campo **Código de rastreio (manual)**, em envio pelos Correios.
   Em envio por **transportadora** ou **motoboy**, o campo se chama **Conhecimento**: digite o número do conhecimento no modal **Despachar pedido** ou, depois do despacho (A Retirar, Em Trânsito ou Entregue), em **Editar dados de expedição**. O número pode ser corrigido a qualquer momento por quem opera a Expedição. Cada gravação ou correção registra quem fez e o valor antigo e o novo no histórico do pedido, sem mudar valor nem status.
2. Na lista, clique no código para copiá-lo.
3. No menu do pedido, clique em **Rastrear objeto**. Só aparece em envio pelos Correios: o conhecimento de transportadora ou motoboy não é rastreado. A janela mostra a situação atual e os eventos; o botão de atualizar refaz a consulta.
4. Quando os Correios confirmam a entrega de um pedido Em Trânsito, aparece o botão **Correios confirmam a entrega — marcar ENTREGUE no sistema**.

### Confirmar a retirada no balcão

1. No pedido com status A Retirar, clique em **Confirmar retirada**.
2. Em **Quem retirou?**, escreva o nome de quem levou o pedido.
3. Clique em **Confirmar entrega**. O pedido passa para Entregue.

### Marcar como entregue

1. No pedido com status Em Trânsito, clique em **Marcar entregue**.
2. Leia o aviso, se houver, e clique em **Confirmar entrega**.

Em envio pelos Correios despachado há menos de 12 horas, o sistema avisa há quanto tempo o pedido foi postado. É só um aviso: confirmando, a entrega fica registrada com a data e a hora de agora.

### Voltar um passo

1. No menu do pedido, clique em **Voltar status**.
2. Escreva o motivo (obrigatório, mínimo de 3 letras; fica registrado).
3. Clique em **Voltar 1 passo**.

Os retornos possíveis são: Entregue volta para Em Trânsito (ou para A Retirar, se foi retirada); Em Trânsito e A Retirar voltam para Na Expedição; Na Expedição volta para EM ACABAMENTO.

### Reenviar um pedido devolvido

Use quando a transportadora ou os Correios devolveram um pedido que está Em Trânsito e ele precisa sair de novo, sem passar por Arte nem Produção.

1. No menu do pedido, clique em **Reenviar (pedido devolvido)**.
2. Escolha o **Endereço de entrega do reenvio**. A lista traz os endereços do cliente e do pagador; o atual vem marcado. Mudar o endereço na proposta não muda o envio: depois do despacho vale o endereço escolhido aqui.
3. Escolha o **Tipo de envio**. Quem paga o frete (CIF ou FOB) não muda.
4. Em CIF, se o endereço ou o tipo de envio mudaram, aparece o quadro **Frete do reenvio**, com o frete do envio anterior. Clique em **Cotar frete** e escolha uma das opções do tipo de envio (Azul, VEPPO, Correios...). Se a cotação não trouxer o tipo escolhido, só o administrador da Expedição pode digitar o frete combinado.
5. Em CIF, no quadro **Cobrança do frete do reenvio**, escolha como cobrar. Cada opção mostra o valor a cobrar:
   - **Diferença**: frete novo menos o do envio anterior. Com frete menor ela não vale e o botão fica apagado.
   - **Frete cheio**: o frete novo inteiro, sem desconto do anterior, qualquer que seja o valor.
   - **Sem cobrança**: nada a cobrar. Só administrador, com motivo (mínimo 5 caracteres).

   A frase laranja abaixo repete o modo e o valor. O valor a cobrar é cobrado do cliente por um PIX próprio, na aba **Pagamentos** da proposta, ou abonado por um administrador. Ele não muda o total do pedido nem a nota.
6. Escreva o motivo (mínimo de 3 letras) e clique em **Voltar para a Expedição**.
7. O pedido volta para Na Expedição com o selo **Reenvio N**. Antes de despachar de novo:
   - com valor a cobrar, ele precisa estar pago (PIX confirmado) ou abonado; no modo **sem cobrança** não há o que pagar. Enquanto não houver PIX nem abono, um administrador pode trocar o modo na aba **Pagamentos** (**Trocar modo de cobrança**);
   - se o tipo de envio mudou (por exemplo, de Correios para Transportadora), o pedido precisa de uma **nota nova**, emitida depois do reenvio: NF-e de venda, de remessa ou NFS-e. A nota do primeiro envio não vale.
8. Despache pelo botão **Despachar**. Com o reenvio aberto, ele já abre com o tipo de envio, a transportadora e o endereço do reenvio, e com o rastreio vazio: informe o rastreio ou conhecimento NOVO. O aviso pelo WhatsApp usa o modelo da forma de envio do reenvio. Não há **Recotar frete** nem a trava de frete (o frete do reenvio foi tratado no reenvio). A faixa do reenvio mostra o modo e o valor a cobrar e se a nota nova já foi emitida. Só quando o reenvio é pelos Correios aparecem a prepostagem e a etiqueta dos Correios: gere a prepostagem de novo (a janela pede confirmação). Em reenvio por transportadora ou motoboy a etiqueta é a 10x15 e o servidor recusa prepostagem dos Correios.

O primeiro envio (data, rastreio, endereço, transportadora) fica guardado no registro do reenvio. Não há limite de reenvios por pedido.

### Editar dados de um pedido já despachado

1. No menu do pedido, clique em **Editar dados de expedição**.
2. Corrija peso, volumes, observações da etiqueta ou o número da nota, ou reimprima a etiqueta.
3. Clique em **Salvar dados**. O status não muda.

### Despachar pedido com complemento

1. O despacho é feito pelo pedido principal. O complemento que já está na Expedição e pago sai junto, com o mesmo transporte e a mesma data.
2. O quadro **Pedido complementar do mesmo evento** mostra a situação de cada complemento: "em EXPEDICAO, sai junto" ou o motivo do bloqueio.
3. Se o complemento ainda não chegou à Expedição ou não está pago por inteiro, espere ou marque **Desvincular e despachar separado** e escreva o **Motivo**. O complemento deixa de sair junto e passa a precisar de frete próprio.
4. Confirmar coleta, retirada e entrega no principal levam junto o complemento que está no mesmo status.
5. Se o complemento não acompanhou o despacho, abra **Despachar** no próprio complemento para repetir o passo.

### Cancelar a prepostagem

1. Cancele a prepostagem no portal dos Correios. O Vibe não cancela nos Correios.
2. No menu do pedido, clique em **Marcar prepostagem como cancelada** (só administrador da Expedição).
3. O rastreio e a etiqueta oficial somem da tela, e uma nova prepostagem pode ser gerada.

### Imprimir a declaração de conteúdo

1. No menu do pedido, clique em **Declaração de conteúdo**.
2. O PDF abre com remetente, destinatário e os itens do pedido.

A opção só aparece em pedido que já chegou à Expedição e não tem nota autorizada. É o papel que acompanha o volume no lugar da nota.

## Regras e bloqueios

As regras da tela inteira estão em [Expedição](expedicao.md). Estas são as que travam estes passos:

- Não dá para despachar sem a modalidade do frete, a transportadora, o endereço de entrega, o peso aferido e a quantidade de volumes. Em retirada, basta a modalidade. O rastreio é opcional.
- **Saldo a receber trava o despacho.** Se o total do pedido é maior que o pago confirmado, o despacho é recusado, mesmo que a diferença seja de R$ 0,01. Vale para qualquer modalidade, inclusive retirada no balcão, e para o complemento que sai junto. Não há liberação de ADM na Expedição para o saldo. A trava age no primeiro despacho e no redespacho de um pedido reenviado.
- **Trava do redespacho (desde 18/11/2026).** O pedido reenviado só sai de novo quando: o valor a cobrar do reenvio (pelo modo: diferença, frete cheio ou nada) está pago ou abonado; o envio é o do reenvio (endereço e tipo), quando o reenvio cotou o frete; e, se o tipo de envio mudou, há nota de produção emitida depois do reenvio. Com o frete cotado no reenvio, a trava de frete da recotação não se aplica ao redespacho: a diferença já foi decidida no reenvio.
- A trava de frete só vale em CIF: até R$ 4,00 acima do frete da proposta só avisa; acima disso, ou sem recotação para o CEP atual, o despacho e a prepostagem ficam bloqueados até a liberação de um administrador da Expedição.
- **A prepostagem leva a NF-e do pedido (desde 03/11/2026).** Desde 01/11/2026 os Correios exigem NF-e para postar. Com NF-e de venda autorizada, a prepostagem envia aos Correios a chave de acesso e o número da nota, junto com os itens da declaração de conteúdo. Sem nota autorizada (pendente, cancelada, só de serviço ou faturada no sistema antigo), a prepostagem sai como antes, só com a declaração, sem bloqueio novo. Se os Correios recusarem, a janela mostra **Correios recusaram a prepostagem** com a mensagem deles. A recusa não fica registrada no pedido: anote ou tente de novo.
- Recotar é livre para o expedidor. **Aplicar** depende de liberação do administrador e só aceita opção que barateia ou empata o frete. Com NF-e autorizada não se aplica nenhuma opção, nem a que barateia: a tela recusa antes de pedir confirmação, com a mesma mensagem do **Corrigir frete** (cancele a nota antes). Nota cancelada ou denegada não impede.
- **VEPPO com 20% a mais (desde 03/11/2026).** A opção VEPPO da recotação vem com os 20% sobre o valor da VEPPO, como na proposta. Exceção: o pedido criado antes das 09:38 de 03/11/2026 que tem a VEPPO como frete escolhido recota sem os 20%, como antes. Assim a recotação dele não fica 20% acima do frete gravado e não pede **Liberar despacho (ADM)** só por causa do acréscimo. A mesma regra vale no **Aplicar** e no frete do complemento.
- **A troca de modalidade na proposta vale para o despacho e a etiqueta (desde 25/11/2026).** Enquanto o pedido não foi despachado, o **Despachar** abre com a modalidade e o envio que a proposta declara agora. O que ficou gravado antes (ao gerar a etiqueta ou salvar sem despachar) só é aproveitado se foi gravado na mesma modalidade. Exemplo: pedido trocado de **Retira** para **CIF / SEDEX** abre em CIF com os Correios, sem o aviso **Diferente do que o orçamento declarou**, e a etiqueta sai como envio, não como retirada. Depois do despacho confirmado vale o que foi despachado.
- Pedido CIF só sai como retirada por **Cliente vai retirar no balcão**, com ADM pelo cadastro e **Liberar despacho (ADM)**.
- **Corrigir frete** só vale para pedido Na Expedição ou A Retirar; não aparece com nota autorizada, com despacho confirmado ou com pedido entregue, e é recusado quando o total muda e o pedido tem título ativo no Contas a Receber.
- Não dá para trocar o endereço de entrega nem a transportadora aqui: os dois vêm da proposta. A exceção é o pedido devolvido, em **Reenviar (pedido devolvido)**.
- O reenvio é recusado quando o frete novo é menor que o do envio anterior no modo **diferença** (em CIF; **frete cheio** e **sem cobrança** aceitam), quando se tenta trocar quem paga, e quando há saldo a receber no pedido (inclusive frete de um reenvio anterior ainda não pago).
- Pedido complementar não é despachado sozinho enquanto o principal não foi despachado, e **Voltar status** no principal não volta o complemento.
- Toda mudança de status confere se o pedido ainda está no status que a tela mostrava. Se outra pessoa mexeu antes, a ação é recusada e a lista recarrega.

## O que não confundir

- **Avisar cliente** (menu) x **Confirmar despacho**: desde 10/11/2026 o aviso de pedido pronto sai no próprio Confirmar despacho, com a caixa marcada. O **Avisar cliente** do menu só manda (ou reenvia) a mensagem e não muda o status do pedido. Detalhes em [Expedição](expedicao.md).
- **Recotar frete** x **Corrigir frete**: recotar busca preços novos para o mesmo envio e só grava com liberação; corrigir troca a modalidade (quem paga) e a transportadora, e muda o total do pedido.
- **Confirmar coleta** x **Marcar entregue**: a coleta é o carro levando o volume (vai para Em Trânsito); a entrega é a chegada ao cliente (vai para Entregue).
- **Voltar status** x **Reenviar (pedido devolvido)**: voltar um passo desfaz a última mudança; o reenvio registra que o pedido voltou devolvido e o devolve Na Expedição com o selo **Reenvio N**, guardando o primeiro envio.
- **Salvar sem despachar** x **Confirmar despacho**: o primeiro só guarda o que foi preenchido e não envia aviso; o segundo muda o status do pedido e, com a caixa marcada, avisa o cliente.
- **Marcar prepostagem como cancelada** x cancelar nos Correios: o Vibe não cancela nos Correios. O cancelamento é feito no portal; aqui só se registra.

## Erros comuns

A tabela completa dos avisos da Expedição está em [Expedição](expedicao.md). Os mais comuns nestes passos:

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Despacho bloqueado: falta receber R$ ... deste pedido. O total do pedido é R$ ... e o pago confirmado é R$ ..." | O total do pedido ficou maior que o pago confirmado | Gerar a cobrança da diferença na aba Pagamentos da proposta e despachar depois da confirmação, ou pedir ao administrador para abonar a diferença |
| Recote o frete para o CEP de entrega antes de despachar. | Pedido CIF com CEP ou transporte diferente do cotado, sem recotação | Clicar em **Recotar frete** |
| A recotação (R$ …) passa R$ … do frete da proposta (R$ …): acima de R$ 4,00 só com liberação de ADM. | A diferença passou do limite | Pedir ao administrador da Expedição o **Liberar despacho (ADM)** |
| Confirme o despacho sem NF | O pedido não tem nota autorizada e a caixa não foi marcada | Marcar **Despachar mesmo assim** |
| Este pedido é complemento do #…: o despacho é feito pelo pedido principal, e os dois saem juntos. | Tentou despachar o complemento antes do principal | Despachar o principal |
| Pedido #… ja foi despachado. Para corrigir o frete, volte um passo… | Corrigir frete com despacho confirmado | **Voltar status** e tentar de novo |
| Você não tem a permissão de reenviar pedido (expedicao.reenvio). | O perfil não tem **Reenviar Pedido Devolvido** | Pedir a permissão a quem administra os perfis |
| "Despacho bloqueado: falta receber R$ ... do frete do reenvio N." | O valor a cobrar do reenvio (diferença ou frete cheio) não foi pago nem abonado | Gerar o PIX na aba **Pagamentos** e despachar depois da confirmação, ou pedir ao administrador para abonar ou trocar o modo |
| "O reenvio N trocou o tipo de envio (... para ...) e exige nota nova" | O tipo de envio mudou e o pedido não tem nota emitida depois do reenvio | Emitir a nota nova (venda, remessa ou serviço) e despachar em seguida |
| "Prepostagem bloqueada" — "O reenvio N sai por ..., não pelos Correios." (ou, do servidor, "... Nenhuma prepostagem foi criada.") | Prepostagem dos Correios pedida com reenvio aberto por transportadora ou motoboy | Despache pelo envio do reenvio; nada sai para os Correios |
| "O reenvio N cotou o frete para ... no CEP .... Despache com o tipo de envio e o endereço do reenvio." | O Despachar está com outro endereço ou tipo de envio | Usar o endereço e o tipo de envio do reenvio |
| O pedido mudou de status em outra tela. A lista será recarregada. | Outra pessoa alterou o pedido antes | Conferir o pedido na lista recarregada |

## Veja também

- [Expedição](expedicao.md)
- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Notas fiscais](notas-fiscais.md)
- [Carteira (contas a receber)](carteira.md)

## Arquivos de origem

- `src/features/expedicao/ExpedicaoPage.tsx`
- `src/features/expedicao/components/DespacharModal.tsx`
- `src/features/expedicao/lib/tipo-frete.ts`
- `src/features/expedicao/components/ContatosDoPedidoNoDespacho.tsx`
- `src/features/expedicao/components/ConferenciaDespacho.tsx`
- `src/features/expedicao/components/ConfirmarAcaoModal.tsx`
- `src/features/expedicao/components/CorrigirFreteModal.tsx`
- `src/features/expedicao/components/RastreioModal.tsx`
- `src/features/expedicao/components/RetiradaModal.tsx`
- `src/features/expedicao/components/VoltarStatusModal.tsx`
- `src/features/expedicao/components/ReenvioModal.tsx`
- `src/features/expedicao/lib/retirada-adm.ts`
- `src/features/expedicao/lib/frete-subsidiado.ts`
- `src/features/expedicao/lib/reenvio.ts`
- `src/features/expedicao/services/reenvio.client.ts`
- `src/features/expedicao/services/recotacao.client.ts`
- `src/features/expedicao/services/expedicao-acoes.service.ts`
- `src/features/expedicao/services/expedicao.service.ts`
- `supabase/migrations/20261022_exp_reenvio_fase1.sql`
- `supabase/migrations/20261118c_exp_reenvio_modo_cobranca.sql`
- `src/app/api/expedicao/correios/prepostagem/route.ts`
