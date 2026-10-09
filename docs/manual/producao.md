# Produção (ordens de serviço)

> **Última revisão:** 09/10/2026
> **Caminho no menu:** Produção (item direto do menu lateral, sem submenu). A OS de cada pedido abre a partir da lista. O Kanban e a Fila de impressão não estão no menu: chega-se a eles pelo endereço ou pelas abas **Fila Geral / Kanban Board / Fila de Impressão / Expedição** que aparecem no topo dessas duas telas.
> **Endereço:** `/pedidos` (painel geral). OS: `/pedidos/boletim`. Kanban: `/pedidos/kanban` (e `/os-producao`). Fila de impressão: `/pedidos/impressao`.

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

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

### Painel geral (`/pedidos`)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Atrasados** | Cartões do topo | Só mostra o número, que hoje é sempre 0. Não é clicável. |
| **Total de OS** | Cartões do topo | Tira o filtro de fase e mostra todos os pedidos da lista. |
| **Em impressão** | Cartões do topo | Filtra os pedidos em EM IMPRESSAO. |
| **Em revisão** | Cartões do topo | Filtra os pedidos em REVISAO PRODUCAO (linha amarela). |
| **Em acabamento** | Cartões do topo | Filtra os pedidos em EM ACABAMENTO. |
| **Buscar por ID, cliente, vendedor ou OS...** | Barra de filtros | Busca por número, cliente, vendedor ou empresa. |
| **Todos Status** / **Todos Vendedores** / **Todas Empresas** | Barra de filtros | Filtram a lista por status, vendedor e empresa. |
| **Limpar filtros** | Barra de filtros | Volta busca e filtros ao padrão. |
| Clique na linha | Lista | Abre a OS do pedido. |
| Chip do setor (**PVC**, **LASER**, **FLEXO**, **TEXTIL** + fase) | Coluna **Setores** | Abre o menu **Fase do setor** para mover a fase daquele setor. Com **Sem boletim**, não abre. |
| **Em produção** / **Impressão** / **Impressão pausada** / **Acabamento** / **Acabamento pausado** / **Pronto** | Menu **Fase do setor** | Grava a fase escolhida para o setor. |
| **Editar OS / Boletim** (ou **Criar OS / Boletim**) | Menu **Ações** da linha | Abre a OS. Aparece como "Criar" quando o pedido ainda não tem lotes. |
| **Imprimir OS (PDF)** | Menu **Ações** da linha | Abre em nova aba o PDF completo, com todos os setores. Enquanto gera, mostra "Gerando PDF...". |
| **Imprimir OS reduzida (PDF)** | Menu **Ações** da linha | Abre o PDF resumido (lista de conferência, sem imagens). |
| **Gerar novo QR (invalida o anterior)** | Menu **Ações** da linha | Cria um QR novo para a OS e invalida o das vias já impressas. |
| **Abrir DANFE (PDF)** | Menu **Ações** da linha | Abre a DANFE da nota do pedido. Só aparece quando há nota autorizada. |
| **Baixar XML** | Menu **Ações** da linha | Baixa o XML da nota do pedido. Só aparece quando há nota autorizada. |
| **Ver chat interno** | Menu **Ações** da linha | Abre o chat interno do pedido. |
| **Detalhes da proposta** | Menu **Ações** da linha | Abre o pedido na tela de Pedidos. |
| **Voltar para Revisão Atendente** | Menu **Ações** da linha | Abre a confirmação para devolver o pedido ao atendente. |
| **Encerrar teste** | Menu **Ações** da linha | Tira o pedido de teste das filas, depois de uma confirmação. |
| **Cancelar** / **Confirmar devolução** | Janela "Devolver proposta para Revisão?" | Desiste ou confirma a devolução ao atendente. |
| **Editar OS** (ou **Criar OS**) / **Detalhes** / **Voltar p/ Revisão** | Cartão do pedido, no celular | Mesmas ações do menu da linha: abrir a OS, abrir o pedido e devolver ao atendente. |

### Tela da OS (`/pedidos/boletim`)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Voltar** | Cabeçalho | Volta para o painel geral sem salvar. |
| **Imprimir OS · SETOR** (ou **Imprimir OS**) | Cabeçalho | Abre o PDF completo do setor da aba aberta. |
| **Baixar todos (N)** | Cabeçalho, quando o pedido tem mais de um setor | Baixa um PDF por setor. |
| **PDF reduzido** | Cabeçalho (menu) | Abre as opções **PDF reduzido da OS · SETOR** e **Baixar todos reduzidos (N)**. |
| **Salvar Alterações** (na abertura: **Salvar Boletim**) | Cabeçalho e botão verde flutuante | Grava a OS. |
| Abas **PVC** / **LASER** / **FLEXO** / **TEXTIL** | Abaixo do Bloco 1 | Trocam o setor mostrado. A aba marcada **a abrir** ainda não tem boletim. |
| **Data Limite de Entrega \*** / **Hora do Prazo** | Faixa azul do Bloco 1 | Campos do prazo prometido ao cliente. |
| **⚡ PRIORIDADE URGENTE** | Faixa azul do Bloco 1 | Caixa de marcar. Fica travada na edição e não tem efeito hoje. |
| **Abrir PDF do SETOR** / **reduzido** | Bloco de produtos de outro setor | Abrem o PDF completo ou reduzido daquele setor. |
| **Adicionar Lote** | Bloco de produtos, só na abertura | Cria mais um lote no produto. |
| Ícone de lixeira (title "Remover Lote") | Cartão do lote, só na abertura | Remove o lote. O produto precisa ficar com pelo menos um. |
| Ícone de olho (title "Ver gabarito visual") | Campo **Gabarito Operacional**, só na abertura | Mostra a imagem do gabarito; fecha em **Fechar Visualização**. |
| **Importar CSV Variáveis** | Cartão do lote com numeração Customizada, só na abertura | Só simula a importação: marca um nome de arquivo no lote, sem enviar planilha. |
| **Abrir para imprimir** / **Abrir os N setores** | Janela "Abrir para imprimir?" / "Reimprimir o boletim?" | Abre o documento com todos os setores e volta para o painel geral. |
| **Abrir só SETOR** | Janela "Reimprimir o boletim?" | Abre só o setor que acabou de ser editado. |
| **Abrir o documento em nova aba** | Mesma janela, quando o navegador bloqueou a aba | Abre o PDF que foi bloqueado. |
| **Agora não** | Mesma janela | Fecha sem imprimir e volta para o painel geral. A OS já está salva. |

### Página do QR da OS (`/os`)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Avançar para STATUS** / **Retomar: STATUS** | Botão verde | Escolhe o próximo passo natural da OS. |
| **Outros status (N)** / **Ocultar outros status** | Abaixo do botão verde | Mostra ou esconde as demais mudanças possíveis. |
| **Voltar** | Painel de confirmação | Desiste da mudança escolhida. |
| **Confirmar STATUS** | Painel de confirmação | Grava a mudança de status. |
| **Confirmar entrega** e depois **Confirmar ENTREGUE agora** | Painel de confirmação, só para ENTREGUE | Os dois toques que marcam a entrega. |

### Kanban (`/pedidos/kanban` e `/os-producao`)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Fila Geral** / **Kanban Board** / **Fila de Impressão** / **Expedição** | Abas do topo | Levam ao painel geral, ao Kanban, à Fila de impressão e à Expedição. |
| **Modo TV / Galpão** | Topo, à direita | Abre o quadro em tela cheia; **Sair do Modo TV** ou a tecla ESC fecha. |
| **Tudo**, **Atrasados**, **Urgentes**, **Fase Arte**, **Produção**, **Expedição**, **Aguardando Clie.**, **Bloqueados**, **Prazo Hoje**, **Esta Semana** | Faixa de filtros rápidos | Filtram o quadro. |
| **Buscar por OS, Cliente, Vendedor...**, **Todas as Empresas**, **Ordem: ...** | Barra de filtros | Busca, filtro de empresa e ordenação dos cartões. |
| **Card Compacto: Ligado / Desligado** | Barra de filtros | Alterna o tamanho dos cartões. |
| Setas esquerda e direita (title "Mudança de status desativada") | Cartão | Desativadas: não têm efeito hoje. |
| Ícone de chama (title "Urgência desativada nesta etapa") | Cartão | Desativado: não tem efeito hoje. |
| Ícone de pausa (title "Pausa desativada nesta etapa") | Cartão | Desativado: não tem efeito hoje. |
| Ícone de balão (title "Chat") | Cartão | Abre o chat interno do pedido. |
| Ícone de olho (title "Abrir Boletim de OS") e **Fábrica** (title "Ir para Boletim de Produção") | Cartão | Os dois abrem a OS do pedido. |

### Fila de impressão (`/pedidos/impressao`)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Fila Geral** / **Kanban Board** / **Fila de Impressão** / **Expedição** | Abas do topo | Levam às outras telas. |
| **Modo TV** | Topo, à direita | Abre a fila em tela cheia; **Sair da TV** ou a tecla ESC fecha. |
| **Todos Ativos**, **Prontos para Imprimir**, **Em Impressão (Rodando)**, **Aguardando Arte**, **Bloqueados / Pausados**, **Atrasados** | Filtros | Filtram os lotes pela situação. |
| **Setor:** / **Material:** | Filtros | Filtram por setor e por material. |
| **Priorizar Urgentes** | Filtros | Mostra só os lotes de pedido urgente. |
| **Compacto: Ligado / Desligado** | Filtros | Alterna a altura das linhas. |
| **Iniciar** | Coluna Ações do lote | Não tem efeito hoje. |
| **Pausar** / **Concluir** | Coluna Ações do lote | Não têm efeito hoje. |
| **Retomar** | Coluna Ações do lote | Não tem efeito hoje. |

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
4. Escreva em **BLOCO 2 — Orientação Técnica de Produção** o que a bancada precisa saber para fabricar. Esse texto sai na OS impressa e é o mesmo que o atendente vê na aba Produção / Expedição do pedido. Logo abaixo, no mesmo bloco, fica **Instruções de entrega**: o que a Expedição precisa saber para entregar (dia, horário, com quem deixar). Também é o mesmo texto da aba do pedido, sai na OS em bloco próprio e aparece para o expedidor na Expedição.
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

Antes de abrir o PDF, o sistema confere a numeração dos modelos do pedido. Se algum modelo tem o **Nº final** gravado diferente do calculado pelo numerador de hoje, aparece uma pergunta com os modelos e os dois números. **OK** imprime mesmo assim, com o número gravado; **Cancelar** não imprime. Para corrigir, reabra o pedido na aba **Pedido** e grave: veja [Proposta: aba Pedido](proposta-pedido.md).

1. No painel geral, abra **Ações** na linha do pedido.
2. **Imprimir OS (PDF)** abre, em nova aba, um documento só com todos os setores do pedido, um setor por página.
3. **Imprimir OS reduzida (PDF)** abre a versão resumida (lista de conferência, sem as imagens das artes). Pelo painel geral ela sai de um setor só; para o reduzido de cada setor, use a tela da OS.
4. Dentro da OS, o cabeçalho traz **Imprimir OS · SETOR** (só o setor da aba aberta), **Baixar todos (N)** (um arquivo por setor, direto para a pasta de downloads) e o menu **PDF reduzido**.
5. Dentro da OS, no bloco de produtos de outro setor, **Abrir PDF do SETOR** e **reduzido** imprimem aquele setor sem trocar de aba.
6. Depois de **Salvar Alterações**, a pergunta **Abrir para imprimir?** abre o documento completo. Se o pedido já foi impresso antes, a pergunta vira **Reimprimir o boletim?** e oferece **Abrir os N setores** ou **Abrir só SETOR** (o setor que você acabou de editar).
7. O aviso "Gerando o PDF na nova aba" indica que o documento está sendo montado. A primeira impressão do dia costuma demorar mais.
8. A OS impressa não mostra valores. No cabeçalho ela traz o número da OS, o setor, o prazo com a hora e o QR code. O QR traz só o número do pedido; os PDFs impressos antes desta mudança (09/10/2026) têm o QR antigo.

### Usar o QR code da OS

O QR traz só o número do pedido; os PDFs impressos antes desta mudança (09/10/2026) têm o QR antigo.

**QR novo (OS gerada a partir de 09/10/2026)**

1. Serve para não errar a digitação do número no terminal. Clique no campo de busca da tela (Produção, Kanban ou Expedição) e leia o QR com o leitor: o número do pedido entra no campo e a lista filtra.
2. O QR novo não abre página nenhuma e não muda status. Lido pelo celular, ele mostra só o número.
3. Gerar a OS de novo (2ª via, outro setor, **Baixar todos**) já sai com o QR novo.

**QR antigo (vias impressas antes)**

As vias antigas continuam valendo como eram. O QR delas é um link: lido no terminal, ele digita o endereço inteiro no campo de busca e a lista fica vazia; nesse caso digite o número. Quando a via antiga traz o QR da página de troca de status, os passos são estes:

1. Leia o QR impresso na OS com o celular. Não precisa de login.
2. A página mostra **OS #número**, o resumo do produto e o **Status atual**.
3. O botão verde traz o próximo passo natural: **Avançar para ...** ou, se a etapa está pausada, **Retomar: ...**.
4. Em **Outros status** ficam as demais mudanças possíveis: pausar, retornar, saltar etapa.
5. Escolha o destino, preencha **Motivo (opcional)** se quiser e toque em **Confirmar ...**. O status só muda ao confirmar.
6. Para ENTREGUE o sistema pede dois toques: **Confirmar entrega** e depois **Confirmar ENTREGUE agora**. Depois disso o QR não permite novas mudanças.
7. Quem lê o QR já logado no sistema e com acesso à Produção é levado direto para a tela da OS, em vez da página de troca de status.
8. Se uma via antiga se perder ou vazar, use **Ações → Gerar novo QR (invalida o anterior)**: o QR antigo passa a mostrar "QR substituído". A OS reimpressa sai com o QR novo, que traz só o número.

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

## O que não confundir

- **Menu Produção x menu Pedidos:** o menu Produção abre a lista da fábrica (só pedidos liberados); o menu Pedidos abre a lista comercial, com todos os pedidos, onde se libera para produção.
- **Menu Produção x aba Produção / Expedição do pedido:** a aba **Produção / Expedição** fica dentro de um pedido, na tela de Pedidos, e é do atendente; o menu Produção é a lista da fábrica.
- **OS x boletim:** são a mesma tela. A OS é do pedido inteiro; cada setor tem a sua parte (o boletim daquele setor), que aparece como uma aba e sai como uma página do PDF.
- **Número da OS x número do pedido:** é o mesmo número. A coluna **OS** mostra o número do pedido.
- **Status do pedido x fase do setor:** a fase é de cada setor (chip na coluna Setores); o status é do pedido inteiro e segue o setor mais atrasado.
- **Pronto (fase do setor) x Marcar pronto (Expedição):** **Pronto** só diz que aquele setor terminou; **Marcar pronto**, na Expedição, é o que tira o pedido da Produção.
- **REVISAO PRODUCAO x REVISAO ATENDENTE:** em REVISAO ATENDENTE o pedido ainda está com o atendente, antes da liberação; em REVISAO PRODUCAO ele já foi liberado e espera a fábrica salvar a OS.
- **Card "Em revisão" x devolver para revisão:** o cartão **Em revisão** conta pedidos em REVISAO PRODUCAO; **Voltar para Revisão Atendente** devolve o pedido ao atendente e o tira da lista.
- **"/ PENDENTE" x tarefa:** EM IMPRESSAO / PENDENTE e EM ACABAMENTO / PENDENTE são pausas da etapa; não criam tarefa nem pendência para ninguém.
- **Imprimir OS (PDF) x Imprimir OS reduzida (PDF):** a primeira traz as imagens das artes e todos os setores; a reduzida é a lista de conferência, sem imagens.
- **Imprimir OS x Baixar todos:** **Imprimir OS** abre o PDF em nova aba; **Baixar todos (N)** salva um arquivo por setor na pasta de downloads.
- **Fila de impressão x imprimir a OS:** a Fila de impressão é um painel de lotes a rodar na máquina; ela não imprime a OS em papel.
- **Painel geral x Kanban:** só o painel geral move fases; o Kanban é quadro de consulta.
- **Liberado para NF x Nota emitida:** **Liberado para NF** diz que o pedido pode ser faturado; **Nota emitida · nº** diz que a nota já foi autorizada.
- **Encerrar teste x Voltar para Revisão Atendente:** encerrar teste esconde um pedido de teste das filas sem mudar o status; voltar para revisão devolve um pedido real ao atendente.
- **`/producao` x menu Produção:** o endereço `/producao` é a tela "Controle de Artes e Modelos de Produção"; o menu Produção abre `/pedidos`.

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
- [Proposta: abas Produção / Expedição, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Expedição](expedicao.md)
- [Tarefas](tarefas.md)
- [Notas fiscais](notas-fiscais.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa.

- `src/features/pedidos/PedidosListPage.tsx`
- `src/features/pedidos/BoletimFormPage.tsx`
- `src/features/orcamentos/hooks/useFimDivergente.ts`
- `src/features/pedidos/PedidosKanbanPage.tsx`
- `src/features/pedidos/PainelImpressaoPage.tsx`
- `src/features/pedidos/components/SetorFaseChip.tsx`
- `src/features/pedidos/components/DevolverRevisaoModal.tsx`
- `src/features/pedidos/components/GerarPdfBoletimModal.tsx`
- `src/features/pedidos/status-setor.ts`
- `src/features/pedidos/setores.ts`
- `src/features/pedidos/prazo-producao.ts`
- `src/features/pedidos/hora-entrega.ts`
- `src/features/pedidos/services/pedidos-producao.service.ts`
- `src/features/pedidos/services/pedidos-detalhe.service.ts`
- `src/features/pedidos/services/boletim-setores.service.ts`
- `src/features/pedidos/services/boletim-propostas.service.ts`
- `src/features/pedidos/services/imprimir-os.client.ts`
- `src/features/pedidos/services/encerrar-teste.client.ts`
- `src/app/(erp)/pedidos/`
- `src/app/(erp)/producao/page.tsx`
- `src/app/(erp)/os-producao/page.tsx`
- `src/app/os/os-qr-client.tsx`
- `src/app/api/pedidos/imprimir-os/route.ts`
- `src/features/pedidos/lib/qr-do-boletim.ts`
- `src/app/api/pedidos/os-qr/rotacionar/route.ts`
- `src/constants/navigation.ts`
- `src/features/auth/usuarios.service.ts`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
- `src/lib/auth/verificar-permissao.ts`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/expedicao/services/expedicao-acoes.service.ts`
- `src/features/dashboard/sections/ProducaoSection.tsx`
