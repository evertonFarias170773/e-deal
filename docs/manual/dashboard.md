# Dashboard (painel executivo e período de análise)

> **Última revisão:** 05/11/2026
> **Caminho no menu:** Dashboard
> **Endereço:** `/dashboard`

## Para que serve

Mostra num lugar só os indicadores do período escolhido: os cartões do topo (Faturamento, Contas a receber, Propostas criadas, Conversão, OS em produção, NF emitidas) e os quadros Financeiro, Comercial, Produção, Fiscal e Clientes. Cada indicador compara o período escolhido com o período anterior equivalente ("vs período anterior").

## Quem acessa

- Todos os perfis, menos o vendedor: o vendedor não vê o Dashboard no menu e, se abrir o endereço, vai para o [Meu desempenho](meu-desempenho.md).
- **Ranking de vendedores** e **Saúde da infraestrutura** aparecem só para administrador e super admin.
- O seletor **Empresa** do topo do sistema muda os números do Dashboard.

## Botões e ações da tela

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| Lista de período | Canto do título | **Hoje**, **Últimos 7 dias**, **Mês atual**, **Mês anterior**, **Últimos 30 dias**, **Trimestre**, **Semestre**, **Ano** ou **Personalizado**. Escolher um item da lista já atualiza a tela. O padrão é **Mês atual**. |
| Campos de data inicial e final | Ao lado da lista, só em **Personalizado** | Recebem o início e o fim do período. Escrever ou escolher no calendário não recarrega a tela. |
| **Aplicar** | Ao lado das datas, só em **Personalizado** | Atualiza a tela com o período escolhido. Também vale apertar Enter num dos campos. Fica apagado enquanto alguma data está incompleta, igual à já aplicada, ou a inicial está depois da final. |

## Passo a passo

### Ver o mês fechado anterior

1. Na lista de período, escolha **Mês anterior**.
2. A tela mostra do dia 1 ao último dia do mês passado (em novembro, 01/10 a 31/10) e compara com o mês anterior a ele inteiro (setembro).

### Escolher um período personalizado (ex.: 01/10 a 15/10)

1. Na lista de período, escolha **Personalizado**. Os campos já vêm com o período que estava na tela.
2. No campo da data inicial, digite ou escolha **01/10/2026**.
3. No campo da data final, digite ou escolha **15/10/2026**.
4. Clique em **Aplicar** (ou aperte Enter).

## Regras e bloqueios

- **Período anterior de cada opção** (o "vs período anterior" dos cartões):
  - **Mês atual**, **Trimestre**, **Semestre** e **Ano**: os mesmos dias do mês, trimestre, semestre ou ano anterior. Em 05/11, o **Mês atual** (01/11 a 05/11) compara com 01/10 a 05/10. Mês inteiro compara com o mês anterior inteiro.
  - **Mês anterior**: o mês inteiro antes dele.
  - **Hoje**, **Últimos 7 dias** e **Últimos 30 dias**: o mesmo número de dias logo antes.
  - **Personalizado**: quando o intervalo começa no dia 1 de um mês e termina dentro dele, compara como **Mês atual** ou **Mês anterior**: 01/11 a 05/11 compara com 01/10 a 05/10, e 01/10 a 31/10 com setembro inteiro. O mesmo vale para intervalo que começa no 1º dia de um trimestre, semestre ou ano e termina dentro dele. Os outros intervalos comparam com o mesmo número de dias logo antes (10/10 a 20/10 compara com 29/09 a 09/10).
- O mesmo intervalo dá a mesma variação pela opção pronta e pelo **Personalizado**. Exceção: quando o período de **Trimestre**, **Semestre** ou **Ano** ainda cabe num ciclo menor, o **Personalizado** com o mesmo intervalo compara pelo ciclo menor. Por exemplo, em 05/10 o **Trimestre** (01/10 a 05/10) compara com 01/07 a 05/07; o mesmo intervalo no **Personalizado** compara como mês, com 01/09 a 05/09. Em fevereiro, o **Ano** cabe no 1º trimestre.
- O período e a data de hoje seguem o horário de São Paulo.
- No **Personalizado**, data com ano fora de 2000 a 2100 ou dia que não existe (31/02) não é aceita: o **Aplicar** fica apagado.

## O que não confundir

- **Mês atual** × **Mês anterior**: o primeiro vai do dia 1 até hoje; o segundo é o mês passado inteiro.
- **Mês atual** × **Últimos 30 dias**: o primeiro começa no dia 1; o segundo conta 30 dias para trás a partir de hoje, e compara com os 30 dias antes deles.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Não foi possível carregar os indicadores | Falha ao consultar o banco | Recarregar a página ou tentar de novo em instantes. Nenhum número aparece, para não confundir falha com zero. |
| A data inicial é depois da final. | No **Personalizado**, o início ficou depois do fim | Corrigir uma das datas; o **Aplicar** volta a funcionar. |
| "Novo no período" no lugar da variação | O período anterior não teve nenhum valor para comparar | Normal: não há porcentagem sobre zero. |

## Veja também

- [Meu desempenho](meu-desempenho.md)
- [Relatório: Vendas](relatorio-vendas-pagas.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/dashboard/DashboardPage.tsx`
- `src/components/common/PeriodSelector.tsx`
- `src/lib/period.ts`
- `src/features/dashboard/utils/trend.ts`
