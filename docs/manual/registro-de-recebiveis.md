# Registro de recebíveis

> **Última revisão:** 09/10/2026
> **Caminho no menu:** Financeiro → Registro de recebíveis
> **Endereço:** `/contas-a-receber/registro`

## Para que serve

É a fila do que foi vendido faturado e ainda não virou título. Cada linha é uma cobrança E-Faturado já aprovada pelo financeiro que não tem boleto nem depósito lançado. Aqui você define as parcelas e gera os títulos, que passam a viver na [Carteira](carteira.md).

Quando a fila está vazia, todas as cobranças faturadas aprovadas já têm título.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Títulos** no perfil, além de Administrador e Super Admin.
- O botão **Gerar títulos** só funciona para quem tem a permissão **Emitir Boleto**, Administrador ou Super Admin. Para os demais ele fica apagado.
- A opção **Arredondar valores das parcelas** aparece só para Administrador e Super Admin.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Atualizar** | Cabeçalho da tela, à direita do título | Recarrega a lista. |
| **Valor total a registrar** | Cartão do topo (não clicável) | Soma das cobranças pendentes de lançamento. |
| **Registros pendentes** | Cartão do topo (não clicável) | Quantidade de cobranças aguardando geração de títulos. |
| **Bloqueados** | Cartão do topo (não clicável) | Quantas cobranças estão com empresa a definir. |
| Campo **Buscar por cliente, OS ou CPF/CNPJ** | Barra de filtros | Filtra por cliente, número da OS ou da proposta, ou CPF/CNPJ. |
| **Todas as empresas** | Barra de filtros | Filtra pela empresa que recebe. |
| **Limpar filtros** | Barra de filtros; apagado quando não há filtro | Limpa a busca e a empresa. |
| **Gerar títulos** | Na linha da cobrança, coluna **Ações** | Abre a janela **Preparar Cobrança**. Fica apagado quando há bloqueio; passe o mouse para ler o motivo. |
| **Tentar novamente** | No aviso de erro, quando a lista não carrega | Recarrega a lista. |
| **Empresa recebedora** | Janela **Preparar Cobrança**, quadro do topo | Escolhe a empresa que emite e recebe. Trocar muda o banco emissor e o faturamento da cobrança. |
| **Condição de Pagamento** (**Selecionar condição...**) | Janela **Preparar Cobrança** | Preenche quantidade de parcelas, dias para a primeira e intervalo. |
| Campo **Número da NF (opcional)** | Janela **Preparar Cobrança** | Número da nota que vai nos títulos. |
| Caixa **Parcela única com vencimento específico** | Janela **Preparar Cobrança**, em **Gerar Parcelas Automaticamente** | Troca o parcelamento por uma parcela só, com a data escolhida em **Vencimento da parcela única**. |
| Campos **Qtd de parcelas futuras**, **Dias para 1ª parcela** e **Intervalo entre parcelas (Dias)** | Janela **Preparar Cobrança** | Definem o parcelamento. |
| Caixa **Arredondar valores das parcelas** | Janela **Preparar Cobrança** (só Administrador e Super Admin) | Gera parcelas em valores redondos, com a diferença na última. |
| **Gerar Parcelas** | Janela **Preparar Cobrança** | Monta as parcelas para revisão. Ainda não grava nada. |
| Caixa **Depósito em conta** | Janela **Preparar Cobrança**, em cada parcela | Lança a parcela como depósito, sem boleto. |
| **Confirmar Lançamento** | Rodapé da janela **Preparar Cobrança** | Cria os títulos e abre a Carteira para registrar os boletos. |
| **Cancelar** | Rodapé da janela **Preparar Cobrança** | Fecha a janela sem lançar. |
| Botão com ícone de X (sem texto) | Canto da janela **Preparar Cobrança** | Fecha a janela sem lançar. |

## Passo a passo

### Entender a lista

Uma cobrança aparece aqui quando todas estas condições valem:

- É do tipo E-Faturado.
- Está a vencer e já foi confirmada pelo financeiro na [Conferência](conferencia.md).
- Ainda não teve títulos lançados, ou teve e eles foram cancelados na Carteira.
- A proposta não tem **nenhum** título ativo na Carteira. Título a vencer, vencido ou pago conta como ativo; só o cancelado não conta.

Assim que os títulos são gerados, a cobrança sai da lista.

Os cartões do topo somam a lista inteira, sem olhar a busca e o filtro de empresa. Os filtros ficam no endereço da página: sobrevivem a atualizar a tela e podem ser enviados por link.

**Colunas**

| Coluna | Significado |
|---|---|
| **OS / Ref** | Número da OS e, abaixo, o número da proposta. |
| **Cliente** | Nome e CPF/CNPJ. |
| **Empresa** | Empresa que recebe. Mostra **A definir** quando a cobrança ainda não tem empresa. |
| **Condição** | Forma de faturamento e o parcelamento combinado na venda, por exemplo "3x · início 30d · intervalo 30d". |
| **Valor** | Valor da cobrança. |
| **Vencimento previsto** | Data prevista, ou **A definir**. |
| **Situação** | **Pronto para registro** ou **Empresa a definir**. |
| **Ações** | Botão **Gerar títulos**. |

### Gerar os títulos de uma cobrança

1. Localize a cobrança e clique em **Gerar títulos**. Abre a janela **Preparar Cobrança**.
2. Confira **Cliente**, **Documento** e **Valor Total**. Em **Empresa recebedora**, mantenha ou troque a empresa. Trocar muda o banco que emite o boleto e o faturamento da cobrança.
3. Em **Condição de Pagamento**, escolha uma condição. Ela preenche **Qtd de parcelas futuras**, **Dias para 1ª parcela** e **Intervalo entre parcelas (Dias)**, que você pode ajustar. O parcelamento combinado na venda já vem preenchido.
4. Se quiser, informe o **Número da NF (opcional)**. Quando a proposta tem nota fiscal autorizada, o número já vem preenchido.
5. Clique em **Gerar Parcelas**.
6. Em **Parcelas do Contas a Receber**, revise cada parcela: **Valor**, **Vencimento**, **Descrição**, **Multa (%)** e **Juros/Dia (%)**.
7. Confira o quadro **Revisão do lançamento**. A linha **Soma das parcelas** precisa mostrar "Confere com o total".
8. Clique em **Confirmar Lançamento**.

O sistema cria os títulos e leva você para a Carteira, já filtrada pela proposta, com a janela **Revisar para Geração Bancária** aberta para registrar os boletos no banco. Os passos seguintes estão em [Carteira](carteira.md).

### Gerar uma parcela única com data escolhida

1. Na janela **Preparar Cobrança**, marque **Parcela única com vencimento específico**.
2. Informe o **Vencimento da parcela única**.
3. Clique em **Gerar Parcelas** e depois em **Confirmar Lançamento**.

Sai uma parcela só, com o valor total da cobrança.

### Lançar uma parcela como depósito em conta

1. Depois de **Gerar Parcelas**, marque **Depósito em conta** na parcela desejada.
2. A parcela mostra o selo **Selecionado** e, na **Revisão do lançamento**, o tipo **Depósito em conta**.
3. Clique em **Confirmar Lançamento**.

Essa parcela entra na Carteira como depósito, sem boleto. A baixa é manual, quando o cliente pagar. Você pode misturar boleto e depósito no mesmo lançamento.

### Arredondar as parcelas

1. Marque **Arredondar valores das parcelas** antes de **Gerar Parcelas**.
2. As parcelas saem em valores redondos e a diferença vai para a última, marcada como **Ajustada**. O total da cobrança é preservado.

### Refazer os títulos de uma cobrança

Use só quando o parcelamento inteiro precisa ser refeito. Para trocar o boleto de uma única parcela, o caminho é o **Refazer boleto**, na [Carteira](carteira.md), que não passa por esta tela.

1. Na [Carteira](carteira.md), cancele **todas** as parcelas em aberto da proposta com **Cancelar recebível**.
2. Volte ao Registro de recebíveis e clique em **Atualizar**. A cobrança reaparece.
3. Clique em **Gerar títulos** e lance de novo.

## Regras e bloqueios

- Referência do título: é o código que identifica cada parcela no banco e no link do boleto, e não pode se repetir entre títulos ativos. Em faturado de duas parcelas ou mais, cada parcela recebe a sua, no formato P + parcela + total de parcelas + número da proposta (a parcela 2 de 3 da proposta 23181 é P2323181), com ou sem nota fiscal; o número da nota continua aparecendo no título. Só o faturado de parcela única usa a referência da nota, quando ela já está autorizada.
- Não dá para gerar títulos de uma cobrança com **Empresa a definir**. Regularize a empresa da cobrança antes.
- A cobrança só volta para esta lista quando a proposta não tem mais nenhum título ativo. Cancelar só uma parcela de um parcelamento não a traz de volta: as outras parcelas ainda estão ativas. É por isso que cancelar só uma parcela não deixa relançar.
- Se alguma parcela da proposta já foi paga, a cobrança não volta para esta lista, porque título pago não pode ser cancelado. Para trocar o boleto de uma parcela sem perder as outras, use os caminhos da Carteira: **Refazer boleto** (o indicado), **Prorrogar vencimento** quando só a data muda, ou **Cancelar boleto** seguido de **Transformar em boleto** quando o valor muda.
- **Refazer boleto** e **Prorrogar vencimento**, na Carteira, não devolvem a cobrança para esta lista: a parcela continua ativa.
- O lançamento é sempre do valor inteiro da cobrança. A soma das parcelas tem de ser igual ao total, com tolerância de um centavo. Enquanto não bater, **Confirmar Lançamento** fica apagado.
- O vencimento não pode ser anterior a hoje.
- Toda parcela precisa ter valor maior que zero.
- Não dá para lançar uma parcela que já tem título ativo na mesma proposta. Título cancelado não ocupa a parcela.
- A entrada não é lançada por aqui: o parcelamento divide o valor total da cobrança.
- Gerar os títulos não registra o boleto no banco. O registro é o passo seguinte, na janela **Revisar para Geração Bancária** da Carteira. Registrar no banco exige a permissão **Administrar Contas a Receber**; quem só gera os títulos e não a tem recebe "Sem permissão para registrar boleto no banco (contas_receber.admin)."
- Multa e juros nascem zerados em cada parcela. Preencha se for cobrar.
- Só aparecem em **Empresa recebedora** as empresas que têm modelo de boleto configurado.
- Ao mudar entre parcela única e parcelamento, as parcelas já geradas são descartadas. Clique em **Gerar Parcelas** de novo.

## O que não confundir

- **Registro de recebíveis**, **Carteira** e **Conferência**: a Conferência confere a cobrança do pedido; o Registro transforma a cobrança faturada já conferida em títulos; a Carteira acompanha e opera esses títulos (registrar no banco, baixar, prorrogar, cancelar).
- **Cobrança** e **título**: cada linha desta tela é uma cobrança; os títulos são as parcelas que nascem dela e passam a aparecer na Carteira.
- **Gerar títulos** e **Gerar Parcelas**: o primeiro abre a janela **Preparar Cobrança**; o segundo, dentro da janela, só monta as parcelas para revisão. Quem grava é **Confirmar Lançamento**.
- **Confirmar Lançamento** e **Registrar boleto** (na Carteira): o lançamento cria o título; o boleto só existe no banco depois do registro.
- **Refazer os títulos** (cancelar todas as parcelas e gerar de novo aqui) e **Refazer boleto** (na Carteira): o primeiro refaz o parcelamento inteiro; o segundo troca o boleto de uma parcela sem passar por esta tela.
- **Boleto** e **Depósito em conta** (no quadro **Revisão do lançamento**): boleto vai ao banco; depósito em conta fica na Carteira sem boleto e recebe baixa manual.
- **Vencimento previsto** (coluna) e **Vencimento** (de cada parcela): o primeiro é a data prevista da cobrança; o que vale para o título é o vencimento definido em cada parcela na janela.
- **Empresa** (coluna) e **Empresa recebedora** (janela): a coluna mostra a empresa atual da cobrança; a escolha na janela vale para o lançamento e passa a ser a empresa da cobrança.
- Cartão **Bloqueados** e botão **Gerar títulos** apagado: o cartão conta só as cobranças com empresa a definir; o botão também fica apagado para quem não tem a permissão **Emitir Boleto**.
- **Cancelar** (rodapé da janela) e **Cancelar recebível** (na Carteira): **Cancelar** só fecha a janela.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Botão **Gerar títulos** apagado, com "Empresa recebedora indefinida. Regularize a empresa da cobrança antes de gerar os títulos." | A cobrança está sem empresa. | Defina a empresa da cobrança e clique em **Atualizar**. |
| Botão **Gerar títulos** apagado, com "Você não possui a permissão cobrancas.emitir_boleto." | Seu perfil não tem a permissão **Emitir Boleto**. | Peça a um administrador. |
| A cobrança não aparece depois de cancelar uma parcela | Ainda há outra parcela ativa (a vencer, vencida ou paga) na proposta. | Cancele as demais parcelas em aberto para refazer tudo. Da próxima vez, use **Refazer boleto** na Carteira em vez de cancelar. |
| "Gere as parcelas antes de confirmar o lançamento." | Faltou clicar em **Gerar Parcelas**. | Gere as parcelas. |
| "A soma das parcelas (R$ ...) deve ser exatamente igual ao total (R$ ...)." | Os valores editados não fecham com a cobrança. | Ajuste os valores até a soma conferir. |
| "O vencimento não pode ser anterior à data atual." | Alguma parcela está com data no passado. | Corrija o vencimento. |
| "A parcela N/N não possui vencimento definido." | Parcela sem data. | Informe o vencimento. |
| "A parcela N/N deve ter valor superior a zero." | Parcela zerada ou negativa. | Corrija o valor. |
| "Selecione a empresa recebedora antes de confirmar o lançamento." | Nenhuma empresa válida escolhida. | Escolha a **Empresa recebedora**. |
| "Duplicidade detectada! A parcela N desta origem já possui um boleto ativo no Contas a Receber..." | Já existe título ativo para essa parcela na proposta. | Cancele o título atual na Carteira antes de lançar de novo. |
| "duplicate key value violates unique constraint \"idx_boletos_n_doc_boleto_ativo\"" ou "Duas parcelas deste lançamento ficaram com a mesma referência" | Dois títulos ativos ficariam com a mesma referência. Acontecia em faturado parcelado preparado depois de a nota fiscal sair; corrigido em 09/10/2026. | Nada foi gravado e nenhum boleto foi criado no banco. Recarregue a página e gere os títulos de novo. Se repetir, não insista: avise o suporte com o número da proposta. |
| "Selecione a data de vencimento da parcela única." | Parcela única marcada sem data. | Informe o **Vencimento da parcela única**. |
| "Aviso de Sincronização" | Os títulos foram criados, mas a cobrança não foi marcada como lançada. Ela pode continuar na lista. | Não gere de novo. Confira os títulos na Carteira e avise o administrador. |
| "Não foi possível carregar os recebíveis pendentes de registro." | Falha ao buscar a lista. | Clique em **Tentar novamente**. |
| "Nenhum recebível pendente de registro." | Não há cobrança aguardando títulos. | Nada a fazer. |

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Conferência](conferencia.md)
- [Notas fiscais](notas-fiscais.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/contas-a-receber/registro/page.tsx`
- `src/features/contas-a-receber/registro-recebiveis/`
- `src/features/cobrancas/PrepararBoletosModal.tsx`
- `src/features/cobrancas/lib/referencia-do-boleto.ts`
- `src/features/contas-a-receber/ContasReceberPage.tsx`
- `src/components/common/PermissionGuard.tsx`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
- `src/constants/navigation.ts`
