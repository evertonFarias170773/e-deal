# Relatório: Vendas pagas

> **Última revisão:** 24/10/2026
> **Caminho no menu:** Relatórios → Vendas → Vendas pagas
> **Endereço:** `/relatorios/vendas/vendas-pagas`

## Para que serve

Lista as propostas que tiveram pagamento confirmado em um período, com cliente, vendedor, forma de pagamento, empresa, valor com frete, frete e valor sem frete. Serve para conferir quanto cada vendedor, empresa ou forma de pagamento vendeu e levar a lista para uma planilha.

O relatório só mostra números; não altera nada. A tela **Relatórios** (menu) agrupa os relatórios por área: por enquanto só aparece a área **Vendas**.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Vendas pagas** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê a área **Relatórios** no menu e, se abrir o endereço, recebe acesso negado. O servidor confere de novo a mesma permissão ao gerar os números.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Hoje** | Filtros, período | Mostra os pagamentos de hoje. |
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Empresa** | Filtros | Todas as empresas, Ideal Gráfica, Ideal Birô ou E3 Brindes. |
| **Vendedor** | Filtros | Todos os vendedores ou um vendedor da lista. |
| **Forma de pagamento** | Filtros | Todas as formas ou uma: PIX, Boleto, Cartão de crédito, Cartão parcelado, Faturado, Crédito do cliente, Amostra, Permuta ou Retrabalho. |
| **Limpar filtros** | Filtros | Volta ao padrão (mês atual, sem empresa, vendedor ou forma). Só aparece quando há filtro ativo. |
| **Exportar CSV** | Topo da tela | Baixa o que a tabela mostra, na ordem atual, com a linha de total no fim. O arquivo abre direto no Excel em português. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver as vendas pagas do mês

1. No menu, abra **Relatórios** e clique em **Vendas**.
2. Clique em **Vendas pagas**. A tela abre em **Mês atual**.
3. Leia os cartões do topo (**Vendas pagas**, **Total com frete**, **Frete**, **Total sem frete** e **Ticket médio**) e a linha **Total** no fim da tabela.

### Filtrar por vendedor e baixar a lista

1. Escolha o período (por exemplo, **Mês anterior**).
2. Em **Vendedor**, escolha o nome.
3. Clique em **Exportar CSV**.

Os filtros ficam no endereço da página: copiar o link leva quem receber ao mesmo período e aos mesmos filtros.

## Regras e bloqueios

- **A data usada é a do pagamento**, e isso aparece escrito no alto da tela. Conta o dia em que o pagamento foi registrado, no horário de São Paulo. Uma venda aparece uma vez, no período em que teve pagamento; se tiver pagamentos em dias diferentes, as duas datas (**1º pagamento** e **Último pagamento**) aparecem na linha.
- Entram os pagamentos confirmados. As vendas de teste ficam de fora, como no faturamento e no ranking.
- Os totais e a linha **Total** vêm calculados pelo sistema, não somados na tela; por isso batem com a lista toda, mesmo depois de ordenar.
- **Frete** é o frete da proposta. **Valor sem frete** é o valor com frete menos o frete.
- Período vazio mostra "Nada neste período". Período acima de 366 dias é recusado.

## O que não confundir

- **Vendas pagas** usa a data do pagamento. A [Carteira](carteira.md) usa a data de vencimento do título, e o **Dashboard** e a [Conferência](conferencia.md) usam a data da confirmação. Por isso o mesmo mês pode dar valores diferentes entre essas telas.
- O seletor **Empresa** do topo do sistema não muda este relatório; use o filtro **Empresa** da própria tela.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Vendas pagas** | Pedir a um administrador. |
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
