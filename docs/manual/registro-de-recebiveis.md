# Registro de recebíveis

> **Última revisão:** 01/10/2026
> **Onde fica:** menu Financeiro → Registro de recebíveis (endereço `/contas-a-receber/registro`)

## Para que serve

É a fila do que foi vendido faturado e ainda não virou título. Cada linha é uma cobrança E-Faturado já aprovada pelo financeiro que não tem boleto nem depósito lançado. Aqui você define as parcelas e gera os títulos, que passam a viver na [Carteira](carteira.md).

Quando a fila está vazia, todas as cobranças faturadas aprovadas já têm título.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Títulos** no perfil, além de Administrador e Super Admin.
- O botão **Gerar títulos** só funciona para quem tem a permissão **Emitir Boleto**, Administrador ou Super Admin. Para os demais ele fica apagado.
- A opção **Arredondar valores das parcelas** aparece só para Administrador e Super Admin.

## Passo a passo

### Entender a lista

Uma cobrança aparece aqui quando todas estas condições valem:

- É do tipo E-Faturado.
- Está a vencer e já foi confirmada pelo financeiro na [Conferência](conferencia.md).
- Ainda não teve títulos lançados, ou teve e eles foram cancelados na Carteira.
- A proposta não tem **nenhum** título ativo na Carteira. Título a vencer, vencido ou pago conta como ativo; só o cancelado não conta.

Assim que os títulos são gerados, a cobrança sai da lista.

**Cartões do topo**

| Cartão | O que mostra |
|---|---|
| **Valor total a registrar** | Soma das cobranças pendentes de lançamento. |
| **Registros pendentes** | Quantidade de cobranças aguardando geração de títulos. |
| **Bloqueados** | Quantas estão com empresa a definir. |

**Filtros**

- **Busca**: por cliente, número da OS ou da proposta, ou CPF/CNPJ.
- **Empresa**: **Todas as empresas** ou uma delas.
- **Limpar filtros**: limpa a busca e a empresa.
- **Atualizar** (no cabeçalho): recarrega a lista.

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

1. Na [Carteira](carteira.md), cancele **todas** as parcelas em aberto da proposta com **Cancelar recebível**.
2. Volte ao Registro de recebíveis e clique em **Atualizar**. A cobrança reaparece.
3. Clique em **Gerar títulos** e lance de novo.

## Regras e bloqueios

- Não dá para gerar títulos de uma cobrança com **Empresa a definir**. Regularize a empresa da cobrança antes.
- A cobrança só volta para esta lista quando a proposta não tem mais nenhum título ativo. Cancelar só uma parcela de um parcelamento não a traz de volta: as outras parcelas ainda estão ativas. É por isso que cancelar só uma parcela não deixa relançar.
- Se alguma parcela da proposta já foi paga, a cobrança não volta para esta lista, porque título pago não pode ser cancelado. Para trocar o boleto de uma parcela sem perder as outras, use os caminhos da Carteira: **Prorrogar vencimento**, ou **Cancelar boleto** seguido de **Transformar em boleto**.
- O lançamento é sempre do valor inteiro da cobrança. A soma das parcelas tem de ser igual ao total, com tolerância de um centavo. Enquanto não bater, **Confirmar Lançamento** fica apagado.
- O vencimento não pode ser anterior a hoje.
- Toda parcela precisa ter valor maior que zero.
- Não dá para lançar uma parcela que já tem título ativo na mesma proposta. Título cancelado não ocupa a parcela.
- A entrada não é lançada por aqui: o parcelamento divide o valor total da cobrança.
- Gerar os títulos não registra o boleto no banco. O registro é o passo seguinte, na janela **Revisar para Geração Bancária** da Carteira.
- Multa e juros nascem zerados em cada parcela. Preencha se for cobrar.
- Só aparecem em **Empresa recebedora** as empresas que têm modelo de boleto configurado.
- Ao mudar entre parcela única e parcelamento, as parcelas já geradas são descartadas. Clique em **Gerar Parcelas** de novo.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Botão **Gerar títulos** apagado, com "Empresa recebedora indefinida. Regularize a empresa da cobrança antes de gerar os títulos." | A cobrança está sem empresa. | Defina a empresa da cobrança e clique em **Atualizar**. |
| Botão **Gerar títulos** apagado, com "Você não possui a permissão cobrancas.emitir_boleto." | Seu perfil não tem a permissão **Emitir Boleto**. | Peça a um administrador. |
| A cobrança não aparece depois de cancelar uma parcela | Ainda há outra parcela ativa (a vencer, vencida ou paga) na proposta. | Cancele as demais parcelas em aberto, ou refaça só aquele boleto pela Carteira. |
| "Gere as parcelas antes de confirmar o lançamento." | Faltou clicar em **Gerar Parcelas**. | Gere as parcelas. |
| "A soma das parcelas (R$ ...) deve ser exatamente igual ao total (R$ ...)." | Os valores editados não fecham com a cobrança. | Ajuste os valores até a soma conferir. |
| "O vencimento não pode ser anterior à data atual." | Alguma parcela está com data no passado. | Corrija o vencimento. |
| "A parcela N/N não possui vencimento definido." | Parcela sem data. | Informe o vencimento. |
| "A parcela N/N deve ter valor superior a zero." | Parcela zerada ou negativa. | Corrija o valor. |
| "Selecione a empresa recebedora antes de confirmar o lançamento." | Nenhuma empresa válida escolhida. | Escolha a **Empresa recebedora**. |
| "Duplicidade detectada! A parcela N desta origem já possui um boleto ativo no Contas a Receber..." | Já existe título ativo para essa parcela na proposta. | Cancele o título atual na Carteira antes de lançar de novo. |
| "Selecione a data de vencimento da parcela única." | Parcela única marcada sem data. | Informe o **Vencimento da parcela única**. |
| "Aviso de Sincronização" | Os títulos foram criados, mas a cobrança não foi marcada como lançada. Ela pode continuar na lista. | Não gere de novo. Confira os títulos na Carteira e avise o administrador. |
| "Não foi possível carregar os recebíveis pendentes de registro." | Falha ao buscar a lista. | Clique em **Tentar novamente**. |
| "Nenhum recebível pendente de registro." | Não há cobrança aguardando títulos. | Nada a fazer. |

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Conferência](conferencia.md)
- [Notas fiscais](notas-fiscais.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
