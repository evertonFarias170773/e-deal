# Adicionar sócio pagador sem sair do orçamento (bloco 4)

**Data:** 19/09/2026 · **Estado:** plano, nada implementado · **Sessão:** C1

Hoje, incluir um pagador que ainda não é vínculo custa ~13 passos, duas janelas e
um refresh. O objetivo é resolver tudo dentro do bloco 4 "Dados para nota fiscal",
com **um único clique de confirmação** antes de criar qualquer coisa.

---

## 1. Mapeamento (o que existe hoje)

### 1.1 Bloco 4 e a lista de pagadores

| O quê | Onde |
|---|---|
| Bloco 4 | `OrcamentoFormPage.tsx:5584` (`FormSection "4. Dados para nota fiscal"`), aba Geral |
| Lista "Outras opções de pagador" | `SelectorPainel` em `:5590`, alimentado por `[cliente]` + `cliente.vinculosComerciais` |
| Origem dos vínculos | `getCadastroCompleto(idCliente)` → `cadastros.service.ts:503` lê `clientes_socios` e devolve em `cadastro.vinculosComerciais` |
| Botão atual | `:5691` — `window.open('/cadastros/<id>/editar')`, outra aba |
| Seleção do pagador | `handleSelectComprador` (`:2165`) |
| Endereços do pagador | efeito em `:1632`, carregados por `getCadastroCompleto` do sócio → `compradorAddresses` |

### 1.2 Vínculo comercial

- **Tabela:** `public.clientes_socios` — `id` (uuid), `id_cliente_principal` (int),
  `id_cliente_socio` (int), `tipo_relacao` (text, default `'socio'`), `data_criacao`.
- **Banco protege:** `UNIQUE (id_cliente_principal, id_cliente_socio)`
  (`clientes_socios_unico`) e FKs para `clientes(id_cliente)`. **Sem triggers.**
- **Caminho de escrita:** `createCadastroVinculosComerciais`
  (`cadastros.service.ts:2122`) — lê os existentes, filtra e faz
  `client.from("clientes_socios").insert(rows)` **direto do navegador**.
- **Quem chama:** `CadastroFormPage` (:1195 e :1429) e
  `VinculosNotaFiscalCard.tsx:278` (o "Adicionar vínculo" da tela de Clientes).

### 1.3 Criação de cliente (tela "Novo cliente")

| Etapa | Caminho |
|---|---|
| Consulta do CNPJ | `POST /api/cadastros/consultar-documento` — servidor, sessão exigida, `publica.cnpj.ws`. Devolve nome, fantasia, documento, tipoPessoa, dataFundacao, emailContato, telefoneFixo, cidadeUf, **insEstadual**, **tipoContribuinte** e `enderecoPreparado` (cep, endereco, numero, complemento, bairro, cidade, uf, `tipo_endereco: PRINCIPAL`, obs). Tem guarda **409** para documento já cadastrado |
| Atendente pré-preenchido | efeito em `CadastroFormPage.tsx:280` — só no modo `new`, só se `user.isSeller`, casando o usuário logado com `vendedorOptions` por UID e, como reserva, por nome. Grava `atendente` + `idVendedor` |
| INSERT do cliente | `createCadastro` (`cadastros.service.ts:1352`) → `client.from("clientes").insert(...)` **direto do navegador** |
| Endereço | `createCadastroEnderecos` → **`POST /api/cadastros/enderecos`** (servidor, com a regra do principal único). É a única escrita do trio que passa por servidor |
| Vínculo de volta (quando veio do "Novo Cadastro" do card de vínculos) | `/cadastros/novo?documento=...&origemVinculo=...&tipoRelacao=...` → `CadastroFormPage:1195` |

Campos obrigatórios em `clientes`: só `id`, `nome` e `percentual_bunus` — todos
com default. **A consulta de CNPJ traz tudo que a criação exige.**

### 1.4 Como o orçamento grava pagador e endereço

- **Pagador (`id_faturado`): imediato.** `handleSelectComprador` chama
  `updatePropostaFiscalDados` (`orcamentos.service.ts:4588`), que faz
  `update({ id_faturado }).eq("id_int", ...)` na hora, sem esperar o Salvar.
- **Endereço (`id_endereco_ent`): no Salvar.** Desde 21/08/2026 é escrito
  **somente** por `saveProposta` — comentário explícito em `:4578`. Pré-selecionar
  o endereço do sócio é estado de tela; persiste quando o usuário salvar.

### 1.5 Triggers

| Tabela | Trigger | Efeito no fluxo |
|---|---|---|
| `clientes` | `trg_default_categoria_cliente` (BEFORE INSERT), `trg_audit_clientes`, `tg_controlar_delete_clientes` | default de categoria + auditoria. Nada financeiro |
| `enderecos` | `trg_preencher_dados_recebedor_endereco` (BEFORE INSERT) | preenche `recebedor`, `cpf_recebedor` e `ie_recebedor` a partir do cadastro — o endereço do sócio já nasce com recebedor |
| `clientes_socios` | **nenhum** | — |
| `propostas` | `propostas_preencher_valor_total_avulsa`, `registrar_paid_at`, auditoria, `set_updated_at`, `trg_sync_cliente_idcliente_pagamentos` (só `OF id_cliente`) | **nenhum cita `id_faturado` ou `id_endereco_ent`** |

O trigger de avulsa dispara em qualquer UPDATE, mas só age quando
`is_avulso AND (valor_total is null or 0) AND valor > 0`. **Medido em 19/09/2026:
0 propostas nessa situação.** `registrar_paid_at` só reage a status virando
RECEBIDO. Gravar pagador não mexe em valor, status nem financeiro.

### 1.6 Travas de edição do orçamento

`isFormBloqueadoPorCobranca` (`:4634`) = cobrança ativa sem permissão de editar
paga, **ou** pendência de revisão aberta, **ou** `bloqueioAvulsaPaga` (avulsa paga
não se edita nem para admin). Ela desabilita três `fieldset` (`:5929`, `:6099`,
`:6663`) — **e o bloco 4 não está em nenhum deles**: ele fica no ramo
`activeFormTab === "geral"` que começa em `:5490`, fora do fieldset. Hoje, portanto,
o bloco 4 permanece clicável mesmo com a proposta travada. Além disso o bloco
respeita `ehComplemento` (pagador herdado do pedido principal).

### 1.7 Quem mais usa esses caminhos

- `clientes_socios`: só escrito por `createCadastroVinculosComerciais` (tela de
  Clientes). O Maestro **lê** (`maestro-simple-clientes.server.ts`, agent tools).
- Criação de cliente por servidor já existe em **`POST /api/cadastro-online/enviar`**
  (público, `service_role`), que valida documento e procura duplicado por
  `vw_cadastros_lista_completa.documento_numeros` (usa o índice de expressão).
  É o precedente a seguir — não o alteramos.
- Nenhum fluxo do n8n escreve nessas tabelas.

---

## 2. Condições de parada atingidas

### 2.1 Criação de cliente e de vínculo acontecem só no navegador — **atingida**

`createCadastro` e `createCadastroVinculosComerciais` escrevem via PostgREST
direto do browser. A validação de duplicidade é toda client-side; o que protege de
fato é o `UNIQUE` do vínculo e a RLS. Só o **endereço** tem rota de servidor.

Consequência para este plano: o fluxo novo faria **três escritas encadeadas**
(cliente → vínculo → pagador) sem ninguém no servidor garantindo que ou tudo
acontece ou nada acontece. Duas saídas:

- **(A) Nova rota `POST /api/orcamentos/socio-pagador`** — recomendada. Um único
  ponto no servidor que valida sessão e permissão, confere duplicidade pelos
  dígitos do documento, cria o cadastro, cria o vínculo, grava `id_faturado` e
  devolve o sócio pronto (com endereços). Molde: `/api/cadastro-online/enviar`.
- **(B) Encadear no cliente** os mesmos services de hoje. Menos código, mas
  mantém o problema e multiplica as janelas de falha parcial.

**Decisão sua.** O plano abaixo assume (A).

### 2.2 Não há trava de documento duplicado no banco — **atingida (parcial)**

`clientes` tem `UNIQUE (id_cliente)` e o índice de expressão
`idx_clientes_documento_digitos`, **mas nenhum unique em `documento`**. A trava é
de aplicação (`createCadastro` consulta antes de inserir). Duas abas simultâneas
criam dois cadastros com o mesmo CNPJ.

O plano não depende de mudança no banco, mas registra a recomendação em §6.

### 2.3 Consulta de CNPJ cobre o que a criação exige — não atingida
### 2.4 Trigger mexendo em valor/status/financeiro — não atingida

---

## 3. Arquivos que serão tocados

| Arquivo | Mudança |
|---|---|
| `src/features/orcamentos/components/SocioPagadorInline.tsx` **(novo)** | O painel: campo CPF/CNPJ + Buscar, os quatro desfechos (A/B/C/D), prévia e o botão único de confirmar |
| `src/app/api/orcamentos/socio-pagador/route.ts` **(novo)** | A rota da opção (A): busca, e confirmação que cria cadastro + vínculo + grava pagador |
| `src/features/orcamentos/OrcamentoFormPage.tsx` | Trocar o `window.open` do `:5691` pelo painel; ao confirmar, inserir o sócio em `cliente.vinculosComerciais` no estado, selecioná-lo e pré-selecionar o endereço principal dele em `compradorAddresses` |
| `src/features/orcamentos/services/orcamentos.service.ts` | Função cliente que chama a rota (sem escrita direta paralela) |
| `docs/business/ORCAMENTOS.md` (ou o doc do módulo) | Registrar o fluxo novo |

Não se toca em `VinculosNotaFiscalCard`, em `CadastroFormPage` nem na rota
`/api/cadastros/consultar-documento`.

## 4. Caminhos oficiais reaproveitados (sem escrita paralela)

| Escrita | Caminho oficial |
|---|---|
| Consulta do CNPJ | a rota `POST /api/cadastros/consultar-documento` já existente (ou a mesma função `consultarCnpj` de dentro dela, se a nova rota chamar server-side) |
| Criar o cadastro | a mesma montagem de payload de `createCadastro`, incluindo `normalizeClienteWritePayload`, a checagem de documento e o atendente do usuário logado (mesma regra do efeito `:280`) |
| Criar o endereço principal | `POST /api/cadastros/enderecos` — **não** inserir em `enderecos` direto |
| Criar o vínculo | a mesma regra de `createCadastroVinculosComerciais` (ler existentes, filtrar, inserir), apoiada no `UNIQUE` |
| Gravar o pagador | `updatePropostaFiscalDados` — o mesmo que o bloco 4 já usa |
| Endereço de entrega | **nada de novo**: só pré-seleção na tela; `id_endereco_ent` continua saindo apenas de `saveProposta` |

## 5. Clique duplo, travas e erro no meio

- **Clique duplo:** botão desabilitado enquanto a promessa está no ar + guarda por
  `useRef` na tela; na rota, chave de idempotência por `(id_int, documento em
  dígitos)` — a rota primeiro procura o documento, e se já existir cadastro ela
  entra no caminho B (vincular) em vez de criar outro. O `UNIQUE` de
  `clientes_socios` é a última linha de defesa.
- **Falha no meio:** ordem cadastro → endereço → vínculo → pagador, com relato do
  que foi feito. Se o vínculo falhar depois do cadastro criado, a rota devolve o
  `id_cliente` criado e a tela oferece "tentar vincular de novo" — nunca cria um
  segundo cadastro.
- **Travas do orçamento:** o painel novo fica desabilitado quando
  `isFormBloqueadoPorCobranca` **ou** `ehComplemento` — hoje o bloco 4 escapa do
  fieldset, e o painel não deve herdar essa brecha. A rota repete a checagem no
  servidor lendo a proposta antes de gravar `id_faturado`.
- **Permissão:** a rota exige sessão e a mesma permissão que hoje permite editar a
  proposta; sem ela, recusa.

## 6. Banco

**Nada é obrigatório.** Duas recomendações, para decidir à parte:

1. `create unique index concurrently ... on clientes (regexp_replace(coalesce(documento,''),'\D','','g')) where documento is not null and btrim(documento) <> ''` — fecharia no banco a trava que hoje só existe na aplicação. **Precisa medir os duplicados atuais antes** (há 2.545 inativos citados no código da rota de cadastro online).
2. Nada a fazer em `clientes_socios`: o `UNIQUE` já existe.

## 7. Ordem de implementação

1. Rota `/api/orcamentos/socio-pagador` com dois verbos lógicos (`buscar` e
   `confirmar`), sem UI — provada por teste de leitura com documento existente,
   inexistente e já vinculado.
2. Componente `SocioPagadorInline`, ainda desligado do botão atual.
3. Ligar no bloco 4, atualizar `vinculosComerciais` no estado e pré-selecionar o
   endereço; validar os quatro desfechos em localhost com escritas bloqueadas.
4. Teste ponta a ponta com **um** CNPJ real, em pedido de teste, e limpeza do que
   for criado.
5. `npx tsc --noEmit`, eslint nos arquivos tocados, doc do módulo, publicação.

## 8. Riscos

- **Cadastro criado sem querer** — mitigado pela confirmação única e pela busca
  prévia; o caminho C só aparece depois da prévia com razão social e cidade/UF.
- **CPF sem cadastro (D)**: segue manual, como hoje; a tela só informa.
- **Pagador gravado na hora**: já é o comportamento atual do bloco 4; nada muda.
