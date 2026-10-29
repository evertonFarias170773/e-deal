# Retrabalho: refazer um pedido

> **Última revisão:** 29/10/2026
> **Caminho no menu:** Pedidos → menu da linha → **Duplicar proposta** → **Retrabalho**
> **Endereço:** `/orcamentos` e `/orcamentos/<número>/editar`

## Para que serve

É o caminho para refazer um pedido que saiu errado — reimpressão por erro, reposição, pedido refeito — sem cobrar a venda de novo do cliente. O retrabalho nasce como um pedido novo, com número próprio, copiado do pedido que deu problema e ligado a ele.

Não existe botão chamado "Retrabalho" solto nem tela separada: o retrabalho é uma das duas respostas da janela **Duplicação ou Retrabalho?**, que o **Duplicar proposta** abre. Quem escolhe **Duplicação** faz uma venda nova comum; quem escolhe **Retrabalho** faz o pedido de cortesia, que fica fora do faturamento e só aceita a cobrança **E-Retrabalho**.

## Quem acessa

- Pode abrir retrabalho quem pode duplicar a proposta: o vendedor da proposta, o administrador ou quem vê todas as propostas. Para os demais a cópia é recusada com o aviso "Você só pode duplicar proposta em que é o vendedor".
- Não há permissão separada para retrabalho: quem duplica escolhe o motivo.
- Gerar a cobrança **E-Retrabalho** depende de quem pode gerar cobrança no pedido; a liberação é sempre do financeiro.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Duplicar proposta** | Menu da linha na lista de Pedidos, e menu **Acoes** do pedido aberto (visualização e edição) | Abre a janela **Duplicação ou Retrabalho?**. Enquanto a cópia é criada, o item mostra **Duplicando...**. |
| **Duplicação ou Retrabalho?** | Título da janela | Pergunta como a cópia deve nascer. |
| **Duplicação** | Janela **Duplicação ou Retrabalho?** | Cria uma venda nova comum, que entra no faturamento. |
| **Retrabalho** | Janela **Duplicação ou Retrabalho?** | Cria o pedido de retrabalho: refaz o pedido, exige a cobrança **E-Retrabalho** e fica fora do faturamento. |
| **Cancelar** | Pé da janela | Fecha sem criar nada. |
| **Entendi** | Aviso azul **Cópia da proposta #<número>**, no topo da cópia | Fecha o aviso neste navegador. |
| **E-Retrabalho** | Quadro **Forma de pagamento** da janela de cobrança, na aba Pagamentos | A única forma aceita no pedido de retrabalho; já vem selecionada. |

## Passo a passo

### Como abrir um pedido de retrabalho

1. Abra a lista **Pedidos** e encontre o pedido que vai ser refeito. Dá para partir da lista, pelo menu da linha, ou de dentro do pedido, pelo menu **Acoes**.
2. Clique em **Duplicar proposta**. Abre a janela **Duplicação ou Retrabalho?**, com o número do pedido de origem.
3. Clique em **Retrabalho**. A escolha não pode ser trocada depois. **Cancelar** ou fechar a janela não cria nada.
4. O aviso **Retrabalho criado** mostra o número do pedido novo, e o sistema abre esse pedido em edição.
5. Leia o aviso azul **Cópia da proposta #<número>**, no topo: ele diz o que veio da original e o que falta conferir. Ele sai quando você clica em **Entendi** ou quando a cópia ganha cobrança.
6. Confira e corrija o que vai ser refeito: na aba **Orçamento**, os produtos, as quantidades e as variações vêm da original, com os preços daquela venda; na aba **Pedido**, os modelos vêm com o mesmo nome, cor do papel, quantidade e numeração, e com a arte pendente. Se o retrabalho é só de parte do pedido, ajuste as quantidades agora.
7. Na aba **Fretes**, a modalidade e a transportadora do FOB vêm da original, mas a cotação não vem: em CIF, cote o frete de novo.
8. Clique em **Salvar alterações**.
9. Vá à aba **Pagamentos** e gere a cobrança **E-Retrabalho**. A cobrança da original não vem para o retrabalho.

### Gerar a cobrança E-Retrabalho

1. Salve o retrabalho antes de gerar a cobrança: o valor dela nasce com o total da proposta naquele momento, e as quantidades do retrabalho podem ser diferentes das da original.
2. Na aba **Pagamentos**, abra a janela de cobrança. No quadro **Forma de pagamento**, **E-Retrabalho** já vem selecionada e é a única forma oferecida.
3. **E-Retrabalho** é cortesia: não pede condição de pagamento e não gera título para receber depois.
4. A cobrança fica **Aguardando financeiro** até a liberação manual. Depois de liberada e conferida, consta como paga na hora.

### Refazer um pedido que já é cópia

1. Clique em **Duplicar proposta** no pedido que já é cópia. A janela avisa que este pedido já é uma cópia e que ele só pode gerar um retrabalho, e mostra só a opção **Retrabalho**.
2. O retrabalho aponta para o pedido de onde você clicou, não para o primeiro da cadeia.

### Onde o retrabalho fica destacado

1. Na lista de **Pedidos**, na **Produção**, na **Expedição** e na fila de **Notas fiscais**, o pedido de retrabalho ganha contorno vermelho, o número do pedido em vermelho e o selo **Retrabalho de #<original>** (só **Retrabalho** quando não há original gravado).
2. No boletim impresso, a palavra **RETRABALHO** sai em letras grandes vermelhas no topo de cada página.
3. Na **Orientação técnica** do pedido novo, a primeira linha é **Retrabalho do pedido #<número>**. O que a original tinha nesse campo continua abaixo.
4. No chat interno ficam as duas marcas: "Retrabalho gerado: pedido #<novo>." na original e "Retrabalho do pedido #<original>." no retrabalho.
5. Na **Conferência**, aba **Cobranças Confirmadas**, o filtro de tipo **Retrabalhos** lista essas cobranças. No **Dashboard**, o quadro **Retrabalho** mostra a quantidade e o valor do período, por empresa — só informativo.

## Regras e bloqueios

- O motivo da cópia é fixo: escolhido **Retrabalho**, não existe caminho para transformar o pedido em duplicação depois, nem o contrário.
- Pedido criado como **Retrabalho** só aceita a cobrança **E-Retrabalho**. PIX, boleto, cartão, faturado, permuta, amostra e crédito do cliente são recusados — na tela, na área do cliente, no pagamento combinado e no uso de crédito.
- **E-Retrabalho** só existe em pedido criado como **Retrabalho**, ou em pedido antigo que já teve uma E-Retrabalho, de antes de o vínculo passar a ser gravado.
- Retrabalho é cortesia e fica **fora do faturamento**: não entra nos cards e gráficos de faturamento da Conferência e do Dashboard, nem nos relatórios **Vendas**, **Curva ABC de clientes** e **Vendas por cidade**.
- Não há trava de fase: dá para abrir retrabalho de pedido em qualquer status, inclusive de um pedido que já é cópia. O que trava é a duplicação comum, que não pode partir de uma cópia.
- O retrabalho é um pedido independente: nasce com número novo e status NOVO, passa pela produção e pela expedição como qualquer pedido e precisa da cobrança liberada para seguir.
- A cotação e o valor do frete não são copiados. A cobrança e a arte aprovada também não.
- O vínculo guarda só o pedido imediatamente anterior. Numa cadeia de retrabalhos, cada um aponta para o anterior.

## O que não confundir

- **Retrabalho** x **Duplicação**: as duas opções da mesma janela. A duplicação é venda nova e entra no faturamento; o retrabalho é cortesia, exige E-Retrabalho e fica fora do faturamento.
- **Retrabalho** x **Criar Complemento**: o retrabalho refaz o pedido num pedido novo e independente; o complementar nasce sem itens, vinculado ao pedido original, e sai junto com ele na Expedição.
- **E-Retrabalho** x **E-Amostra** x **E-Permuta**: as três dependem de liberação do financeiro, mas só a E-Retrabalho marca o pedido como retrabalho e dá o destaque vermelho. E-Amostra e E-Permuta não ganham o destaque.
- Selo **Retrabalho de #<original>** x quadro **Retrabalho** do Dashboard: o selo é do pedido; o quadro conta as cobranças E-Retrabalho confirmadas no período e é só informativo.
- Retrabalho x refazer dentro do mesmo pedido: não existe refazer no mesmo pedido. Refazer é sempre um pedido novo, aberto pelo **Duplicar proposta**.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Você só pode duplicar proposta em que é o vendedor. Peça a um administrador ou a quem tem visão geral das propostas." | Tentativa de abrir retrabalho de pedido de outro vendedor, com perfil que vê só as próprias propostas. | Peça ao vendedor do pedido, a um administrador ou a quem vê todas as propostas. |
| "Não é permitido duplicar uma proposta que já é cópia. Ela só pode gerar um retrabalho." | Foi pedida uma **Duplicação** comum num pedido que já é cópia. | Escolha **Retrabalho**, ou duplique o pedido original da cadeia. |
| "E-Retrabalho só pode ser usado em pedido criado como Retrabalho" | A cobrança E-Retrabalho foi pedida num pedido que não nasceu como Retrabalho e nunca teve uma. | Abra o retrabalho pelo **Duplicar proposta**, opção **Retrabalho**, e gere a cobrança nele. |
| "Pedido de retrabalho só aceita cobrança E-Retrabalho" | Outra forma de pagamento foi pedida no pedido de retrabalho. | Use **E-Retrabalho**. |
| "Sessão não identificada. Entre de novo no sistema para duplicar a proposta." | A sessão expirou antes de a cópia ser criada. | Entre de novo no sistema e repita o **Duplicar proposta**. Nada foi criado. |
| "Erro na duplicação" ou "Erro inesperado" no aviso | A criação falhou no meio. | Recarregue a lista de Pedidos e confira se o pedido novo existe antes de tentar de novo, para não criar dois retrabalhos. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Pedidos (lista)](pedidos.md)
- [Conferência](conferencia.md)
- [Produção (ordens de serviço)](producao.md)
- [Expedição](expedicao.md)

## Arquivos de origem

- `src/features/orcamentos/hooks/useDuplicarProposta.tsx`
- `src/features/orcamentos/components/DuplicarPropostaModal.tsx`
- `src/features/orcamentos/lib/motivo-copia.ts`
- `src/features/orcamentos/lib/aviso-copia.ts`
- `src/lib/retrabalho.ts`
- `src/components/common/SeloRetrabalho.tsx`
- `src/features/cobrancas/lib/tipo-x-retrabalho.ts`
- `src/features/cobrancas/services/tipo-x-retrabalho.service.ts`
- `src/features/dashboard/sections/RetrabalhoSection.tsx`
- `src/features/dashboard/utils/retrabalho-resumo.ts`
- `supabase/migrations/20261019_propostas_motivo_copia.sql`
- `supabase/migrations/20261020_pagamentos_v2_tipo_x_motivo_copia.sql`
