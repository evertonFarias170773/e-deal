# Relatório: Pagamento de comissão

> **Última revisão:** 05/11/2026
> **Caminho no menu:** Relatórios → Vendas → Pagamento de comissão
> **Endereço:** `/relatorios/vendas/pagamento-comissao`

## Para que serve

Mostra, uma linha por vendedor, quanto cada um vendeu no período, com frete e sem frete, e calcula a comissão pela tabela de faixas. De cada linha sai o **recibo de pagamento de comissão** em A4, pronto para imprimir e assinar. Serve para o pagamento mensal das comissões.

O relatório só mostra números e imprime o recibo; não grava nada. Não há histórico de recibos emitidos.

## Quem acessa

- A mesma permissão do relatório [Vendas](relatorio-vendas-pagas.md): **Relatório: Vendas** no perfil, além de Administrador e Super Admin. Não há permissão separada, porque o relatório mostra a venda e a comissão de todos os vendedores.
- Quem não tem a permissão recebe acesso negado na tela, na lista, no PDF e no recibo. O servidor confere de novo a permissão em cada um.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. É o período ao abrir a tela. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Base da comissão** | Filtros | **Com frete** ou **Sem frete**. Começa em **Escolha a base**: enquanto não escolhida, **% da comissão**, **Ticket médio** e **Valor da comissão** aparecem como "—". Os dois totais (com e sem frete) aparecem sempre. |
| **Ações** → **Imprimir recibo** | Fim de cada linha | Abre o diálogo do recibo do vendedor. |
| **Baixar PDF** / **Imprimir** | Topo da tela | PDF da lista de vendedores com a base escolhida. |
| **Exportar CSV** | Topo da tela | Planilha da lista, com a linha de total. |

### Diálogo Imprimir recibo

| Campo | O que faz |
|---|---|
| **Empresa** | Ideal Gráfica, Ideal Birô ou E3 Brindes. Define a razão social, o CNPJ, o endereço e a logo do recibo. Obrigatório. |
| **Base da comissão** | Vem marcada com a base do topo, mas pode ser trocada. Mostra a faixa e a comissão de cada base. |
| **Confirmo a base … para este recibo** | Precisa ser marcado; trocar a base desmarca. |
| **Forma de pagamento** | Opcional (PIX, Transferência bancária, ou o que for digitado). Em branco, o recibo sai com uma linha para preencher à mão. |
| **Data do pagamento** | Opcional. Em branco, o recibo sai com a linha da data para preencher à mão. |
| **Baixar PDF** / **Imprimir** | Gera o recibo. Só liberam com empresa escolhida e base confirmada. |

## Passo a passo

### Pagar as comissões do mês

1. No menu, abra **Relatórios** e clique em **Vendas**.
2. Clique em **Pagamento de comissão**. A tela abre no **Mês anterior**.
3. Em **Base da comissão**, escolha **Com frete** ou **Sem frete**.
4. Confira o **% da comissão** e o **Valor da comissão** de cada vendedor.
5. Na linha do vendedor, clique em **Ações** → **Imprimir recibo**.
6. Escolha a **Empresa**, confira a base e marque **Confirmo a base**. Se quiser, preencha forma e data do pagamento.
7. Clique em **Imprimir** (ou **Baixar PDF**) e colha a assinatura do vendedor.

## Regras e bloqueios

- **O que conta como venda é o mesmo do relatório [Vendas](relatorio-vendas-pagas.md)**: propostas com pagamento fechado no período, pagas ou faturadas a vencer, pela data de fechamento do pedido (dia de São Paulo). Ficam de fora vendas de teste, amostra e retrabalho.
- **O total de cada vendedor é o do relatório Vendas filtrado pelo mesmo vendedor e período**, com frete e sem frete, e a **Qtd de pedidos** é o número de vendas que ele mostra.
- **A venda é sempre do vendedor dono da proposta**, qualquer que seja quem lançou o pagamento (o vendedor, a Edina, o financeiro ou o cliente pela área do cliente). Vale para o total, a faixa de %, a comissão e o recibo. Cada pedido fica em um vendedor só: a soma das linhas é igual ao total do período, em pedidos e em valor.
- **Faixas da comissão**, pelo total do vendedor na base escolhida. O percentual vale sobre o total inteiro, não por degrau:

  | Total do vendedor | % |
  |---|---|
  | até R$ 100.000,00 (inclusive) | 5,00% |
  | acima de R$ 100.000,00 | 5,15% |
  | acima de R$ 150.000,00 | 5,30% |
  | acima de R$ 200.000,00 | 5,40% |
  | acima de R$ 250.000,00 | 5,50% |
  | acima de R$ 300.000,00 | 5,60% |
  | acima de R$ 350.000,00 | 5,70% |
  | acima de R$ 400.000,00 | 5,75% |

  Comissão = total × %, arredondada em centavos. Exemplo: R$ 161.257,99 cai em 5,30% e dá R$ 8.546,67.
- **Ticket médio** = total na base escolhida ÷ quantidade de pedidos.
- **O recibo refaz a conta no servidor** com a mesma permissão e o mesmo período da tela: o valor impresso é o da linha. Traz título, logo e dados da empresa, vendedor, período, total das vendas na base, % aplicado, comissão em destaque, forma e data do pagamento, o texto de quitação e a linha de assinatura com o nome do vendedor.
- Nada é gravado: imprimir o recibo de novo gera outro igual.

## O que não confundir

- **Vendas com frete / sem frete** nos cartões é o total do período inteiro, igual ao relatório Vendas sem filtro de vendedor. A linha **Total** da tabela é a soma das linhas.
- A logo da **Ideal Gráfica** no recibo é a mesma do PDF da OS.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado / Sem permissão para este relatório. | O perfil não tem **Relatório: Vendas** | Pedir a um administrador. |
| Escolha a base da comissão. | Recibo pedido sem base | Escolher a base no diálogo. |
| Vendedor sem venda neste período. | O vendedor não tem venda no período do recibo | Conferir o período da tela. |
| Não foi possível ler os dados da empresa. | Falha ao ler o cadastro da empresa | Tentar de novo. |
| Período máximo de 366 dias. | Período personalizado acima de um ano | Escolher um período menor. |

> **Mudança desta revisão:** 05/11/2026 — a venda passou a contar sempre para o vendedor dono da proposta, também quando o pagamento foi lançado por outra pessoa. Antes, o pagamento lançado por um vendedor ficava com quem lançou. Em outubro/2026 o Alexandre passou de 341 para 342 pedidos (o 24076, lançado pela Edina) e a Lisiane mudou de faixa, de 5,00% para 5,15%.

> **Mudança desta revisão:** 04/11/2026 — o pagamento feito pela área do cliente passou a contar para o vendedor dono da proposta, e a linha "Area do cliente" deixou de existir. Em outubro/2026 eram 392 pedidos (R$ 176.666,46) nessa linha; o total do período não muda.

## Veja também

- [Relatório: Vendas](relatorio-vendas-pagas.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/pagamento-comissao.ts`
- `src/features/relatorios/lib/comissao.ts`
- `src/features/relatorios/acoes/`
- `src/features/relatorios/pdf/ReciboComissaoPdf.tsx`
- `src/features/relatorios/ReportPage.tsx`
- `src/app/api/relatorios/`
