# Proposta: aba Fretes

> **Última revisão:** 09/10/2026
> **Caminho no menu:** Pedidos → abrir um pedido → aba Fretes
> **Endereço:** `/orcamentos/<número>/editar?tab=fretes`

## Para que serve

É onde você diz quem paga o transporte (a modalidade), quem leva a mercadoria e quanto de frete entra no total da proposta. Em CIF a tela cota o frete com os parceiros e você escolhe uma opção; em FOB você só informa a transportadora do cliente; em retirada não há nada a cotar. A escolha feita aqui segue para a ordem de serviço e chega preenchida na Expedição.

## Quem acessa

- Quem abre a proposta para editar vê a aba Fretes (bloco **7. Fretes e Entrega**).
- Na fase de orçamento (proposta em NOVO ou AGUARDANDO, com ou sem arte), quem edita a proposta escolhe a modalidade e o frete livremente.
- Depois que o pedido é liberado, trocar a modalidade, a transportadora ou o frete escolhido exige a permissão **Editar Proposta Paga**. Sem ela, os campos ficam apagados e a tela mostra o motivo.
- O bloco **Corrigir a transportadora (admin)**, com o campo do valor negociado do frete, só aparece para quem tem a permissão **Configurar Expedição**.
- Cotar e aplicar o frete complementar exige a permissão **Criar Complemento** (o mesmo botão que cria o complemento, antes chamado **Criar pedido complementar**). **O Complemento está em reformulação.** Está sendo revisto para aceitar mais de um complemento por pedido e para valer também antes da produção. Ainda não há mudança publicada, e não há data definida. Enquanto isso, vale o que esta ficha descreve: só em pedido pago, entre LIBERADO e EXPEDICAO, e com um complemento aberto por pedido. Quando a regra mudar, esta ficha muda junto.
- Proposta com cobrança gerada fica com a aba inteira travada para quem não tem a permissão de editar proposta paga (nem a de editar proposta com faturado a vencer, quando é esse o caso). Também trava enquanto houver revisão financeira pendente e em proposta avulsa já paga.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Fretes** | Barra de abas da proposta | Abre esta aba. |
| **Retira no balcão** | Caixa **Modalidade do frete — quem paga** | Marca retirada: o cliente busca a mercadoria e a proposta sai sem frete. |
| **FOB — por conta do cliente** | Caixa **Modalidade do frete — quem paga** | Marca FOB: o cliente contrata e paga o transporte; a proposta sai sem frete. |
| **CIF — por conta da empresa** | Caixa **Modalidade do frete — quem paga** | Marca CIF: a empresa contrata o transporte e o frete entra no total. Abre a cotação e os cards. |
| **Transportadora definida \*** (lista, começa em "— escolha a transportadora —") | Caixa da modalidade, em FOB | Escolhe a transportadora do cliente que vai retirar a mercadoria. |
| **Motoboy** | Ao lado da lista de transportadora, em FOB | Informa que um motoboy leva; dispensa a transportadora. Clicar de novo desmarca. |
| **Transportadora** (lista) | Caixa da modalidade, em CIF | Escolhe quem leva. Se a transportadora tem card cotado, escolhe o card dela; se não tem, cria um frete manual dela. |
| **Serviço** (lista) | Caixa da modalidade, em CIF, entre **Transportadora** e **Valor cobrado (R$)** | Escolhe o serviço da transportadora. Só aparece para transportadora com mais de um serviço: hoje, a SVT TRANSPORTES, com **AZUL ECOMM**, **AZUL STANDARD**, **AZUL EXPRESSO** e **AZUL PREMIUM**. |
| **Valor cobrado (R$)** | Caixa da modalidade, em CIF | Define quanto o cliente paga de frete. Grava ao sair do campo ou no Enter; Esc desfaz. Só edita na fase de orçamento. |
| **Rodoviário** / **Aéreo** | Pergunta **Como vai o transporte?**, na caixa da modalidade | Diz à Expedição em qual coluna o pedido entra, quando o sistema não reconhece a transportadora sozinho. Clicar de novo desmarca. |
| **Atualizar fretes** (vira **Atualizando...**) | Acima dos cards, em CIF | Refaz a cotação com o CEP do endereço e o peso atual da proposta. |
| **Escolher** | Em cada card de frete | Torna aquele card o frete da proposta. |
| **Escolhido** | Selo no card | Indica o frete que está valendo. Não é clicável. |
| **Corrigir a transportadora (admin)** (lista, com a opção "— Sem transportadora —") | Caixa da modalidade, depois da liberação | Troca só a transportadora, na hora, sem passar pelo **Salvar alterações**. |
| Campo **Frete R$** (dica: "Valor negociado do frete, em reais") | Ao lado da lista **Corrigir a transportadora (admin)** | Grava o valor negociado do frete e o novo total da proposta, ao sair do campo ou no Enter. |
| **Cotar frete complementar** (ou **Salve os itens antes de cotar**, **Salve as alterações antes de cotar**, **Cotando...**) | Card **Frete complementar do pedido #...**, em pedido complementar | Cota o frete do peso somado do pedido principal com este pedido. |
| **Aplicar** (vira **Aplicando...**) | Em cada opção da cotação complementar | Grava a diferença de frete neste pedido. |
| **Serviço / Transportadora \*** | Proposta avulsa | Campo de texto com o nome do transporte. |
| **Valor do frete (R$) \*** | Proposta avulsa | Campo com o valor do frete da proposta avulsa. |
| **Copiar resumo para WhatsApp** | Bloco **9. Envio do orçamento**, na lateral | Copia o texto do orçamento. Fica apagado, com a dica "Escolha um frete primeiro", enquanto não há frete escolhido. |
| **Salvar alterações** (em proposta nova: **Salvar proposta**) | Barra fixa no rodapé | Grava a proposta, com a modalidade, a transportadora e o frete escolhido. |
| **Cancelar** | Barra fixa no rodapé | Sai da edição. |
| **Recalcular frete** | Aviso **O frete precisa ser atualizado**, que aparece ao gerar cobrança | Traz você para esta aba para refazer o frete. |

## Passo a passo

### Escolher a modalidade

1. Abra a aba **Fretes**.
2. Na caixa **Modalidade do frete — quem paga**, clique em **Retira no balcão**, **FOB — por conta do cliente** ou **CIF — por conta da empresa**.
3. O bloco **8. Resumo do orçamento** muda na hora: em retirada e em FOB o frete zera; em CIF entra o valor do frete escolhido.
4. Clique em **Salvar alterações**. Enquanto não salvar, a tela mostra o aviso "Modalidade ainda não gravada: salve o orçamento para ela valer na OS e na Expedição."

### Cotar e escolher um frete (CIF)

1. Confira na aba **Geral** o endereço de entrega e na aba **Orçamento** os produtos: a cotação usa o CEP do endereço e o peso total da proposta, mostrado abaixo do botão **Atualizar fretes**.
2. Marque **CIF — por conta da empresa**.
3. A tela cota sozinha quando o endereço ou o peso mudam. Para cotar de novo, clique em **Atualizar fretes**.
4. Aparecem os cards das opções: **SEDEX EXPRESS** e **PAC ECONÔMICO** (Correios), **AZUL CARGO**, **TRANSP. SÃO MIGUEL**, **ENTREGA MOTOBOY** e **VEPPO**, conforme o que cada parceiro devolver para aquele destino. Cada card mostra a transportadora, o prazo, o valor e o peso usado.
5. Clique em **Escolher** no card desejado. Ele ganha o selo **Escolhido**, e os campos **Transportadora** e **Valor cobrado (R$)** acima são preenchidos com ele.
6. Clique em **Salvar alterações**.

Em cotação nova, sem escolha anterior, a tela já deixa o SEDEX escolhido; sem SEDEX, a primeira opção. Confira antes de salvar.

### Usar uma transportadora que não tem cotação (frete manual em CIF)

1. Em CIF, abra a lista **Transportadora** e escolha a transportadora.
2. Se ela não tem card cotado, a tela cria um card **MANUAL / TRANSP.** com o nome dela, prazo "A combinar" e a observação "Cadastro manual", já como **Escolhido**.
3. Digite o valor em **Valor cobrado (R$)** e saia do campo.
4. Clique em **Salvar alterações**.

A proposta tem um frete manual por vez: escolher outra transportadora sem cotação substitui o anterior.

### Escolher o serviço da transportadora (CIF)

1. Em CIF, escolha a **Transportadora**. Se ela tem mais de um serviço, a lista **Serviço** aparece ao lado.
2. Abra a lista **Serviço** e escolha. Para a SVT TRANSPORTES (Azul Cargo), as opções são **AZUL ECOMM**, que é o serviço da cotação automática, **AZUL STANDARD**, **AZUL EXPRESSO** e **AZUL PREMIUM**.
3. Se já existe card com esse serviço, ele vira o **Escolhido**. Se não existe, a tela cria um card **MANUAL / TRANSP.** com o nome do serviço, prazo "A combinar" e o valor que estava em **Valor cobrado (R$)**.
4. Confira ou digite o valor em **Valor cobrado (R$)** e saia do campo.
5. Clique em **Salvar alterações**.

O serviço escolhido é o nome que aparece na coluna **Envio** da lista de Pedidos e na coluna de frete da Expedição. Quem não mexe na lista **Serviço** continua com o frete como estava.

### Cobrar um valor diferente do cotado (CIF)

1. Escolha o frete.
2. Digite o valor em **Valor cobrado (R$)** e pressione Enter ou saia do campo. O card escolhido e o total passam a mostrar esse valor.
3. Clique em **Salvar alterações**.

Clicar em **Atualizar fretes** depois disso devolve o valor cotado ao card da parceira. No frete manual o valor digitado fica.

### Informar a transportadora do cliente (FOB)

1. Marque **FOB — por conta do cliente**.
2. Em **Transportadora definida \***, escolha a transportadora que o cliente contratou. Se quem leva é um motoboy, clique em **Motoboy** no lugar.
3. Se aparecer a pergunta **Como vai o transporte?**, marque **Rodoviário** ou **Aéreo**. Deixar em branco também vale: o pedido entra em Extras na Expedição.
4. Clique em **Salvar alterações**.

Em FOB não há cards de cotação. A tela mostra: "Em FOB o cliente contrata e paga o transporte — não há cotação a escolher. Defina acima quem leva: a transportadora ou o motoboy."

### Marcar retirada no balcão

1. Clique em **Retira no balcão**.
2. Clique em **Salvar alterações**.

Não há transportadora nem cotação: "Na retirada em balcão o cliente busca a mercadoria — não há transporte a cotar nem transportadora a definir."

### Informar o frete de uma proposta avulsa

1. Escolha a modalidade.
2. Preencha **Serviço / Transportadora \*** (por exemplo, "Transportadora Própria / PAC") e **Valor do frete (R$) \***.
3. Clique em **Salvar alterações**.

A proposta avulsa não tem cotação nem cards.

### Trocar o frete depois que o pedido foi liberado

1. Abra a aba **Fretes**. Abaixo da modalidade aparece um quadro com o aviso do que a troca faz, ou, se a troca estiver bloqueada, com o motivo.
2. Se os campos estão livres, troque a modalidade, a transportadora ou clique em **Escolher** em outro card.
3. Clique em **Salvar alterações**. O frete e o total são recalculados.
4. Se a proposta já tem pagamento e o total subiu, a diferença aparece na aba **Pagamentos** para cobrança, e a proposta fica aguardando essa cobrança. Pedido em produção continua na produção.

Depois da liberação o campo **Valor cobrado (R$)** fica só para leitura: o valor muda pelo valor negociado (tarefa seguinte).

### Corrigir só a transportadora ou o valor negociado (administrador da Expedição)

1. Em proposta já liberada, localize **Corrigir a transportadora (admin)** na caixa da modalidade.
2. Para trocar quem leva, escolha a transportadora na lista. A troca é gravada na hora, sem o **Salvar alterações**, e não mexe na modalidade nem no valor do frete. A Expedição vê a troca no próximo carregamento da tela.
3. Para mudar o valor que o cliente paga, digite no campo **Frete R$** e pressione Enter ou saia do campo. O frete e o total da proposta são gravados juntos.
4. Leia o aviso que aparece: ele mostra o total anterior e o novo, o saldo a cobrar na aba **Pagamentos** quando houver, e a mudança de status quando houver.

### Acompanhar Pedido (pedidos que saem juntos)

Use quando pedidos do mesmo cliente (ou do mesmo pagador) devem sair da Expedição todos ao mesmo tempo, cada um com o seu próprio despacho, a sua etiqueta e a sua cobrança. Não existe divisão de frete nem vínculo financeiro entre eles.

1. Na aba **Fretes**, logo abaixo da caixa **7. Fretes e Entrega**, marque **Acompanhar Pedido**. A tela mostra: "Os pedidos marcados só saem da Expedição juntos; cada um segue com o seu próprio despacho, a sua etiqueta e a sua cobrança".
2. Escolha os pedidos na lista. Ela mostra os 10 pedidos mais recentes do mesmo cliente ou pagador que ainda estão em aberto, com número, cliente, status e data. "Em aberto" vale desde o status NOVO: o vínculo pode ser feito antes de o pedido chegar à Expedição. Não entram pedidos cancelados, já despachados (A RETIRAR, EM TRANSITO, ENTREGUE, RECEBIDO), avulsos ou de teste encerrado. Para achar outro, digite o número em **Buscar pedido por número**: a busca procura entre todos os pedidos elegíveis, não só os 10 da lista. Pedido que já está em outro grupo Acompanhar aparece apagado, com o motivo.
3. A escolha é gravada na hora, sem o **Salvar alterações**, e vale mesmo com a edição bloqueada por cobrança. O grupo aceita no máximo 10 pedidos.
4. Nos outros pedidos do grupo a aba mostra o mesmo grupo marcado; marcar mais um pedido a partir de qualquer um deles entra no mesmo grupo.
5. Para tirar um pedido do grupo, desmarque-o na lista. Desmarcar **Acompanhar Pedido** tira só este pedido. O grupo se desfaz quando sobra um pedido. Se a ligação foi criada por outra pessoa, só quem a criou ou o administrador da Expedição consegue soltar; fora disso a tela explica a recusa.
6. Em pedido cancelado, já despachado ou avulso, a caixa fica só para leitura e a tela diz o motivo (por exemplo "Pedido já despachado."). Na visualização do pedido aparece a linha **Acompanha: #A, #B**.
   Se o pedido ainda não chegou à Expedição (por exemplo, está em NOVO), a tela avisa: "Este pedido ainda não chegou à Expedição: o grupo só despacha quando todos chegarem. Para soltar: peça a um administrador da Expedição." Pedido cancelado deixa de segurar o grupo.
7. Na Expedição, os pedidos do grupo mostram o selo rosa **Vinculados**; nenhum deles é despachado nem tem etiqueta gerada até todos estarem prontos. Depois disso, cada um sai e imprime a sua etiqueta separadamente.

### Aplicar o frete complementar (pedido complementar)

1. Abra o pedido complementar e inclua os produtos na aba **Orçamento**. Salve.
2. Na aba **Fretes**, no card **Frete complementar do pedido #...**, clique em **Cotar frete complementar**.
3. A tela mostra o peso do pedido principal, o peso deste pedido, o peso somado, o frete já cobrado no principal e as opções cotadas. A opção do mesmo serviço do principal vem com o selo **Mesmo serviço do #...**.
4. Em cada opção, confira **A cobrar aqui** e clique em **Aplicar** na escolhida.
5. A tela confirma com "Frete complementar aplicado" e o valor a cobrar neste pedido. O total do pedido complementar passa a incluir essa diferença.

### Quando a cobrança do complementar fica presa no frete

**O sintoma.** Ao gerar a cobrança do complementar aparece a janela "O frete precisa ser atualizado", com os botões **Voltar** e **Recalcular frete**. Na aba **Fretes**, ao clicar em **Aplicar** no frete complementar, aparece em vermelho que a opção escolhida não apareceu na cotação de agora. Um botão leva ao outro, e a cobrança não sai.

**A causa.** As opções de **Motoboy**, **Transportadora São Miguel** e **VEPPO** tinham um identificador que mudava a cada cotação, então a aplicação não encontrava a opção escolhida. Corrigido em 08/10/2026. Correios e Azul Cargo nunca foram afetados.

**O que fazer:**

1. Abra a aba **Fretes** do pedido complementar e clique em **Cotar frete complementar**.
2. Confira **A cobrar aqui**: é a diferença, ou seja, o frete do peso somado dos dois pedidos menos o que o pedido principal já cobra.
3. Clique em **Aplicar** na opção escolhida e espere a confirmação.
4. Só então vá à aba **Pagamentos** e gere a cobrança.

Repetir **Aplicar** não duplica: a segunda tentativa devolve o mesmo frete complementar que já está aplicado.

**O frete complementar é devido.** O crédito do cliente na Conta Corrente pode ser usado para quitar a cobrança, pelo fluxo oficial e com autoria registrada, mas não dispensa o frete nem autoriza editar o valor da cobrança.

**Casos parecidos, e como diferenciar:**

- Complementar em **RETIRA** ou **FOB**: não há frete a cobrar, e o card diz isso. Ainda assim a cobrança fica bloqueada pela janela "O frete precisa ser atualizado". É problema conhecido e **sem solução publicada**: não existe caminho na tela para liberar. Registre e peça ajuda.
- Complementar que vai por **Correios** ou **Azul Cargo**: segue o caminho normal, cotar e aplicar.

**O que não fazer:** não insistir em **Aplicar** e em **Recalcular frete** em laço; não gerar a cobrança por outro caminho para driblar o bloqueio, porque ela sai sem o frete; não editar o valor da cobrança; não salvar o pedido para "consertar".

| Pergunta do usuário | O que verificar | O que fazer | Quando chamar o suporte |
|---|---|---|---|
| "Não consigo gerar a cobrança deste pedido" | É pedido complementar? Tem frete complementar aplicado na aba **Fretes**? | Cotar, aplicar e só então gerar a cobrança | Se a aplicação recusar de novo depois de cotar outra vez |
| "Aparece em vermelho que a opção não está na cotação" | Qual transporte, e a página está atualizada | Recarregar a página, cotar de novo e aplicar | Se repetir com a página recarregada |
| "É retirada ou FOB e a cobrança não sai" | O card diz "sem frete a cobrar" | Não há frete a aplicar | Sempre: é problema conhecido, sem solução publicada |
| "Apliquei duas vezes, cobrou em dobro?" | O frete no total do pedido complementar | Nada: repetir não duplica | Se o total mostrar o frete duas vezes |

## Regras e bloqueios

- Retirada e FOB não cobram frete: o total da proposta sai sem frete, qualquer que seja a cotação. Só CIF cobra.
- Em CIF não dá para salvar sem um frete escolhido. Em FOB não dá para salvar sem a transportadora ou o **Motoboy**. Em retirada não é preciso escolher nada.
- Sem modalidade marcada, a tela não mostra cards e pede: "Escolha a modalidade do frete acima para continuar."
- Trocar de modalidade limpa a transportadora (fora de FOB) e desfaz a escolha de retirada. Confira a caixa da modalidade depois de trocar.
- A modalidade e a transportadora só valem depois do **Salvar alterações**.
- A cotação usa o CEP do endereço de entrega e o peso total da proposta. Os volumes são calculados pelo sistema, um a cada 14,5 kg.
- O botão **Atualizar fretes** fica apagado sem CEP válido de 8 dígitos, sem produto com peso ou sem endereço de entrega escolhido.
- A Azul Cargo não é cotada para entrega no Rio Grande do Sul.
- A cotação automática da Azul Cargo traz só o serviço ECOMM, que na lista **Serviço** aparece como **AZUL ECOMM**. **AZUL STANDARD**, **AZUL EXPRESSO** e **AZUL PREMIUM** não são cotados: entram como frete manual, com o valor digitado em **Valor cobrado (R$)**.
- Proposta gravada com o frete "ECOMM", inclusive a que veio da cotação automática, abre com **AZUL ECOMM** selecionado na lista **Serviço**. O card, a coluna **Envio** e a Expedição continuam mostrando "ECOMM" nessas propostas: o texto só muda quando alguém escolhe outro serviço e salva.
- A lista **Serviço** mostra "— escolha o serviço —" quando o frete atual não é nenhum serviço da lista, como no frete manual com o nome da transportadora. Deixar assim não muda nada.
- Depois do despacho, a Expedição mostra o nome da transportadora, e não mais o serviço.
- O card da Azul Cargo mostra, abaixo do valor, a linha "Original: R$ ... (+15%)" e o peso em kg com a quantidade de volumes.
- Mudar o endereço de entrega desfaz o frete escolhido: é preciso escolher de novo. Mudar só o peso mantém a escolha quando a mesma opção volta na cotação nova.
- Se o frete escolhido não volta na cotação nova, ele fica preservado e a tela avisa **Cotação Defasada**. Revise antes de salvar.
- Ao reabrir uma proposta em CIF, a tela mostra o frete gravado e busca sozinha as outras opções, sem mudar o valor do escolhido.
- Se o peso da proposta mudar depois da cotação, não dá para gerar cobrança enquanto o frete não for refeito aqui. Frete de valor zero não bloqueia.
- Depois da liberação, salvar a proposta sem mexer na modalidade, na transportadora ou no card não altera o frete gravado. É assim que o valor negociado e a recotação feita na Expedição não se perdem.
- Depois da liberação, a troca de frete é bloqueada em três casos, e a tela diz qual: quem está logado não tem a permissão de editar proposta paga; o pedido tem NF-e autorizada (cancele a nota antes); o pedido já foi despachado (volte um passo no painel da Expedição).
- A lista **Corrigir a transportadora (admin)** troca a transportadora mesmo com o pedido já despachado. Ela mexe só em quem transporta.
- O campo **Frete R$** não aceita valor em FOB nem em retirada, porque nessas modalidades o cliente não paga frete à empresa.
- O valor negociado é recusado quando a proposta tem cobrança faturada a vencer, quando tem cobrança enviada ao cliente e ainda não paga (cancele a cobrança antes, na aba **Pagamentos**), quando é avulsa já paga, quando é pedido complementar, e quando o valor novo deixaria crédito a favor do cliente em proposta que não estava integralmente paga.
- Escolher um card dos Correios (SEDEX ou PAC) vincula ao pedido o cadastro dos Correios, que desde 08/10/2026 é o da **Superintendência Estadual RS** (o anterior era o da sede em Brasília). É esse cadastro que vai para a nota fiscal como transportador. Pedido antigo continua com o cadastro anterior, e os dois seguem valendo como Correios no sistema.
- Na tela, os dois cadastros dos Correios aparecem como **Correios**, e não pela fantasia do cadastro. As outras transportadoras continuam aparecendo pelo nome de sempre.
- Em pedido complementar, a modalidade e a transportadora vêm do pedido principal e ficam travadas. Não há cards nem **Atualizar fretes**.
- Pedido complementar fora de CIF não cobra frete: a tela mostra "... herdado do pedido #... — sem frete a cobrar neste pedido."
- O frete complementar é só a diferença entre a cotação do peso somado e o frete que o pedido principal já cobra. Se o somado sair mais barato, este pedido cobra R$ 0,00 e nada é creditado. O pedido principal não é alterado.
- O frete complementar só pode ser aplicado com o pedido complementar em NOVO ou AGUARDANDO, com o pedido principal entre LIBERADO e EXPEDICAO e ainda sem despacho, e com os dois pedidos no mesmo endereço de entrega.
- Não dá para gerar cobrança de um pedido complementar antes de aplicar o frete complementar. Isso vale também para o complementar em RETIRA ou FOB, que não tem frete a aplicar: hoje ele fica bloqueado, e é problema conhecido, sem solução publicada.
- Clicar em **Aplicar** de novo no frete complementar não duplica: a segunda tentativa devolve o frete que já está aplicado.

## O que não confundir

- **Modalidade** e **transportadora**: a modalidade diz quem paga o transporte; a transportadora diz quem leva. SEDEX, por exemplo, pode levar tanto em CIF quanto em FOB.
- **Retira no balcão** e **FOB — por conta do cliente**: nas duas a proposta sai sem frete, mas em retirada o cliente busca e não há transportadora; em FOB há uma transportadora (ou motoboy) do cliente, obrigatória.
- Botão **Motoboy** (FOB) e card **ENTREGA MOTOBOY** (CIF): o botão só informa que um motoboy do cliente leva, sem valor; o card é uma opção cotada que a empresa contrata e cobra.
- **Valor cobrado (R$)** e campo **Frete R$**: o primeiro vale na fase de orçamento e grava com o **Salvar alterações**; o segundo é o valor negociado, só para administrador da Expedição, depois da liberação, e grava na hora.
- Valor do card e **Valor cobrado (R$)**: o card nasce com o valor cotado pelo parceiro; o valor cobrado é o que o cliente paga e pode substituir o cotado.
- **Transportadora definida \*** (FOB), **Transportadora** (CIF) e **Corrigir a transportadora (admin)**: as duas primeiras gravam com o **Salvar alterações**; a terceira grava sozinha e só existe depois da liberação.
- **Cotação desatualizada**, **Cotação Defasada** e **O frete precisa ser atualizado**: o primeiro avisa que o CEP ou o peso mudaram e a cotação precisa ser refeita; o segundo avisa que o frete escolhido não voltou na cotação nova; o terceiro é o bloqueio ao gerar cobrança com peso diferente do cotado.
- **Transportadora** e **Serviço** (CIF): a transportadora é quem leva (SVT TRANSPORTES); o serviço é o que foi contratado com ela (AZUL ECOMM, AZUL STANDARD, AZUL EXPRESSO ou AZUL PREMIUM). O nome que segue para a lista de Pedidos e para a Expedição é o do serviço.
- **Atualizar fretes** e **Cotar frete complementar**: o primeiro cota o frete inteiro de uma proposta comum em CIF; o segundo cota só a diferença de um pedido complementar.
- O aviso **Cotação desatualizada** manda clicar em "Atualizar frete", no singular; o botão na tela se chama **Atualizar fretes**.
- Recotação de frete no despacho: é feita na Expedição, no despacho do pedido, e não nesta aba.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "CEP não encontrado" — "Selecione um endereço de entrega válido com CEP para cotar." | A proposta está sem endereço de entrega, ou o endereço está sem CEP. | Escolha o endereço na aba **Geral** e volte para cotar. No orçamento rápido, preencha o CEP de entrega. |
| "Peso inválido" — "Adicione pelo menos um produto com peso maior que zero para cotar." | A proposta não tem produto com peso. | Inclua os produtos na aba **Orçamento**. |
| "Falha na cotação de todos os fretes" | Nenhum parceiro respondeu à cotação. | Tente **Atualizar fretes** de novo em instantes. |
| "Cotação parcial realizada" — "Alguns serviços falharam: ..." | Um ou mais parceiros não responderam; os outros vieram. | Escolha entre as opções que vieram, ou atualize de novo. |
| "Nenhum frete cotado para esta proposta." | Em CIF, ainda não há cotação. | Confira endereço e produtos e clique em **Atualizar fretes**. |
| "Frete não selecionado" — "Selecione ou informe o frete antes de salvar o orçamento." | Em CIF, nenhum card está como **Escolhido**. | Clique em **Escolher** em um card ou escolha a **Transportadora**. |
| "Transportadora obrigatória em FOB" — "Escolha a transportadora que vai retirar, ou marque Motoboy, antes de salvar o orçamento." | FOB sem transportadora e sem **Motoboy**. | Preencha **Transportadora definida \*** ou clique em **Motoboy**. |
| "Frete obrigatório" ou "Transportadora obrigatória" | Proposta avulsa sem o valor do frete ou sem o nome do serviço. | Preencha **Valor do frete (R$) \*** e **Serviço / Transportadora \***. |
| "Modalidade ainda não gravada: salve o orçamento para ela valer na OS e na Expedição." | A modalidade ou a transportadora foi trocada e ainda não foi salva. | Clique em **Salvar alterações**. |
| "Cotação desatualizada" | O CEP, o peso ou os volumes mudaram depois da última cotação. | Clique em **Atualizar fretes**. |
| "Cotação Defasada" — "Frete escolhido anteriormente não retornou na nova cotação. Revise antes de salvar." | A opção escolhida não veio na cotação nova. | Escolha outra opção ou confirme que o frete preservado ainda vale. |
| "Troca de frete bloqueada" — "Voce nao tem permissao para corrigir o frete de um pedido ja liberado." | Pedido já liberado e o seu perfil não tem a permissão de editar proposta paga. | Peça a troca a quem tem a permissão. |
| "Troca de frete bloqueada" — "Pedido #... tem a NF-e ... autorizada. ... Cancele a nota antes de corrigir o frete." | A nota já foi transmitida com o valor atual. | Cancele a nota em Notas fiscais e refaça a troca. |
| "Troca de frete bloqueada" — "Pedido #... ja foi despachado. Para corrigir o frete, volte um passo pelo menu Acoes do painel da Expedicao e tente de novo." | O despacho já foi confirmado. | Volte um passo na Expedição. Para trocar só a transportadora, o administrador usa **Corrigir a transportadora (admin)**. |
| "O frete precisa ser atualizado" (ao gerar cobrança) | O peso da proposta mudou depois da cotação, ou o pedido complementar está sem o frete complementar aplicado. | Clique em **Recalcular frete**, refaça o frete nesta aba e gere a cobrança de novo. |
| "Frete não gravado" | O valor negociado foi recusado; a descrição diz o motivo (faturado a vencer, cobrança enviada e não paga, modalidade sem frete, entre outros). | Siga a orientação da mensagem. Nada foi alterado. |
| "Frete gravado, mas com pendência" | O valor foi gravado, mas a diferença financeira não foi tratada. | Avise o financeiro e confira a aba **Pagamentos**. |
| "O preço mudou desde a consulta: R$ ... agora, R$ ... na sua tela. Cote de novo para confirmar." | O frete complementar mudou de preço entre a cotação e o **Aplicar**. | Clique em **Cotar frete complementar** de novo e aplique. |
| "A opção escolhida não apareceu na cotação de agora — cote e escolha de novo." | A opção não veio na recotação feita ao aplicar. Até 08/10/2026 isso acontecia sempre com Motoboy, Transportadora São Miguel e VEPPO, por causa do identificador que mudava a cada cotação (corrigido no commit `2387164`). Agora só acontece quando a opção de fato sumiu, ou quando a página ficou aberta desde antes da correção. | Recarregue a página, clique em **Cotar frete complementar** e aplique de novo. |
| "Nenhuma transportadora devolveu cotação agora — tente de novo em instantes." | A cotação complementar voltou sem opções. | Tente de novo em instantes. |
| "O frete complementar só entra em NOVO ou AGUARDANDO; o pedido #... está em ..." | O pedido complementar já avançou de status. | O frete complementar não pode mais ser aplicado nesse status. |
| "O pedido #... já tem despacho registrado" | O pedido principal já saiu. | Não há mais frete somado a cotar; o pedido complementar precisa de frete próprio. |
| "Frete complementar invalidado" | O pedido foi desvinculado do principal. | Refaça o frete do pedido antes de gerar a cobrança. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Expedição](expedicao.md)
- [Notas fiscais](notas-fiscais.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/orcamentos/lib/modalidade-frete.ts`
- `src/features/orcamentos/lib/categoria-frete.ts`
- `src/features/orcamentos/lib/servicos-transportadora.ts`
- `src/features/orcamentos/components/FreteComplementarCard.tsx`
- `src/features/orcamentos/components/AcompanharPedidoCard.tsx`
- `src/features/orcamentos/lib/acompanhar-pedido.ts`
- `src/app/api/orcamentos/acompanhar/route.ts`
- `src/features/orcamentos/services/frete.service.ts`
- `src/features/orcamentos/services/frete-desatualizado.ts`
- `src/features/orcamentos/services/valor-frete-negociado.ts`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/expedicao/services/corrigir-frete-simulacao.ts`
- `src/features/expedicao/types.ts`
- `src/app/api/propostas/valor-frete/route.ts`
- `src/app/api/propostas/transportadora/route.ts`
- `src/app/api/orcamentos/complementar/cotar-frete/route.ts`
- `src/app/api/orcamentos/complementar/aplicar-frete/route.ts`
- `src/features/orcamentos/lib/transportadoras-parceiras.ts`

> **Mudanças de 08/10/2026:**
>
> - o identificador das opções de Motoboy, Transportadora São Miguel e VEPPO deixou de mudar a cada cotação, e por isso o frete complementar desses transportes volta a ser aplicado (commit `2387164`);
> - o pedido novo com frete dos Correios passa a apontar para o cadastro da Superintendência Estadual RS dos Correios, e a transportadora aparece como **Correios** em vez da fantasia do cadastro;
> - a ação **Criar pedido complementar** passou a se chamar **Criar Complemento** (commit `dd9a110`), só no nome.
>
> - nova seção **Acompanhar Pedido** na aba Fretes: pedidos do mesmo cliente ou pagador que só saem da Expedição juntos.
>
> - **09/10/2026:** o Acompanhar Pedido vale para qualquer pedido em aberto, inclusive em NOVO e AGUARDANDO (antes só de APROVADO até EXPEDICAO); a busca por número procura entre todos os pedidos elegíveis; a mensagem de só leitura diz o motivo real.
