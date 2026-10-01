# Pedidos (lista)

> **Última revisão:** 01/10/2026
> **Onde fica:** menu → Pedidos (endereço `/orcamentos`)

## Para que serve

É a lista de todas as propostas e pedidos da casa. Daqui você acompanha em que pé cada pedido está (financeiro, arte, produção e envio), encontra um pedido específico e abre a proposta para trabalhar nela.

Os cards do topo mostram as filas que pedem atenção, e a ordem e as cores da lista colocam na frente o que está parado esperando alguém.

No alto da tela o título aparece como "Orcamentos", com a etiqueta "Pedidos". É a mesma tela.

## Quem acessa

- Todo usuário logado vê o item **Pedidos** no menu e abre a tela. É também a página inicial de quem é vendedor e dos perfis que não têm outra página inicial definida.
- Quem tem o perfil configurado para ver apenas as próprias propostas (por exemplo, o perfil Atendente) só enxerga os pedidos em que aparece como atendente. Quem vê todas as propostas (Gerente comercial, Super Administrador e perfis sem restrição de escopo) enxerga a lista inteira.
- **Cancelar proposta**: só o Super Administrador e quem tem a permissão "Cancelar Propostas" (o perfil Gerente comercial já vem com ela).
- **Criar pedido complementar**: só quem tem a permissão "Criar Pedido Complementar".
- **Retirar da Produção**: só administrador, Super Administrador ou quem tem a permissão "Liberar para Produção".
- **Encerrar teste** e **Reabrir (desfazer encerramento de teste)**: só o Super Administrador.
- **Voltar para a Fila de Faturamento (desfazer nota no sistema antigo)**: só administrador, Super Administrador ou quem tem a permissão "Liberar para Nota Fiscal".
- As demais ações do menu da linha aparecem para qualquer usuário que vê o pedido. O que cada um consegue alterar dentro da proposta é decidido na própria proposta.

## Passo a passo

### Entender os cards do topo

Cada card mostra uma quantidade e, embaixo, "Soma em" seguido do período e do valor total. Clicar no card filtra a lista; clicar de novo desliga o filtro. Ligar um card volta o filtro de status para **Todos status**.

1. **Pedidos**: tudo o que a lista trouxe. Com este card ligado, os pedidos entregues também entram na lista.
2. **Em arte**: pedidos cujo Status Arte é Em Arte, Enviar Arte, Em Aprovação, Em Alteração, Apr Parcial (ou Aprovado Parcial), Dados Pendentes, Corrigir Dados ou Pendente Informação. O card fica laranja quando pelo menos um dos pedidos contados está em Pendente Informação ou Corrigir Dados.
3. **Arte Aprovada**: pedidos com Status Arte APROVADO que ainda não foram liberados para a produção. Saem do card os que já estão em produção, na expedição, a retirar, em trânsito ou entregues.
4. **Liberadas**: pedidos com status exatamente "Liberado". Os que aparecem como "Liberado / EM ARTE" não entram aqui.
5. **Revisão atendente**: pedidos em REVISAO ATENDENTE, que esperam o atendente conferir e liberar para a produção.
6. **Em produção**: pedidos em REVISAO PRODUCAO, EM PRODUCAO, EM IMPRESSAO ou EM ACABAMENTO (com ou sem "/ PENDENTE").

Os cards respeitam os filtros de modelo, vendedor e tipo de cobrança.

### Procurar um pedido

1. Digite no campo **Buscar por proposta, cliente, ID cliente, valor ou OS Ideal**. A lista atualiza sozinha depois de uma pequena pausa na digitação.
2. A busca procura na base inteira por: número do pedido, código do cliente, nome do cliente, nome do atendente, nome de quem está indicado para a nota fiscal e nome do evento.
3. Com texto na busca, o período deixa de valer (os cards passam a mostrar "Soma em todos os períodos") e os pedidos entregues e os testes encerrados voltam a aparecer.
4. Para voltar ao normal, clique em **Limpar filtros**.

### Filtrar a lista

1. **Todos status**: escolha um status para ver só os pedidos nele. A opção EM ARTE traz todos os que têm "/ EM ARTE" no status. Escolher um status desliga o card que estiver ligado.
2. **Todos modelos**: AVULSO, PROPOSTA ou ENCERRADOS (teste). Esta última mostra só os pedidos de teste encerrados.
3. **Todos produtos**: abre uma lista com busca por **Código ou nome**. Mostra os pedidos que têm pelo menos um item daquele produto. Produtos desativados aparecem com a marca "inativo".
4. **Todos vendedores**: escolha um atendente.
5. **Todas cobranças**: PIX, BOLETO, E-FATURADO ou CARTÃO.
6. **Período**: a tela abre em **15 dias**, que traz os pedidos alterados nos últimos 15 dias (não os criados). As outras opções são os seis últimos meses e trazem os pedidos criados naquele mês.
7. Os filtros se combinam. **Limpar filtros** devolve tudo ao padrão.

Os filtros ficam guardados no endereço da página: continuam valendo ao atualizar a tela, ao sair e voltar, e num link copiado para outra pessoa.

### Ler a ordem e as cores da lista

A lista vem em grupos, nesta ordem. Dentro de cada grupo, vem primeiro o pedido cujo status mudou por último.

1. **Revisão atendente**, com fundo azul claro. É a fila que trava o fluxo, por isso fica no topo.
2. **Financeiro liberado** (inclusive os que ainda estão em arte), exceto avulsos, com fundo verde claro e o valor em verde.
3. **Aguardando financeiro**, com fundo amarelo, a mesma cor da linha na Conferência.
4. **Pago / A liberar**, com fundo azul bem claro.
5. Os demais, sem cor.

Com o card **Em arte** ligado, a ordem passa a ser primeiro pelo Status Arte, e dentro de cada um vale a ordem acima:

1. Enviar Arte, com fundo laranja.
2. Pendente Informação, com fundo vermelho.
3. Em Alteração.
4. Dados Pendentes e Corrigir Dados.
5. Em Aprovação.
6. Apr Parcial e Aprovado Parcial.
7. Em Arte.
8. Os demais.

No celular a lista vira cartões, e só a revisão atendente ganha fundo azul.

### Ler as colunas e saber para onde cada clique leva

1. **N°**: número do pedido.
2. **id - Cliente**: código e nome fantasia do cliente (ou a razão social, quando não há fantasia). Sem cliente cadastrado aparece a marca "Sem cadastro". Abaixo podem aparecer "Nota fiscal:" com o nome de quem vai receber a nota, quando é outra pessoa que não o cliente, e o nome do evento, quando o pedido tem arte. Clicar nesta coluna abre o cadastro do cliente; sem cadastro, abre a proposta.
3. **Tipo cobrança / Valor total**: o tipo de cobrança ("Não gerada" quando ainda não há cobrança), o valor total e, abaixo, a data e a hora do registro de pagamento mais recente. Clicar abre a proposta na aba Pagamentos.
4. **Atendente**: o atendente e, abaixo, o designer, quando o pedido tem arte.
5. **Status**: o status do pedido e, abaixo, a data e a hora da última mudança de status (ou a data de criação, se o status nunca mudou). Podem aparecer ainda: o selo **Pago / A liberar** (o cliente pagou e o financeiro ainda não confirmou), o texto "Nota emitida · nº", e as marcas "teste encerrado", "faturado no sistema antigo" e "Compl. de #" (pedido complementar de outro).
6. **Status Arte**: a situação da arte e, abaixo, a data e a hora da última mudança dela. Fica vazio em pedido sem arte. O botão ao lado, quando existe, abre o painel do cliente em nova aba.
7. **Envio**: o transporte do pedido (SEDEX, RETIRADA, a transportadora, o motoboy); "—" em pedido antigo sem essa informação. Com o card **Em produção** ligado, aparece abaixo o prazo e a hora do boletim. Clicar abre a proposta na aba Fretes.
8. **Ações**: o botão do chat interno (muda de cor com mensagem não lida, pendência ou recusa, e mostra a quantidade de não lidas), o botão de baixar a DANFE (quando há nota autorizada; com mais de uma nota ele abre a lista para escolher) e o menu da linha.

Clicar em qualquer outro ponto da linha abre a proposta em edição, na aba Produtos (na aba Pagamentos, se for avulsa).

As datas pequenas aparecem como dia/mês e hora, no horário de Brasília.

### Usar o menu de ações da linha

1. **Ver proposta**: abre a proposta só para leitura.
2. **Ver chat interno**: abre o chat do pedido. Mostra quantas mensagens não lidas há.
3. **Editar proposta**: abre a proposta em edição.
4. **Duplicar proposta**: pede confirmação, cria uma cópia e abre a cópia em edição.
5. **Criar pedido complementar**: abre a confirmação para criar um pedido novo do mesmo evento. Aparece só em proposta que não é avulsa, não é ela mesma um complemento e está entre LIBERADO e EXPEDICAO.
6. **Copiar proposta informal**: copia o resumo do pedido, pronto para colar no WhatsApp.
7. **Link pgto. externo**: copia o link da área do cliente para pagamento.
8. **Gerar PDF da proposta**: gera o PDF e abre em nova aba.
9. **Abrir DANFE (PDF)** e **Baixar XML**: aparecem quando o pedido tem nota autorizada.
10. **Gerar cobrança**: abre a geração de cobrança. Não aparece em pedido sem cliente cadastrado.
11. **Cancelar proposta**: abre a janela de cancelamento, que exige o **Motivo do Cancelamento**.
12. **Liberar para Produção**: aparece em pedido não avulso que está em REVISAO ATENDENTE e ainda não foi liberado. Depois de liberado, no lugar dela fica o aviso **✓ Liberada para produção**, que não é clicável.
13. **Rastrear objeto**: aparece quando o envio é pelos Correios e já existe código de rastreio.
14. **Encerrar teste** ou **Reabrir (desfazer encerramento de teste)**.
15. **Voltar para a Fila de Faturamento (desfazer nota no sistema antigo)**: aparece só no pedido com a marca "faturado no sistema antigo".
16. **Retirar da Produção**: último item do menu, só em pedido já liberado.

### Liberar um pedido para a produção

1. Clique no card **Revisão atendente** para ver a fila.
2. No menu da linha, clique em **Liberar para Produção**.
3. Leia o aviso e clique em **Confirmar liberação**.
4. Se tudo estiver certo, aparece "Proposta liberada" e o pedido passa para REVISAO PRODUCAO. Se houver pendência, o aviso diz qual é.

### Achar o que a lista esconde

1. **Entregues**: escolha ENTREGUE no filtro de status, digite algo na busca ou ligue o card **Pedidos**.
2. **Testes encerrados**: escolha **ENCERRADOS (teste)** no filtro de modelos, ou digite algo na busca. Eles aparecem com a marca "teste encerrado".
3. **Pedidos de outro mês**: troque o período, ou use a busca ou qualquer outro filtro, que passam a procurar em todos os períodos.
4. **Cancelados**: não aparecem nesta lista. O filtro de status não tem a opção CANCELADO e a busca não os traz.

### Mudar de página

1. A lista traz 100 pedidos por página. O rodapé mostra "Página X de Y", quantas propostas há na página e o "Total de propostas encontradas".
2. Use **Anterior** e **Próxima**.

## Regras e bloqueios

- Proposta cancelada nunca aparece em card nenhum, nem na contagem nem na lista do card.
- A lista padrão esconde os pedidos cancelados, os entregues e os testes encerrados. Entregue já saiu do fluxo; teste encerrado não é pedido de verdade.
- Os cards **Em arte** e **Arte Aprovada** contam o período inteiro. Os cards **Pedidos**, **Liberadas**, **Revisão atendente** e **Em produção** contam apenas os pedidos carregados na página atual (até 100). Com mais de uma página, o número desses quatro cards é menor que o total real; o total está no rodapé, em "Total de propostas encontradas".
- Com busca ou com qualquer filtro de status, modelo, produto, vendedor ou cobrança, o período é ignorado e a lista traz no máximo 100 pedidos, sem outras páginas. Se o que você procura não aparecer, refine a busca.
- O período **15 dias** olha a data da última alteração do pedido; os meses olham a data de criação. Por isso um pedido antigo que foi mexido esta semana aparece em 15 dias e não aparece no mês atual.
- O card **Em arte** olha o Status Arte, e não o "/ EM ARTE" do status do pedido. Os dois podem divergir: um pedido pode mostrar "/ EM ARTE" no status e estar fora do card, e o contrário.
- O card **Liberadas** não conta os pedidos "Liberado / EM ARTE". Eles aparecem em **Em arte**, se o Status Arte for um dos que entram naquele card.
- O selo **Pago / A liberar** não muda o status do pedido: ele continua "Aguardando" até o financeiro confirmar. O selo existe para ninguém mexer na proposta achando que o dinheiro não entrou.
- Não dá para liberar para a produção um pedido que não está em REVISAO ATENDENTE, que é avulso ou que já foi liberado. A liberação também é recusada se houver pagamento não confirmado, arte que não está APROVADO ou produto cuja quantidade vendida não bate com a soma dos lotes.
- **Retirar da Produção** não é o contrário inofensivo de liberar: o pedido sai da lista de Ordens de Serviço e volta a ficar parado, mesmo que o cliente já tenha pago. Por isso a ação fica no fim do menu e pede confirmação com esse aviso.
- Não dá para cancelar uma proposta sem informar o motivo, nem enquanto ela tiver pedido complementar aberto. Cobrança já paga ou título já liquidado também bloqueiam o cancelamento. As cobranças pendentes são canceladas junto com a proposta.
- Se a intenção é só refazer a cobrança, não cancele a proposta: na janela de cancelamento use **Cancelar só a cobrança** (ou **Ver cobranças na aba Pagamentos**, quando há mais de uma). O pedido continua de pé e o saldo reabre.
- Pedido complementar só é aceito em proposta paga integralmente, não avulsa, ainda não despachada e sem outro complemento aberto. O sistema confere isso na hora de criar e mostra o motivo da recusa na própria janela.
- Não dá para gerar PDF nem cobrança de pedido sem cliente cadastrado.
- Não dá para gerar cobrança de proposta que já foi totalmente cobrada.
- Encerrar um teste tira o pedido da Produção, do Kanban, da fila de impressão e da Expedição. Ele continua nesta lista, com a marca, e segue contando no faturamento. Esta é a única tela de onde dá para reabrir.
- A busca por nome de quem recebe a nota fiscal e por nome do evento precisa de pelo menos duas letras e é desligada quando o termo é comum demais (casa com 200 nomes ou mais). A busca por número, cliente e atendente continua funcionando.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Nenhuma proposta encontrada" | Os filtros não trazem nenhum pedido, ou o pedido está escondido (entregue, teste encerrado, cancelado). | Clique em **Limpar filtros** e busque pelo número. Veja "Achar o que a lista esconde". |
| Busquei pelo valor ou pela OS Ideal e o pedido não veio | A busca na base inteira é por número, código e nome do cliente, atendente, nome de quem recebe a nota e nome do evento. Valor e OS só refinam o que já está na tela. | Busque pelo número do pedido ou pelo nome do cliente. |
| O número do card não bate com o total do rodapé | Os cards Pedidos, Liberadas, Revisão atendente e Em produção contam só a página carregada. | Use o "Total de propostas encontradas" do rodapé ou ligue o card para ver a lista. |
| "Geração de PDF bloqueada" | O pedido não tem cliente cadastrado. | Cadastre ou vincule um cliente à proposta e gere o PDF de novo. |
| "Empresa inválida" | A empresa da proposta não é aceita para gerar PDF. | Use Ideal Grafica, Ideal Biro ou E3 Brindes na proposta. |
| "Ação bloqueada: Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)." | Tentativa de gerar cobrança em proposta sem saldo a cobrar. | Para refazer, cancele a cobrança existente na aba Pagamentos da proposta. |
| "Erro de Validação: Pendências financeiras. Todos os pagamentos ativos precisam estar confirmados (Paid/A Vencer) e deve haver pelo menos um." | Liberação para a produção com pagamento ainda não confirmado, ou sem pagamento. | Aguarde a confirmação do financeiro e libere de novo. |
| "Erro de Validação: Pendências de arte. Todas as artes devem estar com status APROVADO." | Liberação para a produção com arte ainda não aprovada. | Conclua a aprovação da arte e libere de novo. |
| "Erro de Validação: A quantidade vendida não bate com a soma dos lotes. Acerte os lotes antes de liberar para produção:" seguido dos produtos | A quantidade vendida de algum produto não bate com a soma dos lotes. | Acerte os lotes na aba Pedido da proposta e libere de novo. |
| "Erro de Validação: Status precisa ser REVISAO ATENDENTE." | O status do pedido mudou depois que a lista foi carregada. | Atualize a tela e confira o status do pedido. |
| "Motivo obrigatório" | Tentativa de cancelar a proposta sem motivo. | Preencha o **Motivo do Cancelamento**. |
| "Esta proposta tem pedido complementar aberto" | A proposta tem um complemento que ainda não foi cancelado. | Cancele ou desvincule o complemento antes de cancelar a proposta. |
| "Não foi possível cancelar a proposta" | Há cobrança paga ou título liquidado, ou falta permissão. O motivo vem na mensagem. | Resolva o que a mensagem aponta, ou procure quem tem permissão para cancelar. |
| "A proposta não está paga integralmente", "A proposta já foi despachada" ou "Já existe um complemento aberto" | O pedido complementar foi recusado porque a proposta não cumpre as condições. | Leia o detalhe na janela e resolva a condição apontada. |
| "Sessão expirada. Entre novamente." | A sessão venceu ao copiar o link de pagamento externo. | Entre de novo no sistema e repita a ação. |
| "Não foi possível carregar os pedidos. Tente novamente." | Falha ao ler a lista. | Atualize a tela. Se continuar, avise o administrador. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Conferência](conferencia.md)
- [Produção (ordens de serviço)](producao.md)
- [Expedição](expedicao.md)
- [Notas fiscais](notas-fiscais.md)
