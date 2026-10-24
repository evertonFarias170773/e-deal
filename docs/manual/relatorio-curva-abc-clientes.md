# Relatório: Curva ABC de clientes

> **Última revisão:** 24/10/2026
> **Caminho no menu:** Relatórios → Vendas → Curva ABC de clientes
> **Endereço:** `/relatorios/vendas/curva-abc-clientes`

## Para que serve

Ordena os clientes pelo valor vendido a cada um no período e mostra quanto cada cliente pesa no total, o acumulado e a classe: **A** (os que completam os primeiros 80% do valor), **B** (até 95%) e **C** (o restante). Serve para ver em quem a venda está concentrada e levar o ranking para uma planilha.

O relatório só mostra números; não altera nada. Ele **não** é a mesma conta do ranking que existe na tela de Clientes: aquele conta só os pedidos que estão hoje no status Aprovado, sem período. Este conta as vendas fechadas no período escolhido.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Curva ABC de clientes** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor e o banco conferem de novo a mesma permissão ao gerar os números.

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
| **Valor** | Filtros | **Sem frete** (padrão) ou **Com frete**. A classe é calculada sobre o valor escolhido. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Exportar CSV** | Topo da tela | Baixa o que a tabela mostra, na ordem atual, com a linha de total no fim. O arquivo abre direto no Excel em português. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver a curva do mês

1. No menu, abra **Relatórios** e clique em **Vendas**.
2. Clique em **Curva ABC de clientes**. A tela abre em **Mês atual**, em **Sem frete**.
3. Leia os cartões (**Valor total**, **Classe A**, **Classe B**, **Classe C** e **Clientes**) e a tabela, que vem da maior venda para a menor.

### Ver só a carteira de um vendedor

1. Escolha o período.
2. Em **Vendedor**, escolha o nome. A curva passa a considerar só as vendas dele.
3. Clique em **Exportar CSV**, se quiser a lista.

Os filtros ficam no endereço da página: copiar o link leva quem receber ao mesmo período e aos mesmos filtros.

## Regras e bloqueios

- **A data usada é a data de fechamento do pedido**, escrita no alto da tela, junto com o valor que está ativo (**Valor mostrado: sem frete** ou **com frete**). A venda entra no período pelo dia em que o pedido foi fechado, seja paga ou faturada a vencer já confirmada: é a mesma regra do relatório [Vendas](relatorio-vendas-pagas.md) e do Dashboard.
- Ficam de fora vendas de teste, amostra e retrabalho, cobranças canceladas e pagamentos sem data de confirmação (hoje só os faturados de abril e maio de 2026).
- **Classes:** o cliente que faz o acumulado passar de 80% ainda é **A**; a **B** vai até 95%; a **C** é o resto. Por isso a classe A fica um pouco acima de 80% do valor.
- O **Valor** de cada cliente é a soma dos seus pedidos do período. **Sem frete** é o valor pago menos o frete do pedido; quando o pedido tem pagamentos em períodos diferentes, o frete inteiro sai do período em que cada parte foi paga.
- Os totais, as porcentagens e a classe vêm calculados pelo sistema, não somados na tela; a coluna **% do total** fecha em 100% e o **Total** bate com o relatório Vendas no mesmo período e empresa.
- Período vazio mostra "Nada neste período". Período acima de 366 dias é recusado.

## O que não confundir

- **Curva ABC de clientes** conta o valor das vendas fechadas no período. A tela de Clientes tem um ranking antigo que conta só os pedidos hoje em Aprovado, sem período; os números não coincidem de propósito.
- **% do total** é a fatia do cliente; **% acumulado** é a soma das fatias até ele, e é com ela que a classe é definida.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Curva ABC de clientes** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Não foi possível gerar o relatório. | Falha ao consultar o banco | Tentar de novo; se repetir, avisar o suporte. |

## Veja também

- [Relatório: Vendas](relatorio-vendas-pagas.md)
- [Relatório: Vendas por cidade](relatorio-vendas-por-cidade.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/curva-abc-clientes.ts`
- `src/features/relatorios/lib/valor.ts`
- `src/features/relatorios/registro.ts`
- `supabase/migrations/20261024_relatorios_lote1b_curva_abc_cidades.sql`
