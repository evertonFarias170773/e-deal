# Produção (ordens de serviço)

> **Última revisão:** 01/10/2026
> **Onde fica:** menu → Produção (endereço `/pedidos`, o painel geral). A OS de cada pedido abre em `/pedidos/boletim`. O Kanban (`/pedidos/kanban`) e a Fila de impressão (`/pedidos/impressao`) não têm item próprio no menu: abrem pelo endereço ou pelas abas que aparecem no topo dessas duas telas.

## Para que serve

É a tela da fábrica. Ela lista os pedidos que já foram liberados para produção, mostra em que fase cada setor está (PVC, LASER, FLEXO, TEXTIL) e deixa mover essas fases.

Dela você abre a OS (o boletim) de cada pedido para conferir prazo, instruções de fabricação e lotes, e imprime a OS em PDF para a bancada.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Pedidos e OS** no perfil, além de Administrador e Super Administrador. Sem ela aparece "Acesso Negado".
- Quem vê a lista consegue mover a fase de um setor e abrir a OS. Não há permissão separada para isso.
- **Imprimir OS** aparece para quem tem a permissão **Imprimir OS (PDF de produção)**.
- **Data Limite de Entrega** e **Hora do Prazo**, depois de gravadas, só mudam por Administrador, Super Administrador ou quem tem a permissão **Editar Datas de Entrega**.
- **Voltar para Revisão Atendente** aparece para Administrador, Super Administrador ou quem tem a permissão **Ações Administrativas de OS**.
- **Gerar novo QR (invalida o anterior)** aparece para quem tem a permissão **Revogar/Gerar novo QR da OS**.
- **Encerrar teste** aparece só para o Super Administrador.
- As permissões de cada perfil são definidas em Configurações → Perfis e Permissões.

## Passo a passo

### Entender o que faz um pedido aparecer aqui

1. O pedido só entra na Produção depois de liberado. A liberação é feita na tela de Pedidos, pela ação **Liberar para Produção**, quando o pedido está em REVISAO ATENDENTE.
2. A liberação só passa se todos os pagamentos ativos estiverem confirmados, todas as artes estiverem aprovadas e a quantidade vendida de cada item for igual à soma dos lotes dele. Proposta avulsa não vai para produção.
3. Pedido só com produtos de prateleira pode ser liberado sozinho pelo sistema, no momento em que o pagamento que o cobre por inteiro é confirmado. As conferências são as mesmas.
4. Ao ser liberado, o pedido chega aqui com o status **REVISAO PRODUCAO**, aparece no topo da lista com a linha amarela e fica com a data e hora da liberação na coluna **Liberado em**.
5. O pedido fica na lista enquanto estiver em REVISAO PRODUCAO, EM PRODUCAO, EM IMPRESSAO, EM IMPRESSAO / PENDENTE, EM ACABAMENTO ou EM ACABAMENTO / PENDENTE. Quando vai para a Expedição, sai daqui.

### Ler o painel geral

1. Os cartões do topo (**Total de OS**, **Em impressão**, **Em revisão**, **Em acabamento**) mostram a contagem e funcionam como filtro: clique em um para ver só aquela fase; clique em **Total de OS** para voltar a ver tudo.
2. Use a busca (**Buscar por ID, cliente, vendedor ou OS...**) e os filtros **Todos Status**, **Todos Vendedores** e **Todas Empresas**. **Limpar filtros** volta tudo ao padrão. Os filtros ficam no endereço da página, então sobrevivem a atualizar a tela e podem ser enviados por link.
3. Na coluna **Cliente**, a linha "Pagador: ..." aparece quando quem paga não é o cliente do pedido.
4. A coluna **Status** mostra o status do pedido e, logo abaixo, quantos setores já terminaram ("1/2 setores prontos"). Também aparecem ali **Nota emitida · nº ...**, quando o pedido já tem nota autorizada, e o selo **Liberado para NF**.
5. A coluna **Setores** traz um chip por setor do pedido, com a cor do setor e a fase em que ele está.
6. Clicar em qualquer ponto da linha abre a OS do pedido.

### Revisar um pedido que acabou de chegar (linha amarela)

1. Abra o pedido clicando na linha, ou em **Ações → Editar OS / Boletim**.
2. Confira a **Data Limite de Entrega** e a **Hora do Prazo**. Na primeira abertura elas vêm calculadas (veja "Regras e bloqueios"); se vierem vazias, preencha.
3. Passe por cada aba de setor (PVC, LASER, FLEXO, TEXTIL) e confira os produtos e lotes daquele setor.
4. Escreva em **BLOCO 2 — Orientação Técnica de Produção** o que a bancada precisa saber para fabricar. Esse texto sai na OS impressa e é o mesmo que o atendente vê na aba Produção do pedido.
5. Se precisar, preencha **Observações Técnicas de Impressão (Bloco 6)** e **Observações Técnicas de Acabamento (Bloco 7)**.
6. Clique em **Salvar Alterações** (botão do cabeçalho ou o botão verde flutuante).
7. Ao salvar, o pedido que estava em REVISAO PRODUCAO passa sozinho para **EM PRODUCAO**, e a linha deixa de ficar amarela.
8. O sistema pergunta **Abrir para imprimir?**. Escolha abrir o documento ou **Agora não**. Nos dois casos você volta para o painel geral.

### Avançar a fase de um setor

1. No painel geral, clique no chip do setor na coluna **Setores**.
2. Escolha a nova fase no menu **Fase do setor**: **Em produção**, **Impressão**, **Impressão pausada**, **Acabamento**, **Acabamento pausado** ou **Pronto**.
3. O aviso "Fase alterada para ..." confirma a gravação. A mudança fica registrada no chat interno do pedido.
4. O status do pedido acompanha o setor mais atrasado. Exemplo: com FLEXO em Acabamento e PVC em Impressão, o pedido fica EM IMPRESSAO.
5. Quando todos os setores estão em **Pronto**, o status do pedido não muda sozinho e ele continua na lista. A saída para a Expedição é o passo seguinte.

### Pausar e retomar (as fases "/ PENDENTE")

1. Para registrar que o setor parou (falta de material, máquina parada, arte em ajuste), mude o chip para **Impressão pausada** ou **Acabamento pausado**.
2. O pedido passa a mostrar EM IMPRESSAO / PENDENTE ou EM ACABAMENTO / PENDENTE e continua na lista.
3. Para retomar, volte o chip para **Impressão** ou **Acabamento**.
4. Pelo chip não há campo de motivo. Se quiser registrar o motivo, escreva no chat interno (**Ações → Ver chat interno**) ou faça a pausa pelo QR da OS, que tem o campo **Motivo (opcional)**.

### Mandar o pedido para a Expedição

1. Com a produção terminada, o pedido é passado para a Expedição pelo botão **Marcar pronto**, na tela de Expedição. Veja [Expedição](expedicao.md).
2. Pelo celular, quem lê o QR da OS de um pedido em EM ACABAMENTO também pode usar **Avançar para EXPEDICAO**.
3. Ao entrar em EXPEDICAO, o pedido some do painel de Produção.

### Imprimir a OS

1. No painel geral, abra **Ações** na linha do pedido.
2. **Imprimir OS (PDF)** abre, em nova aba, um documento só com todos os setores do pedido, um setor por página.
3. **Imprimir OS reduzida (PDF)** abre a versão resumida (lista de conferência, sem as imagens das artes). Pelo painel geral ela sai de um setor só; para o reduzido de cada setor, use a tela da OS.
4. Dentro da OS, o cabeçalho traz **Imprimir OS · SETOR** (só o setor da aba aberta), **Baixar todos (N)** (um arquivo por setor, direto para a pasta de downloads) e o menu **PDF reduzido**.
5. Dentro da OS, no bloco de produtos de outro setor, **Abrir PDF do SETOR** e **reduzido** imprimem aquele setor sem trocar de aba.
6. Depois de **Salvar Alterações**, a pergunta **Abrir para imprimir?** abre o documento completo. Se o pedido já foi impresso antes, a pergunta vira **Reimprimir o boletim?** e oferece **Abrir os N setores** ou **Abrir só SETOR** (o setor que você acabou de editar).
7. O aviso "Gerando o PDF na nova aba" indica que o documento está sendo montado. A primeira impressão do dia costuma demorar mais.
8. A OS impressa não mostra valores. No cabeçalho ela traz o número da OS, o setor, o prazo com a hora e o QR code.

### Usar o QR code da OS

1. Leia o QR impresso na OS com o celular. Não precisa de login.
2. A página mostra **OS #número**, o resumo do produto e o **Status atual**.
3. O botão verde traz o próximo passo natural: **Avançar para ...** ou, se a etapa está pausada, **Retomar: ...**.
4. Em **Outros status** ficam as demais mudanças possíveis: pausar, retornar, saltar etapa.
5. Escolha o destino, preencha **Motivo (opcional)** se quiser e toque em **Confirmar ...**. O status só muda ao confirmar.
6. Para ENTREGUE o sistema pede dois toques: **Confirmar entrega** e depois **Confirmar ENTREGUE agora**. Depois disso o QR não permite novas mudanças.
7. Quem lê o QR já logado no sistema e com acesso à Produção é levado direto para a tela da OS, em vez da página de troca de status.
8. Se a via impressa se perder ou vazar, use **Ações → Gerar novo QR (invalida o anterior)** e reimprima a OS. O QR antigo passa a mostrar "QR substituído".

### Devolver o pedido para o atendente

1. No painel geral, abra **Ações → Voltar para Revisão Atendente**.
2. Leia o aviso: o pedido sai da lista de Produção, o status volta para REVISAO ATENDENTE e será preciso liberar de novo.
3. Clique em **Confirmar devolução**.

### Abrir a OS de um pedido que ainda não tem lotes

1. Quando o pedido não tem lote cadastrado, a ação aparece como **Criar OS / Boletim** e a tela abre em modo de abertura.
2. Confira o setor de cada produto em **Setor PCP** e distribua a quantidade em lotes com **Adicionar Lote**.
3. A soma dos lotes de cada produto precisa ser exatamente igual à quantidade vendida. O rodapé de cada produto mostra "Total Distribuído nos Lotes".
4. Preencha **Data Limite de Entrega** e clique em **Salvar Boletim**.
5. Depois de aberta, a OS passa para o modo de edição: cliente, quantidades, lotes, numeração e setor ficam travados, e só prazo, hora e os textos de orientação continuam editáveis.

### Consultar o Kanban e a Fila de impressão

1. O **Kanban** (`/pedidos/kanban`; o endereço `/os-producao` abre a mesma tela) é um quadro de consulta com o botão **Modo TV / Galpão**. Os botões de mover, urgência e pausa dos cartões estão desativados. Hoje as colunas do quadro não acompanham as fases reais do painel geral; para acompanhar e mover fases, use o painel geral.
2. A **Fila de impressão** (`/pedidos/impressao`) lista os lotes dos pedidos em produção, com filtros (**Todos Ativos**, **Prontos para Imprimir**, **Em Impressão (Rodando)**, **Aguardando Arte**, **Bloqueados / Pausados**, **Atrasados**), **Modo TV** e modo compacto. A tela está marcada como **PREVIEW UX**: os botões **Iniciar**, **Pausar**, **Concluir** e **Retomar** ainda não gravam nada.
3. Nas duas telas, as abas **Fila Geral**, **Kanban Board**, **Fila de Impressão** e **Expedição** levam de uma para a outra. Atalhos de teclado: **L** (painel geral), **K** (Kanban), **I** (Fila de impressão), **U** (filtro de urgentes).
4. O endereço `/producao` abre a tela "Controle de Artes e Modelos de Produção", que só funciona com o número do pedido no endereço. É para onde levam os gráficos de Produção do Dashboard. Não é a tela de trabalho do dia a dia.
5. O endereço `/pedidos/` seguido de um número não abre uma tela de detalhe: ele volta para o painel geral. O detalhe do pedido na Produção é a tela da OS.

## Regras e bloqueios

- Pedido não liberado não aparece na Produção, mesmo com pagamento confirmado ou arte aprovada. O que conta é a liberação.
- A linha amarela marca pedido em REVISAO PRODUCAO: ele chegou e ninguém salvou a OS ainda. Esses pedidos ficam sempre no topo da lista.
- Não dá para mover a fase de um setor cujo chip mostra **Sem boletim**. Abra a OS, entre na aba do setor (marcada como **a abrir**), confira o prazo e salve; o chip passa a aceitar a mudança.
- **Sem setor definido** na coluna Setores quer dizer que nenhum produto do pedido tem setor de produção no cadastro.
- O status do pedido segue o setor menos adiantado. Em empate, vale a fase pausada. Pausar não faz o setor avançar.
- Marcar todos os setores como **Pronto** não manda o pedido para a Expedição. Isso é feito com **Marcar pronto**, na Expedição, ou pelo QR.
- A tela da OS não tem mais a aba **Revisão** nem o botão **Confirmar revisão e liberar para Expedição**: a conferência final de peso e volumes deixou de ser feita aqui. A passagem para a Expedição é o **Marcar pronto**.
- A **Data Limite de Entrega** é calculada uma vez: o maior prazo de produção (em dias úteis) entre os produtos do pedido, contado a partir do dia da liberação, pulando sábado, domingo e feriado. Reabrir a OS não recalcula; vale o que está gravado.
- A **Hora do Prazo** vem do tipo de frete do pedido: Correios 15:00, Veppo 16:00, Motoboy 15:30, Aéreo 15:00, Rodoviário 14:00, Retira 16:00, Extras 15:00. Se o frete do pedido não estiver classificado, a hora vem vazia.
- Se nenhum produto tem prazo de produção cadastrado, a data vem vazia. O sistema não inventa prazo.
- Data e hora são do pedido, não do setor: salvar em uma aba grava a mesma data e hora em todos os setores.
- Depois de gravadas, data e hora só mudam por quem tem a permissão **Editar Datas de Entrega** (ou Administrador). Para os demais, os campos ficam cinza com o aviso "Data e hora de entrega só podem ser alteradas por um administrador." O motivo: elas são a promessa feita ao cliente. Apagar a data segue a mesma regra.
- Não dá para salvar a OS sem **Data Limite de Entrega**.
- Na OS já aberta, cliente, quantidades, lotes, cor, frente e verso, tipo de numeração, faixa numérica e setor do produto são só leitura. Esses dados vêm do pedido; para mudar, o ajuste é feito no pedido, pelo atendente.
- Item removido do pedido não é produzido: ele não aparece na OS, no PDF, na contagem do setor nem no cálculo do prazo, e os lotes dele deixam de contar na quantidade total.
- Produto de prateleira aparece na OS sem os campos de frente e verso, numeração e gabarito, porque é vendido pronto.
- Pedido complementar é um pedido próprio: tem cobrança, arte e liberação próprias e aparece na Produção como uma OS separada, com número próprio. Ele não herda a fase do pedido principal. A saída conjunta dos dois é tratada na Expedição.
- **Imprimir OS** só existe para pedido liberado para produção. Se a OS ainda não foi criada, a própria impressão a cria, já com a data e a hora calculadas.
- **Gerar novo QR** invalida o QR de todas as vias já impressas daquele pedido.
- **Encerrar teste** tira o pedido do painel de Produção, do Kanban, da Fila de impressão e da Expedição, sem apagar nada. Ele continua acessível por busca e pelo endereço, e segue contando no faturamento. Para reabrir, use o menu Ações na tela de Pedidos.
- O cartão **Atrasados** do painel geral ainda não faz a conta e mostra sempre 0. Para ver prazo, use a coluna **Data entrega**.
- Não existe lista de pendências dentro da Produção. A pausa de etapa é a fase "pausada" do setor; assunto que depende de outra pessoa vai para o chat interno do pedido ou para uma tarefa. Veja [Tarefas](tarefas.md).

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Acesso Negado — Você não tem permissão para visualizar os pedidos de produção." | Seu perfil não tem a permissão de ver pedidos e OS. | Peça a um administrador para ajustar o perfil. |
| O pedido não aparece na lista | Ele ainda não foi liberado, já foi para a Expedição, foi devolvido para o atendente, ou há filtro ativo. | Clique em **Limpar filtros**. Se continuar fora, confira o status do pedido na tela de Pedidos. |
| O chip do setor mostra **Sem boletim** e não abre o menu | O boletim daquele setor ainda não foi criado. | Abra a OS, vá na aba do setor, confira o prazo e clique em **Salvar Alterações**. |
| "Data e hora de entrega só podem ser alteradas por um administrador." | A data já está gravada e seu perfil não tem a permissão de editar datas de entrega. | Peça a um administrador para ajustar a data, ou para dar a permissão ao seu perfil. |
| "Formulário Incompleto — A data de entrega prevista é obrigatória." | A OS está sem data limite. | Preencha **Data Limite de Entrega**. Se o campo estiver travado, peça a um administrador para preencher. |
| "O navegador bloqueou a aba" | O navegador barrou a abertura do PDF em nova aba. | Libere os pop-ups para o site e clique em imprimir de novo. Na pergunta de impressão, use **Abrir o documento em nova aba**. |
| "Sem permissão para imprimir OS" | Seu perfil não tem a permissão de imprimir OS. | Peça a um administrador para incluir a permissão no perfil. |
| "Proposta não liberada para produção — OS não pode ser impressa." | O pedido foi retirado da produção ou devolvido para o atendente. | Só volta a imprimir depois de liberado de novo. |
| "Não foi possível abrir a OS para impressão" | A OS ainda não existia e o sistema não conseguiu criá-la (por exemplo, pedido sem vendedor ou sem produtos). | Leia o motivo no aviso, corrija no pedido e tente de novo. |
| "Divergência de Quantidade" ao abrir uma OS | A soma dos lotes de um produto é diferente da quantidade vendida. | Ajuste os lotes até a soma ficar igual à quantidade do pedido. |
| "Erro — ..." ao mudar a fase, e o chip volta para a fase anterior | A gravação da fase falhou. | Tente de novo. Se repetir, atualize a página. |
| No QR: "QR substituído" | Foi gerado um QR novo para a OS. | Use a via mais recente da OS. |
| No QR: "QR Code inválido" | O QR não pertence a uma OS ativa. | Reimprima a OS pelo painel geral. |
| No QR: "O status mudou em outra tela. A OS foi recarregada — confira antes de continuar." | Outra pessoa mudou o status enquanto a página estava aberta. | Confira o status atual e escolha de novo. |
| No QR: "Etapa controlada pelo ERP." | O pedido está em uma etapa que não se muda pelo QR. | Faça a mudança pelo sistema. |
| No QR: "Entrega concluída. Alterações somente pelo ERP." | O pedido já está como ENTREGUE. | Qualquer correção é feita pelo sistema. |
| Tela "ID do Pedido Não Informado" | Você abriu `/producao` sem número de pedido (por exemplo, pelos gráficos do Dashboard). | Para o trabalho do dia a dia, use o menu Produção. |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Expedição](expedicao.md)
- [Tarefas](tarefas.md)
- [Notas fiscais](notas-fiscais.md)
