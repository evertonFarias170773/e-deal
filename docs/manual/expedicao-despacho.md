# Expedição: despachar e entregar

> **Última revisão:** 29/10/2026
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
| **Confirmar despacho** | Rodapé, no despacho por transporte | Despacha o pedido |
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
| **Voltar para a Expedição** | Rodapé da janela **Reenviar** | Registra o reenvio e põe o pedido Na Expedição. Fica apagado sem motivo |
| **Editar dados de expedição** | Menu de ações; pedido com etiqueta gerada ou já despachado | Abre a mesma janela do despacho em modo de edição, com **Salvar dados** |
| **Marcar prepostagem como cancelada** | Menu de ações; só administrador da Expedição, com prepostagem ainda não marcada | Registra que a prepostagem foi cancelada no portal dos Correios |
| **Declaração de conteúdo** | Menu de ações; pedido que já chegou à Expedição e não tem nota autorizada | Abre o PDF da declaração |

## Passo a passo

### Despachar

1. No pedido com status Na Expedição, clique em **Despachar** e faça a conferência.
2. Se o pedido não tem nota autorizada, marque **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)**.
3. Se aparecer um quadro sobre o frete, resolva-o antes (veja "Recotar o frete").
4. Se o telefone do destinatário estiver errado, escolha em **Fone** o telefone certo entre os do cadastro (o seletor só aparece quando há mais de um) ou corrija o número no campo (só números, com DDD, mínimo 10 dígitos; telefone inválido bloqueia o botão). O número novo é gravado no cadastro do destinatário ao confirmar, antes do despacho. Se a gravação falhar, o pedido não é despachado e a tela mostra o erro. O número vai sempre para o WhatsApp 1; o Telefone fixo e o WhatsApp 2 do cadastro não são alterados. Sem alteração (inclusive só abrir e confirmar), nada é gravado no cadastro. Quem não pode editar cadastros vê o telefone, mas não edita nem troca o seletor, e o despacho segue com o número cadastrado. Uma prepostagem dos Correios já gerada mantém o telefone antigo.
5. Clique em **Confirmar despacho**. Em retirada, o botão se chama **Confirmar: aguardando retirada**.
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
4. Escreva o motivo (mínimo de 3 letras) e clique em **Voltar para a Expedição**.
5. O pedido volta para Na Expedição com o selo **Reenvio N**. Despache de novo pelo botão **Despachar**, informando o rastreio ou conhecimento novo. Nos Correios, gere a prepostagem de novo (a janela pede confirmação).

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
- **Saldo a receber trava o despacho.** Se o total do pedido é maior que o pago confirmado, o despacho é recusado, mesmo que a diferença seja de R$ 0,01. Vale para qualquer modalidade, inclusive retirada no balcão, e para o complemento que sai junto. Não há liberação de ADM na Expedição para o saldo. A trava só age no primeiro despacho.
- A trava de frete só vale em CIF: até R$ 4,00 acima do frete da proposta só avisa; acima disso, ou sem recotação para o CEP atual, o despacho e a prepostagem ficam bloqueados até a liberação de um administrador da Expedição.
- Recotar é livre para o expedidor. **Aplicar** depende de liberação do administrador e só aceita opção que barateia ou empata o frete; com nota autorizada, só o que barateia.
- Pedido CIF só sai como retirada por **Cliente vai retirar no balcão**, com ADM pelo cadastro e **Liberar despacho (ADM)**.
- **Corrigir frete** só vale para pedido Na Expedição ou A Retirar; não aparece com nota autorizada, com despacho confirmado ou com pedido entregue, e é recusado quando o total muda e o pedido tem título ativo no Contas a Receber.
- Não dá para trocar o endereço de entrega nem a transportadora aqui: os dois vêm da proposta. A exceção é o pedido devolvido, em **Reenviar (pedido devolvido)**.
- O reenvio é recusado quando o endereço ou o tipo de envio novos mudam o valor do frete em CIF, quando se tenta trocar quem paga, e quando há saldo a receber no pedido.
- Pedido complementar não é despachado sozinho enquanto o principal não foi despachado, e **Voltar status** no principal não volta o complemento.
- Toda mudança de status confere se o pedido ainda está no status que a tela mostrava. Se outra pessoa mexeu antes, a ação é recusada e a lista recarrega.

## O que não confundir

- **Recotar frete** x **Corrigir frete**: recotar busca preços novos para o mesmo envio e só grava com liberação; corrigir troca a modalidade (quem paga) e a transportadora, e muda o total do pedido.
- **Confirmar coleta** x **Marcar entregue**: a coleta é o carro levando o volume (vai para Em Trânsito); a entrega é a chegada ao cliente (vai para Entregue).
- **Voltar status** x **Reenviar (pedido devolvido)**: voltar um passo desfaz a última mudança; o reenvio registra que o pedido voltou devolvido e o devolve Na Expedição com o selo **Reenvio N**, guardando o primeiro envio.
- **Salvar sem despachar** x **Confirmar despacho**: o primeiro só guarda o que foi preenchido; o segundo muda o status do pedido.
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
