# Relatório: Conferência de pagamentos

> **Última revisão:** 25/10/2026
> **Caminho no menu:** Relatórios → Financeiro → Conferência de pagamentos
> **Endereço:** `/relatorios/financeiro/conferencia-pagamentos`

## Para que serve

Lista os pagamentos que entraram em um período, por data, empresa e forma de pagamento, para conferir com os extratos bancários. Tem **Baixar PDF** e **Imprimir** para levar o relatório para a conferência. O PDF traz o cabeçalho com empresa, período e filtros, os pagamentos agrupados por forma de pagamento com o subtotal de cada forma, o total geral e quem gerou o relatório. O cabeçalho da tabela (Data e hora, Pedido, Cliente, Empresa, Forma, Valor) se repete em todas as páginas.

O relatório só mostra números; não altera nada.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Conferência de pagamentos** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor e o banco conferem de novo a mesma permissão ao gerar a tela e o PDF.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Hoje** | Filtros, período | Mostra os pagamentos de hoje. |
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 93 dias. |
| **Empresa** | Filtros | Todas as empresas, Ideal Gráfica, Ideal Birô ou E3 Brindes. |
| **Forma de pagamento** | Filtros | Todas as formas ou uma: PIX, Boleto, Cartão de crédito, Cartão parcelado, Faturado, Crédito do cliente, Amostra, Retrabalho ou Permuta. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Baixar PDF** | Topo da tela | Gera o PDF com o período e os filtros da tela e baixa o arquivo. |
| **Imprimir** | Topo da tela | Gera o mesmo PDF e abre a janela de impressão. Se o navegador não abrir a impressão direto, o PDF abre em outra aba, onde há o botão de imprimir. |
| **Exportar CSV** | Topo da tela | Baixa a tabela em planilha, com a linha de total no fim. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Conferir um mês com o extrato

1. No menu, abra **Relatórios** e clique em **Financeiro**.
2. Clique em **Conferência de pagamentos** e escolha **Mês anterior** (ou **Personalizado**).
3. Em **Empresa**, escolha a empresa do extrato que você vai conferir.
4. Compare o cartão **Passa pelo banco** (PIX, boleto e cartão) com o extrato. Para conferir um meio de cada vez, escolha a **Forma de pagamento** (por exemplo, **PIX**).
5. Clique em **Baixar PDF** ou **Imprimir** para ter a lista de pagamentos por forma, com os subtotais.

## Regras e bloqueios

- **A data usada é a data do pagamento** (o dia em que o pagamento foi registrado como pago, no horário de São Paulo), escrita no alto da tela e do PDF. Assim a data bate com a do extrato.
- **Só entra o que foi pago.** Faturado a vencer não aparece no extrato e fica de fora. Vendas de teste também ficam de fora.
- **Passa pelo banco ou não.** PIX, boleto e cartão (de crédito e parcelado) passam pelo banco. **Faturado**, crédito do cliente, amostra, retrabalho e permuta são pagamentos pagos, mas não são conferidos com o extrato: aparecem na lista e nos subtotais com o aviso "Não passa pelo banco", e o **Total sem movimento no banco** soma esse grupo. O **Total que passa pelo banco** (PIX, boleto e cartão) é o que se confere com o extrato, e o **Total geral** soma os dois grupos.
- A forma de pagamento é unificada: "E-Faturado" e "E-FATURADO", por exemplo, aparecem juntos como **Faturado**.
- Os totais e subtotais vêm calculados pelo sistema, não somados na tela, e o PDF traz os mesmos números da tela.
- Período acima de 93 dias é recusado, e também o período com mais de 5.000 pagamentos ("Há registros demais no período. Escolha um período menor."). Um mês cheio tem cerca de 1.200 pagamentos e dá um PDF de cerca de 25 páginas, todas com o cabeçalho da tabela.

## O que não confundir

- Este relatório usa a **data do pagamento** e só o que está **pago**. A tela [Conferência](conferencia.md) mostra todas as cobranças (pagas, a vencer, canceladas...) pela data da confirmação; por isso os números do mesmo mês não coincidem. Em um mês, cerca de uma em cada dez cobranças pagas tem a confirmação em um dia e o pagamento em outro.
- **Passa pelo banco** é só uma marcação para ajudar na conferência; não muda o valor de nenhum pagamento. **Faturado** fica no grupo "sem movimento no banco": ele aparece na lista e no total geral, mas não entra no total para conferir com o extrato.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Conferência de pagamentos** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 93 dias. | O período personalizado passou de três meses | Escolher um período menor. |
| Há registros demais no período. Escolha um período menor. | Mais de 5.000 pagamentos no período | Dividir o período. |
| Não foi possível gerar o PDF. | Falha ao gerar o arquivo | Tentar de novo; se repetir, avisar o suporte. |

## Veja também

- [Conferência](conferencia.md)
- [Relatório: Conta Corrente e créditos](relatorio-conta-corrente-creditos.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/conferencia-pagamentos.ts`
- `src/features/relatorios/pdf/RelatorioPdfDocument.tsx`
- `src/features/relatorios/lib/arquivo.ts`
- `src/features/relatorios/registro.ts`
- `src/app/api/relatorios/`
- `supabase/migrations/20261024_relatorio_conferencia_pagamentos.sql`
- `supabase/migrations/20261025_relatorio_conferencia_pagamentos_agrupamento.sql`
