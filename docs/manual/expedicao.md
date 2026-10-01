# Expedição

> **Última revisão:** 01/10/2026
> **Onde fica:** menu → Expedição (endereço `/expedicao`)

## Para que serve

É a bancada de saída dos pedidos: do acabamento até a entrega. Aqui o expedidor confere peso e volumes, imprime a etiqueta, gera a prepostagem dos Correios, despacha, confirma a coleta, a retirada no balcão e a entrega.

A tela também avisa o que está atrasado ou prometido para hoje e segura o despacho quando o frete cobrado na proposta não corresponde mais ao envio.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Expedição** no perfil, além de Administrador e Super Administrador. Quem não tem recebe "Acesso Negado — Você não tem permissão para visualizar a Expedição." Só com essa permissão já dá para gerar etiquetas, a declaração de conteúdo e consultar o rastreio.
- Para agir (marcar pronto, despachar, confirmar coleta, retirada e entrega, voltar status, editar dados de expedição, gerar prepostagem, recotar frete) é preciso a permissão **Processar Envio / Retirada**. O perfil Expedidor já nasce com as duas.
- Só o administrador da Expedição (permissão **Configurar Expedição**, ou Administrador) libera a aplicação de uma recotação, libera um despacho travado pela diferença de frete e marca uma prepostagem como cancelada.
- **Corrigir frete** aparece para quem tem a permissão **Editar Proposta Paga** (ou Administrador).
- **Encerrar teste** é exclusivo do Super Administrador.

## Passo a passo

### Entender a tela

1. No topo ficam cinco cartões, e cada um é um filtro. A tela abre em **Expedição do dia**.
   - **Expedição do dia** — atrasados e prometidos para hoje, em qualquer etapa, inclusive os que ainda estão na fábrica.
   - **Pronto p/ expedir** — pedidos em EXPEDICAO: os que ainda vão ser despachados e os já despachados que aguardam a coleta.
   - **A retirar** — pedidos em A RETIRAR: estão no balcão esperando o cliente buscar.
   - **Em trânsito** — pedidos em EM TRANSITO: já saíram com Correios, transportadora ou motoboy.
   - **Entregues** — pedidos ENTREGUE nos últimos 7 dias. O pedido entregue continua no painel e na busca por 30 dias.
2. Clicar num cartão troca o filtro. Clicar de novo no mesmo cartão não desfaz; para voltar ao início use **Expedição do dia** ou **Limpar filtros**.
3. Abaixo dos cartões, a busca aceita número do pedido, número do cadastro, nome do cliente (razão ou fantasia), rastreio ou transportadora. O número de um pedido complementar também acha o principal, e vice-versa.
4. Os filtros ao lado são **Todos os fretes** (por categoria), **Todas Empresas** e **Todos os pedidos** / **Só complementos** / **Só com complemento**.
5. O botão **Transportadoras**, no cabeçalho, abre a lista de transportadoras cadastradas, com **Nova transportadora** e **Editar**.

### Usar o Kanban e a lista

1. A tela abre no Kanban. As colunas são as categorias de transporte, nesta ordem: **Correios**, **Motoboy**, **Retira balcão**, **Rodoviário**, **Aéreo**, **Veppo** e **Extras**. Coluna vazia não aparece. Pedido ainda sem categoria definida fica em **Extras**.
2. A barra no topo do Kanban lista as colunas com a quantidade de cada uma. Clique no nome para ir até a coluna; as setas rolam uma coluna por vez.
3. Dentro de cada coluna, os pedidos prontos para despachar aparecem primeiro.
4. Cada card mostra o número do pedido, o cadastro (`cli 8469`), o nome do cliente, a cidade de entrega, o pagador (quando é outra pessoa), quem leva, o último acontecimento com data e hora ("Pronto", "No balcão", "Despachado", "Coletado", "Entregue"), a data prevista (`prev`), peso, volumes e o frete cobrado.
5. Quando o pedido tem nota autorizada, o card traz o botão para abrir a DANFE.
6. As ações ficam no menu **Ações** do card. A ação principal da etapa é sempre a primeira da lista.
7. Clique em **Ver em lista** para trocar para a tabela, e em **Ver por transportadora** para voltar ao Kanban. Na lista a ação principal vira um botão na coluna **Ações**, e o rastreio pode ser copiado com um clique.

### Ler as cores e os avisos de prazo

1. A legenda ao lado do botão de visão vale para o fundo do card no Kanban e para o ponto ao lado do status na lista:
   - branco — **ainda na fábrica**;
   - azul — **na bancada, a despachar**;
   - laranja — **despachado, aguardando coleta**;
   - verde — **já saiu**.
2. O selo vermelho **ATRASADO Nd** aparece quando a data prometida já passou e o pedido ainda não saiu da bancada. Na lista, a linha inteira fica avermelhada.
3. O selo âmbar **HOJE** aparece quando a promessa é para hoje e o pedido ainda não saiu. Na lista, a linha fica amarelada.
4. Na lista, **SEM NF** aparece em vermelho para pedidos em EXPEDICAO, A RETIRAR ou EM TRANSITO sem nota autorizada.
5. Os selos **Compl. de #X** e **+ compl. #Y** marcam pedido complementar. O **+ compl.** fica verde quando o complemento já está na Expedição e âmbar quando ainda não chegou.

### Marcar o pedido como pronto

1. No pedido que ainda está em produção ou acabamento, clique em **Marcar pronto**.
2. Confirme em **Marcar pronto**. O pedido passa para EXPEDICAO e vai para a bancada.

O pedido também chega à Expedição pela Revisão do boletim da produção.

### Conferir o pedido (peso e volumes)

1. No pedido em EXPEDICAO, clique em **Despachar**.
2. Confira o quadro do topo: **Destinatário**, **Endereço**, **Bairro**, **Fone**, **CEP**, **Cidade/UF**, **Forma de envio** e **Observações**. Endereço e transportadora vêm da proposta e não são trocados aqui.
3. Preencha **Peso aferido (kg)**. O campo já vem com a soma do peso medido nos setores, quando existe. Abaixo dele aparecem o peso previsto e, se algum setor ficou sem pesar, o aviso para conferir na balança.
4. Preencha **Qtd. volumes** (de 1 a 50) e **Tipo de volume** (Pacote, Caixa, Envelope ou Outro).
5. Se não há nota autorizada, digite o número em **Nº da nota fiscal** quando houver. Com nota autorizada o campo vem preenchido e não é editável.
6. Em **Observações (vão na etiqueta)**, escreva o que deve sair impresso no volume.
7. Se o pedido não tem modalidade de frete definida, escolha uma: **Retira no balcão**, **FOB — por conta do cliente** ou **CIF — por conta da empresa**. Quando a modalidade já está definida, ela aparece só para leitura no cabeçalho.
8. Para guardar o que preencheu e continuar depois, clique em **Salvar sem despachar**. O pedido segue na Expedição.

### Gerar a etiqueta

1. Dentro de **Despachar** (ou de **Editar dados de expedição**), preencha os dados do envio.
2. Clique no botão azul grande. O nome dele muda conforme o envio:
   - **Gerar etiqueta 10x15** — transportadora e motoboy;
   - **Etiqueta de retirada** — retirada no balcão;
   - **Etiqueta Correios (oficial)** — Correios com prepostagem gerada.
3. O sistema salva o que está na tela e abre o PDF.
4. Para reimprimir depois, use **Editar dados de expedição** no menu do pedido e clique no mesmo botão.

### Gerar a prepostagem dos Correios

1. O envio precisa ser CIF e pelos Correios. Em **Despachar**, preencha peso, volumes e confira o endereço.
2. Clique em **Gerar prepostagem SEDEX** ou em **PAC**.
3. O rastreio é preenchido sozinho e aparece o aviso "Prepostagem criada". A partir daí o botão da etiqueta vira **Etiqueta Correios (oficial)**.
4. Se o pedido já tinha prepostagem, o sistema pergunta "Gerar outra prepostagem?" e mostra os códigos. Copie o código que vai sair do registro se ainda precisar cancelá-lo no portal, e confirme em **Gerar SEDEX** ou **Gerar PAC**.

Também é possível digitar o código em **Código de rastreio (manual)**, que só aparece em envio pelos Correios.

### Cancelar a prepostagem

1. Cancele a prepostagem no portal dos Correios. O Vibe não cancela nos Correios.
2. No menu do pedido, clique em **Marcar prepostagem como cancelada** (só administrador da Expedição).
3. O rastreio e a etiqueta oficial somem da tela, e uma nova prepostagem pode ser gerada.

### Imprimir a declaração de conteúdo

1. No menu do pedido, clique em **Declaração de conteúdo**.
2. O PDF abre com remetente, destinatário e os itens do pedido.

A opção só aparece em pedido que já chegou à Expedição e não tem nota autorizada. É o papel que acompanha o volume no lugar da nota.

### Despachar

1. No pedido em EXPEDICAO, clique em **Despachar** e faça a conferência.
2. Se o pedido não tem nota autorizada, marque **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)**.
3. Se aparecer um quadro sobre o frete, resolva-o antes (veja "Recotar o frete").
4. Clique em **Confirmar despacho**. Em retirada, o botão se chama **Confirmar: aguardando retirada**.
5. O destino depende de como o pedido sai:
   - Correios — vai direto para EM TRANSITO;
   - transportadora ou motoboy — continua em EXPEDICAO como "aguardando coleta", com o card laranja, até o carro passar;
   - retirada — vai para A RETIRAR.

### Recotar o frete

O bloco **Recotar frete** aparece em **Despachar** quando o pedido é CIF e está em EXPEDICAO.

1. Clique em **Recotar frete**. Qualquer expedidor pode recotar; isso não altera a proposta.
2. O sistema lista as opções com o valor e a diferença para o frete da proposta.
3. Veja o quadro que aparece acima dos botões:
   - **Recotação dentro do limite de R$ 4,00** — é só um aviso; o despacho segue. O frete e o total da proposta não mudam.
   - **Recotação acima do limite de R$ 4,00** — o despacho fica bloqueado até um administrador liberar.
   - **Recote o frete antes de despachar** — o endereço ou o transporte não são os cotados; é preciso recotar para medir a diferença.
4. Para liberar o despacho bloqueado, o administrador da Expedição abre o mesmo pedido em **Despachar**, escreve o motivo e clica em **Liberar despacho (ADM)**. A liberação vale para um despacho e pode ser desfeita em **Cancelar liberação**.
5. Para gravar o frete novo na proposta, o administrador usa antes **Liberar aplicação da recotação** no menu do pedido. Depois o expedidor recota e clica em **Aplicar** na opção desejada. A liberação vale para uma aplicação e pode ser desfeita em **Cancelar liberação**, no menu.
6. Ao aplicar, o frete e o total do pedido mudam pelo mesmo valor e o fato fica registrado na timeline do pedido. A diferença não é lançada na conta do cliente.

### Corrigir frete

Serve para trocar a modalidade (quem paga) e a transportadora de um pedido que já saiu do orçamento.

1. No menu do pedido, clique em **Corrigir frete**.
2. Escolha a **Modalidade do frete** e, fora de retirada, a **Transportadora** (obrigatória em FOB, opcional em CIF).
3. Se aparecer **Como vai o transporte?**, escolha **Rodoviário** ou **Aéreo**. Serve só para definir a coluna do Kanban; em branco, o pedido fica em **Extras**.
4. Confira o quadro com **Total atual**, **Total novo** e **Frete**. Em FOB e em retirada a proposta não cobra frete, então o total cai; em CIF vale o frete cotado.
5. Clique em **Confirmar correção**.
6. Se sobrar dinheiro a favor do cliente, o botão vira **Revisar o crédito** e depois **Gravar e escolher o destino**. A correção é gravada, o crédito é aberto na Conta Corrente do cliente e você escolhe o destino: **Manter crédito para uso futuro**, **Devolver ao cliente (solicitar ao Financeiro)** ou **Abater débito existente**.
7. Se ficar valor a receber, a correção grava direto. O saldo continua sendo da proposta e é cobrado na aba Pagamentos.

### Confirmar a coleta

1. No pedido laranja (despachado, aguardando coleta), clique em **Confirmar coleta** quando a transportadora ou o motoboy levar o volume.
2. Confirme. O pedido passa para EM TRANSITO.

### Informar o rastreio e rastrear

1. O código de rastreio entra pela prepostagem ou pelo campo **Código de rastreio (manual)**, em envio pelos Correios.
2. Na lista, clique no código para copiá-lo.
3. No menu do pedido, clique em **Rastrear objeto**. A janela mostra a situação atual e os eventos; o botão de atualizar refaz a consulta.
4. Quando os Correios confirmam a entrega de um pedido em EM TRANSITO, aparece o botão **Correios confirmam a entrega — marcar ENTREGUE no sistema**.

### Confirmar a retirada no balcão

1. No pedido em A RETIRAR, clique em **Confirmar retirada**.
2. Em **Quem retirou?**, escreva o nome de quem levou o pedido.
3. Clique em **Confirmar entrega**. O pedido passa para ENTREGUE.

### Marcar como entregue

1. No pedido em EM TRANSITO, clique em **Marcar entregue**.
2. Leia o aviso, se houver, e clique em **Confirmar entrega**.

Em envio pelos Correios despachado há menos de 12 horas, o sistema avisa há quanto tempo o pedido foi postado. É só um aviso: confirmando, a entrega fica registrada com a data e a hora de agora.

### Voltar um passo

1. No menu do pedido, clique em **Voltar status**.
2. Escreva o motivo (obrigatório, mínimo de 3 letras; fica registrado).
3. Clique em **Voltar 1 passo**.

Os retornos possíveis são: ENTREGUE volta para EM TRANSITO (ou para A RETIRAR, se foi retirada); EM TRANSITO e A RETIRAR voltam para EXPEDICAO; EXPEDICAO volta para EM ACABAMENTO.

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

### Abrir o boletim da produção

1. No menu do pedido, clique em **Boletim da produção**.

### Encerrar pedido de teste

1. No menu do pedido, clique em **Encerrar teste** (só Super Administrador).
2. Confirme. O pedido sai deste painel, do painel de Produção, do Kanban e da fila de impressão.
3. Para reabrir, use o menu Ações em Orçamentos.

## Regras e bloqueios

- Não dá para despachar sem a modalidade do frete, a transportadora, o endereço de entrega, o peso aferido e a quantidade de volumes. Em retirada, basta a modalidade. O rastreio é opcional.
- A etiqueta e a prepostagem exigem os mesmos dados do despacho enquanto o pedido ainda não saiu. Imprimir etiqueta de um envio que ninguém terminou de declarar não é permitido.
- **Salvar sem despachar** e **Salvar dados** não exigem os campos mínimos: servem para guardar ou corrigir.
- Não dá para trocar o endereço de entrega nem a transportadora na Expedição. Os dois vêm da proposta. A modalidade também, quando já está definida; ela se corrige na aba Fretes da proposta ou em **Corrigir frete**.
- Falta de nota autorizada não bloqueia o despacho, mas exige marcar a confirmação.
- A trava de frete só vale em CIF. Quando o CEP de entrega ou o transporte são diferentes dos cotados, vale a última recotação feita para o CEP atual: até R$ 4,00 acima do frete da proposta só avisa; acima disso, ou sem recotação, o despacho e a prepostagem ficam bloqueados até a liberação de um administrador da Expedição.
- Peso acima do cotado (além de 200 g ou 5%, o que for maior) gera o aviso "O frete cobrado pode não refletir este envio", mas não bloqueia.
- Recotar é livre para o expedidor. **Aplicar** depende de liberação do administrador e só aceita opção que barateia ou empata o frete; com nota autorizada, só o que barateia. Não se aplica em pedido sem pagamento confirmado, em proposta avulsa, em pedido já entregue nem em pedido despachado com rastreio ou prepostagem emitidos.
- Recotação só existe em CIF e com o pedido em EXPEDICAO.
- Prepostagem só existe em CIF. Em FOB não há envio pelos Correios pelo cartão da empresa: se o pedido estava definido para os Correios, é preciso marcar **Confirmo: este pedido deixa de ir pelos Correios.**
- Depois de gerada a prepostagem, nome, endereço e telefone do destinatário ficam congelados nos Correios. Para corrigir, gere outra prepostagem e cancele a anterior no portal.
- Gerar outra prepostagem não cancela a anterior. O sistema guarda só a última anterior.
- Cada empresa posta no próprio contrato dos Correios. Sem credencial da empresa do pedido, a prepostagem é recusada.
- **Corrigir frete** só vale para pedido em EXPEDICAO ou A RETIRAR. Não aparece com nota autorizada, com despacho confirmado ou com pedido entregue. Com despacho confirmado, volte um passo antes; com nota autorizada, cancele a nota antes. Na prática, o pedido em A RETIRAR já tem o despacho confirmado, então precisa voltar um passo para ser corrigido.
- **Corrigir frete** é recusado quando o total muda e o pedido tem título ativo no Contas a Receber. Se o total não muda, a correção passa.
- **Corrigir frete** muda o total do pedido conforme a modalidade nova. A etiqueta já impressa continua válida.
- Pedido complementar não é despachado sozinho enquanto o principal não foi despachado.
- **Voltar status** no principal não volta o complemento.
- Toda mudança de status confere se o pedido ainda está no status que a tela mostrava. Se outra pessoa mexeu antes, a ação é recusada e a lista recarrega.
- Marcar a prepostagem como cancelada não apaga o código: ele só deixa de aparecer na tela.
- Pedido de teste encerrado continua acessível por busca e por endereço direto, e segue contando no faturamento.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Falta informar o peso aferido (ou a transportadora, o endereço de entrega, a quantidade de volumes, a modalidade do frete) | Falta dado mínimo do despacho | Preencher o campo indicado. Endereço e transportadora se corrigem na proposta |
| Esta proposta não tem endereço de entrega definido. Defina o endereço na proposta para poder despachar. | A proposta está sem endereço de entrega | Definir o endereço na proposta |
| Confirme o despacho sem NF | O pedido não tem nota autorizada e a caixa não foi marcada | Marcar **Despachar mesmo assim** |
| Recote o frete para o CEP de entrega antes de despachar. | Pedido CIF com CEP ou transporte diferente do cotado, sem recotação | Clicar em **Recotar frete** |
| A recotação (R$ …) passa R$ … do frete da proposta (R$ …): acima de R$ 4,00 só com liberação de ADM. | A diferença passou do limite | Pedir ao administrador da Expedição o **Liberar despacho (ADM)** |
| Só um ADM da Expedição pode liberar o despacho com essa diferença. | Quem está na tela não é administrador da Expedição | Chamar o administrador |
| Recotação bloqueada: peça a um administrador para liberar este pedido no menu Ações da Expedição. | Tentou aplicar sem liberação | Pedir **Liberar aplicação da recotação** |
| Esta opção encarece o frete em R$ … Nesta fase só é possível aplicar o que barateia ou empata. | A opção é mais cara que o frete atual | Escolher outra opção, ou seguir pelo limite de R$ 4,00 ou pela liberação do despacho |
| O preço mudou desde a consulta … Recote para confirmar. | O valor da opção mudou entre recotar e aplicar | Recotar de novo |
| Pedido sem pagamento confirmado — a recotação só se aplica depois de pago. | Tentou aplicar em pedido sem pagamento | Aguardar o pagamento |
| Recotação só em CIF; este pedido está em FOB (ou RETIRA) | A modalidade não permite recotar | Corrigir a modalidade, se for o caso |
| Correios recusaram a prepostagem | Os Correios rejeitaram os dados, ou a empresa não tem credencial | Ler o motivo exibido, corrigir e gerar de novo |
| O rótulo oficial dos Correios só existe depois da prepostagem — gere-a acima. | Envio pelos Correios sem prepostagem válida | Gerar a prepostagem |
| Este pedido é complemento do #…: o despacho é feito pelo pedido principal, e os dois saem juntos. | Tentou despachar o complemento antes do principal | Despachar o principal |
| Complemento ainda não chegou | O complemento está fora da Expedição | Esperar ou usar **Desvincular e despachar separado** com motivo |
| Complemento sem pagamento integral | O complemento está na Expedição sem estar pago por inteiro | Esperar o pagamento ou desvincular com motivo |
| Complemento não saiu junto | O principal foi despachado, mas o complemento falhou | Abrir **Despachar** no complemento |
| O pedido mudou de status em outra tela. A lista será recarregada. | Outra pessoa alterou o pedido antes | Conferir o pedido na lista recarregada |
| Pedido #… ja foi despachado. Para corrigir o frete, volte um passo… | Corrigir frete com despacho confirmado | **Voltar status** e tentar de novo |
| Pedido #… tem a NF-e … autorizada… Cancele a nota antes de corrigir o frete. | Corrigir frete com nota autorizada | Cancelar a nota antes |
| Pedido #… ainda tem … titulo(s) ativo(s) no Contas a Receber. | A correção muda o total e há título ativo | Tratar os títulos com o financeiro antes |
| "…" não tem o formato de um objeto dos Correios… | O código não é dos Correios | Consultar no site da transportadora |
| Objeto … não foi encontrado em nenhum dos contratos… | Etiqueta recém-gerada ou código errado | Aguardar alguns minutos e atualizar |
| Peso inválido / Volumes inválidos | Peso zerado ou negativo; volumes fora de 1 a 50 | Corrigir o valor |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Produção (ordens de serviço)](producao.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Notas fiscais](notas-fiscais.md)
- [Carteira (contas a receber)](carteira.md)
- [Conferência](conferencia.md)
