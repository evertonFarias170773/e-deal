# Relatório: Vendas

> **Última revisão:** 24/10/2026
> **Caminho no menu:** Relatórios → Vendas → Vendas
> **Endereço:** `/relatorios/vendas/vendas-pagas`

## Para que serve

Lista as propostas que tiveram pagamento fechado em um período, sejam elas pagas ou faturadas a vencer já confirmadas, com cliente, vendedor, situação, forma de pagamento, empresa, valor com frete, frete e valor sem frete. Serve para conferir quanto cada vendedor, empresa ou forma de pagamento vendeu e levar a lista para uma planilha.

O relatório só mostra números; não altera nada. O menu **Relatórios** agrupa os relatórios por área: por enquanto só aparece a área **Vendas**.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Vendas** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê a área **Relatórios** no menu e, se abrir o endereço, recebe acesso negado. O servidor confere de novo a mesma permissão ao gerar os números.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Hoje** | Filtros, período | Mostra as vendas fechadas hoje. |
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Empresa** | Filtros | Todas as empresas, Ideal Gráfica, Ideal Birô ou E3 Brindes. |
| **Vendedor** | Filtros | Todos os vendedores ou um vendedor da lista. |
| **Situação** | Filtros | Todas as situações, **Pago** ou **Faturado a vencer**. |
| **Forma de pagamento** | Filtros | Todas as formas ou uma: PIX, Boleto, Cartão de crédito, Cartão parcelado, Faturado, Crédito do cliente ou Permuta. |
| **Limpar filtros** | Filtros | Volta ao padrão (mês atual, sem empresa, vendedor, situação ou forma). Só aparece quando há filtro ativo. |
| **Exportar CSV** | Topo da tela | Baixa o que a tabela mostra, na ordem atual, com a linha de total no fim. O arquivo abre direto no Excel em português. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver as vendas do mês

1. No menu, abra **Relatórios** e clique em **Vendas**.
2. Clique em **Vendas**. A tela abre em **Mês atual**.
3. Leia os cartões do topo (**Vendas**, **Total com frete**, **Pago**, **Faturado a vencer** e **Ticket médio**) e a linha **Total** no fim da tabela.

### Ver só o faturado a vencer de um vendedor e baixar a lista

1. Escolha o período (por exemplo, **Mês anterior**).
2. Em **Vendedor**, escolha o nome. Em **Situação**, escolha **Faturado a vencer**.
3. Clique em **Exportar CSV**.

Os filtros ficam no endereço da página: copiar o link leva quem receber ao mesmo período e aos mesmos filtros.

## Regras e bloqueios

- **A data usada é a data de fechamento do pedido**, e isso aparece escrito no alto da tela. A venda entra no período pelo dia em que o pedido foi fechado (a data da confirmação), no horário de São Paulo. É a mesma data do Dashboard, e os totais batem com ele no mesmo período e empresa.
- Entram as vendas **pagas** e as **faturadas a vencer já confirmadas**. A coluna **Situação** mostra **Pago**, **Faturado a vencer** ou **Pago e faturado a vencer** (quando a mesma proposta tem os dois no período).
- Uma proposta aparece uma vez no período. Se tiver fechamentos em dias diferentes, as duas datas (**1º fechamento** e **Último fechamento**) aparecem na linha.
- Ficam de fora: vendas de teste, amostra e retrabalho, cobranças canceladas e pagamentos sem data de confirmação (hoje só os faturados de abril e maio de 2026). Esses últimos também não aparecem no Dashboard.
- Os totais e a linha **Total** vêm calculados pelo sistema, não somados na tela; por isso batem com a lista toda, mesmo depois de ordenar.
- **Frete** é o frete da proposta. **Valor sem frete** é o valor com frete menos o frete.
- Período vazio mostra "Nada neste período". Período acima de 366 dias é recusado.

## O que não confundir

- Este relatório usa a **data de fechamento do pedido**. A [Carteira](carteira.md) usa a data de vencimento do título; a [Conferência](conferencia.md) mostra a confirmação por cobrança. Por isso o mesmo mês pode dar valores diferentes entre essas telas. O Dashboard usa a mesma data deste relatório.
- **Faturado a vencer** é venda fechada, mas ainda não recebida. O cartão **Pago** soma só o que já foi recebido.
- O seletor **Empresa** do topo do sistema não muda este relatório; use o filtro **Empresa** da própria tela.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Vendas** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Não foi possível gerar o relatório. | Falha ao consultar o banco | Tentar de novo; se repetir, avisar o suporte. |

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Conferência](conferencia.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/`
- `src/app/(erp)/relatorios/`
- `src/app/api/relatorios/`
- `src/constants/navigation.ts`
- `supabase/migrations/20261024_relatorio_vendas_pagas_permissao.sql`
- `supabase/migrations/20261024_relatorio_vendas_pagas_data_fechamento.sql`
- `supabase/migrations/20261024_relatorio_vendas_pagas_data_fechamento_corpo_proprio.sql`
