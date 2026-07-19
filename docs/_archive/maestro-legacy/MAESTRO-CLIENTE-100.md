<!--
STATUS DOCUMENTAL: HISTÓRICO / LEGADO
ORIGEM: Maestro Simple v1 — fase Cliente 100%
NÃO USAR COMO FONTE OFICIAL ATUAL.

Fontes vigentes relacionadas:
- ../../maestro/MAESTRO-KNOWLEDGE-BASE.md
- ../../maestro/MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md
- ../../maestro/MAESTRO-FASE-2-PEDIDOS-FINANCEIRO.md
- ../../maestro/STATUS-MAESTRO-V2.md

Este arquivo é preservado apenas para rastreabilidade da evolução do Maestro.
-->

> **Status:** Histórico — Maestro Simple v1  
> **Uso permitido:** consulta de contexto antigo e decisões já superadas.  
> **Não utilizar para definir capacidades, arquitetura ou fase atual do Maestro.**

---

# MAESTRO — Arquitetura de Dados: Fase Cliente 100%

> **Fase 1 do Maestro Simple v1.**
> Documentação oficial do mapa de relacionamentos do cliente no ERP Ideal para consumo do Maestro.
> Nenhuma tabela de pedidos ou propostas é acessada nesta fase.

---

## 1. O Conceito de "Cliente Detalhado"

Na Fase 1, o Maestro foi evoluído para não depender exclusivamente da view `vw_cadastros_clientes_lista`. Uma vez que o cliente é localizado, o Maestro busca ativamente seus dados em quatro tabelas distintas para compor o contexto completo (`SimpleClientContext`).

### Tabela Base: `public.clientes`

A entidade principal do cliente.
- **Chave de ligação:** `id_cliente` (inteiro interno).
- **Chave de exibição:** `id_cliente_text` (usada pelo usuário, ex: "8469").

**Campos extraídos para o Maestro:**
- `nome`, `fantasia`, `documento`, `tipo_pessoa`
- `telefone_fixo`, `whatsapp_1`, `whatsapp_2`
- `email`, `email_contato`, `email_financeiro`
- `cidade_uf` (Campo desnormalizado contendo a cidade oficial do cadastro).
- `nome_vendedor`
- `credito`, `limite_credito`
- `is_bonus`, `percentual_bunus` (Nome real do banco para bônus).
- `data_fundacao` (Data de nascimento/abertura da empresa).
- `data_cadastro` (Data que entrou no ERP).
- `risco_credito`, `restricao`, `ativo`
- `obs` (Restrito, não exibido por padrão).

---

## 2. Tabelas Relacionadas (Relações 1:N)

O Maestro consulta essas tabelas passando `enderecos.id_cliente = clientes.id_cliente`.

### A. Endereços (`public.enderecos`)
- Retorna até 20 endereços vinculados.
- **Divergência de Cidade:** O Maestro compara `enderecos.cidade` com `clientes.cidade_uf`. Se encontrar cidades diferentes, ele não escolhe uma como "oficial", mas exibe um alerta de divergência transparente para o usuário.

### B. Contatos (`public.contatos`)
- Retorna até 20 contatos secundários da empresa.
- **Campos:** `nome_contato`, `cargo`, `whats`, `e_mail`.

### C. Sócios / Vínculos (`public.clientes_socios`)
- Retorna vínculos comerciais (empresas autorizadas).
- **Ligação:** `id_cliente_principal = clientes.id_cliente`.
- O Maestro faz uma segunda query para enriquecer o nome das empresas parceiras buscando em `clientes` pelo `id_cliente_socio`.

---

## 3. O que fica fora da Fase 1 (Fase 2: Orçamentos/Pedidos)

As seguintes tabelas e campos **NÃO** são acessados pelo motor do Maestro na Fase 1:

- `public.propostas` (Orçamentos/Pedidos).
- `public.pedidos_modelos` (Modelos e lotes de impressão).
- `public.pagamentos_v2` (Financeiro/Cobranças).

### O Campo `bloco`
Foi identificado que o campo "BLOCO" pertence à tabela `pedidos_modelos` (coluna `bloco` do tipo `TEXT`). 
Ele **não** é um dado de cliente. Ele se refere a um lote de impressão (ex: pacote de 100 cópias em um bloco) de uma proposta específica.
**Ligação:** `pedidos_modelos.id_int = propostas.id_int`.
Portanto, o campo `bloco` só será integrado ao Maestro na Fase 2.

---

## 4. Metadados de Fonte

Para garantir a confiabilidade ("tem certeza?"), cada campo respondido pelo Maestro registra internamente a fonte de onde foi extraído (ex: `public.clientes`, `public.enderecos`, `public.contatos`), o nome do campo real no banco e o nível de confiança da resposta.
