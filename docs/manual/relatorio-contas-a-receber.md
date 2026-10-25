# Relatório: Contas a receber

> **Última revisão:** 25/10/2026
> **Caminho no menu:** Relatórios → Financeiro → Contas a receber
> **Endereço:** `/relatorios/financeiro/contas-a-receber`

## Para que serve

Lista os títulos em aberto, vencidos e a vencer, por data de vencimento, empresa e meio de pagamento. Serve para o financeiro cobrar, planejar o que vai entrar e conferir a Carteira. Tem **Baixar PDF** e **Imprimir**: o PDF traz o cabeçalho com período e filtros, os títulos agrupados por meio de pagamento com o subtotal de cada meio, os totais separando vencidas e a vencer, o total geral e quem gerou o relatório.

O relatório só mostra números; não altera nada.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Contas a receber** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor e o banco conferem de novo a mesma permissão ao gerar a tela e o PDF.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Hoje** | Filtros, período | Títulos que vencem hoje. |
| **Este mês inteiro** | Filtros, período | Do dia 1º ao último dia do mês atual. É o período ao abrir a tela. |
| **Próximo mês** | Filtros, período | O mês seguinte inteiro. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Empresa** | Filtros | Todas as empresas, Ideal Gráfica, Ideal Birô ou E3 Brindes. |
| **Meio de pagamento** | Filtros | Todos os meios, **Boleto** ou **Depósito em conta**. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Baixar PDF** | Topo da tela | Gera o PDF com o período e os filtros da tela e baixa o arquivo. |
| **Imprimir** | Topo da tela | Gera o mesmo PDF e abre a janela de impressão. Se o navegador não abrir a impressão direto, o PDF abre em outra aba, onde há o botão de imprimir. |
| **Exportar CSV** | Topo da tela | Baixa a tabela em planilha, com a linha de total no fim. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver o que vence no mês e o que está atrasado

1. No menu, abra **Relatórios** e clique em **Financeiro**.
2. Clique em **Contas a receber**. A tela abre em **Este mês inteiro**.
3. Leia os cartões (**Vencidas**, **A vencer**, **Total a receber** e **Títulos**), os subtotais por meio de pagamento e por empresa e a tabela, do vencimento mais antigo para o mais novo.
4. Para ver os atrasos antigos, use **Personalizado** com a data inicial anterior (por exemplo, o início do ano).
5. Clique em **Baixar PDF** ou **Imprimir** para levar o relatório.

### Conferir com os cartões da Carteira

Os cartões **Cobranças Vencidas** e **Cobranças a Receber** da [Carteira](carteira.md) somam a carteira inteira, sem recorte de data. Para igualar, escolha **Personalizado** com um período que cubra todos os vencimentos em aberto (da data do vencido mais antigo até o último vencimento a vencer).

## Regras e bloqueios

- **A data usada é o vencimento do título**, escrita no alto da tela e do PDF.
- **A regra é a da Carteira.** Entram os títulos **vencidos** e **a vencer**. Pagos e cancelados não entram, nem os títulos ainda não emitidos (os que na Carteira ficam como "A receber"). O faturado já confirmado entra como a Carteira o trata: pelos títulos (boletos e depósitos) que ele gerou, e não pelo pagamento da venda.
- **Valor** é o valor atualizado do título (com multa e juros dos vencidos), o mesmo dos cartões da Carteira.
- **Dias de atraso** só tem número nos vencidos. Em branco quer dizer que o título ainda não venceu.
- **Meio de pagamento** é o da Carteira: **Depósito em conta** quando o título é um depósito, senão **Boleto**. Hoje todos os títulos em aberto são de faturado.
- **Vendas de teste ficam de fora**, e isso é uma diferença para a Carteira, que ainda as mostra. Por isso o total de vencidas do relatório pode ficar abaixo do cartão da Carteira quando há título de venda de teste vencido.
- Os totais e subtotais vêm calculados pelo sistema, não somados na tela, e o PDF traz os mesmos números da tela. O cabeçalho da tabela se repete em todas as páginas do PDF.
- Período acima de 366 dias é recusado, e também o período com mais de 5.000 títulos ("Há registros demais no período. Escolha um período menor.").

## O que não confundir

- **Vencimento** é a data de pagar o título; não é a data do pedido nem do pagamento. O relatório de [Conferência de pagamentos](relatorio-conferencia-pagamentos.md) olha o que já entrou; este olha o que ainda vai entrar ou está atrasado.
- **Vencidas** e **A vencer** do relatório seguem a situação que a Carteira grava no título. Um título pode aparecer como a vencer até o sistema atualizar os atrasos do dia.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Contas a receber** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Há registros demais no período. Escolha um período menor. | Mais de 5.000 títulos no período | Dividir o período. |
| Não foi possível gerar o PDF. | Falha ao gerar o arquivo | Tentar de novo; se repetir, avisar o suporte. |

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Relatório: Conferência de pagamentos](relatorio-conferencia-pagamentos.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/contas-a-receber.ts`
- `src/features/relatorios/lib/periodo.ts`
- `src/features/relatorios/registro.ts`
- `supabase/migrations/20261025_relatorio_contas_a_receber.sql`
