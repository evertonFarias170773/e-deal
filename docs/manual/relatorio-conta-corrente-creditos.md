# Relatório: Conta Corrente e créditos

> **Última revisão:** 24/10/2026
> **Caminho no menu:** Relatórios → Financeiro → Conta Corrente e créditos
> **Endereço:** `/relatorios/financeiro/conta-corrente-creditos`

## Para que serve

Mostra o extrato dos lançamentos de crédito dos clientes em um período: créditos dados, créditos usados em pedido, estornos, devoluções e ajustes. Serve para o financeiro conferir quanto de crédito entrou e saiu em um mês, por cliente, e levar a lista para uma planilha.

É o **movimento do período**, não o saldo atual de cada cliente (o saldo está na tela **Conta Corrente** do menu Financeiro). O relatório só mostra números; não altera nada.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Conta Corrente e créditos** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor confere de novo a mesma permissão ao gerar os números.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Hoje** | Filtros, período | Mostra os lançamentos de hoje. |
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Tipo** | Filtros | Crédito e débito, só **Crédito** ou só **Débito**. |
| **Evento** | Filtros | Todos os eventos ou um: Abertura, Baixa, Bonificação, Cancelamento, Devolução, Estorno, Uso em pedido ou **Lançamento (sem evento)**. |
| **Origem** | Filtros | Todas as origens ou uma: Ajuste, Manual ou Sistema. |
| **Situação** | Filtros | **Válidos** (padrão) ou **Cancelados**. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Exportar CSV** | Topo da tela | Baixa o que a tabela mostra, na ordem atual, com a linha de total no fim. O arquivo abre direto no Excel em português. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver o crédito do mês

1. No menu, abra **Relatórios** e clique em **Financeiro**.
2. Clique em **Conta Corrente e créditos**. A tela abre em **Mês atual**.
3. Leia os cartões (**Créditos**, **Débitos**, **Saldo do período**, **Lançamentos** e **Clientes**) e a linha **Total** no fim da tabela.

### Ver só o crédito usado em pedidos

1. Escolha o período.
2. Em **Evento**, escolha **Uso em pedido**.
3. Clique em **Exportar CSV**, se quiser a lista.

Os filtros ficam no endereço da página: copiar o link leva quem receber ao mesmo período e aos mesmos filtros.

## Regras e bloqueios

- **A data usada é a do lançamento**, escrita no alto da tela: conta o dia em que o lançamento foi registrado, no horário de São Paulo.
- Por padrão só entram lançamentos **válidos**. Para ver os cancelados, use **Situação → Cancelados**; nesse caso os cartões e o total somam só os cancelados.
- **Saldo do período** é créditos menos débitos lançados no período. Ele não é o saldo atual do cliente.
- Não há filtro de **Empresa**: o lançamento de crédito não guarda a empresa.
- Os totais vêm calculados pelo sistema, não somados na tela; por isso batem com a lista toda, mesmo depois de ordenar.
- Período acima de 366 dias é recusado. Período com mais de dez mil lançamentos pede um período menor.

## O que não confundir

- **Conta Corrente e créditos** (este relatório) lista lançamentos de um período. A tela **Conta Corrente**, do menu Financeiro, mostra o saldo e as pendências de cada cliente.
- **Evento** e **Origem** são coisas diferentes: o evento diz o que aconteceu (uso em pedido, estorno...); a origem diz quem lançou (sistema, manual ou ajuste).

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Conta Corrente e créditos** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Não foi possível gerar o relatório. | Falha ao consultar o banco, ou lançamentos demais no período | Tentar de novo ou escolher um período menor. |

## Veja também

- [Relatório: Vendas](relatorio-vendas-pagas.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/conta-corrente-creditos.ts`
- `src/features/relatorios/registro.ts`
- `src/app/api/relatorios/`
