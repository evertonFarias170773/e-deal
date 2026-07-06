# MAESTRO — Matriz de Perguntas: Cliente 100%

> **Fase 1 do Maestro Simple v1.**
> Este documento é a referência editável de todas as famílias de intenção que o Maestro reconhece sobre clientes.
> Edite este arquivo para ampliar a cobertura sem precisar mexer em código.

---

## Como funciona

O detector de intenção normaliza o texto antes de comparar:
- Converte para minúsculas
- Remove acentos
- Remove pontuação (preserva números)
- Colapsa espaços extras

Isso significa que `"Me conte sobre o Cliente 8.469?"` é tratado igual a `"me conte sobre o cliente 8469"`.

---

## Famílias de Intenção

### 1. `client_lookup` — Localizar cliente

Detecta código numérico em **qualquer posição** da frase.

| Frase de exemplo | Gatilho |
|---|---|
| `cliente 8469` | palavra "cliente" + número |
| `cli 8469` | atalho "cli" + número |
| `c8469` | "c" colado ao número |
| `cadastro 8469` | "cadastro" + número |
| `cad 8469` | "cad" + número |
| `#8469` | "#" + número |
| `8469` | somente número (3+ dígitos) |
| `me conte sobre o cliente 8469?` | "cliente" + número (no meio) |
| `quem é o cliente 8469?` | "cliente" + número (no meio) |
| `puxa o cadastro do cliente 8469` | "cliente" + número |
| `12.345.678/0001-99` | CNPJ |
| `000.000.000-00` | CPF |
| `cliente Empresa ABC` | nome após "cliente" |
| `busca Empresa XYZ` | verbo de busca + nome |

---

### 2. `client_summary` — Resumo geral

Responde com todos os campos disponíveis do cadastro ativo.

| Frase de exemplo |
|---|
| `me conte sobre esse cliente` |
| `faz um resumo dele` |
| `quem é esse cliente?` |
| `o que sabemos sobre esse cliente?` |
| `me dá um overview do cliente` |
| `tudo sobre esse cliente` |
| `mais detalhes` |
| `detalha` |

---

### 3. `client_field_question` — Campo específico

#### 3a. Telefone/WhatsApp
| Frase de exemplo |
|---|
| `qual o telefone dele?` |
| `tem WhatsApp?` |
| `qual o celular?` |
| `número de contato?` |

#### 3b. CNPJ/CPF/Documento
| Frase de exemplo |
|---|
| `qual o CNPJ?` |
| `qual o CPF?` |
| `qual o documento?` |
| `razão social` |
| `nome fantasia` |

#### 3c. E-mail
| Frase de exemplo |
|---|
| `qual o e-mail dele?` |
| `tem e-mail?` |
| `endereço de e-mail` |

#### 3d. Cidade/Localização
> **Nota:** Se houver divergência entre o cadastro principal e os endereços secundários, o Maestro alertará o usuário.

| Frase de exemplo |
|---|
| `de que cidade ele é?` |
| `qual cidade ele fica?` |
| `onde fica?` |
| `qual estado?` |
| `qual a UF?` |
| `endereço?` |
| `de onde ele é?` |
| `em que cidade está?` |

#### 3e. Vendedor/Responsável
| Frase de exemplo |
|---|
| `quem é o vendedor?` |
| `qual o representante?` |
| `quem é o responsável?` |
| `quem atende esse cliente?` |
| `quem cuida?` |
| `qual a carteira?` |

#### 3f. Crédito e Bônus
> **Nota:** Responde o crédito disponível, limite e verifica se há `is_bonus` ativo com `percentual_bunus`.

| Frase de exemplo |
|---|
| `tem crédito?` |
| `qual o limite de crédito?` |
| `ele pode comprar no crédito?` |
| `tem bônus?` |
| `tem desconto especial?` |
| `tem condição especial?` |
| `situação de crédito?` |

#### 3g. Data de Fundação
> ⚠️ **Data de fundação da empresa ≠ Data de cadastro no ERP.**
> O Maestro diferencia explicitamente e nunca confunde os dois.

| Frase de exemplo |
|---|
| `quando foi fundada?` |
| `data de fundação?` |
| `quando abriu?` |
| `data de abertura?` |
| `aniversário da empresa?` |

#### 3h. Data de Cadastro no ERP
> Diferente de data de fundação. Se o campo não estiver disponível, o Maestro informa isso claramente.

| Frase de exemplo |
|---|
| `desde quando é cliente?` |
| `data de cadastro?` |
| `quando virou cliente?` |
| `há quanto tempo é cliente?` |

---

### 4. `client_confirmation` — Tem certeza? / Qual a fonte?

O Maestro responde citando:
- O campo do banco de dados de onde o dado veio
- O valor que foi respondido
- A view/tabela de origem (pode ser `clientes`, `enderecos`, `contatos`, `clientes_socios`)
- Uma explicação legível

| Frase de exemplo |
|---|
| `tem certeza?` |
| `confere?` |
| `confirma?` |
| `qual a fonte?` |
| `de onde veio esse dado?` |
| `como você sabe disso?` |
| `esse dado está correto?` |
| `por que você disse isso?` |
| `esse dado está certo?` |

---

### 5. `client_contacts_question` — Contatos

Consulta a tabela `contatos` e lista os nomes, cargos e telefones vinculados.

| Frase de exemplo |
|---|
| `quem são os contatos?` |
| `com quem falo lá?` |
| `quem é o comprador?` |
| `quais pessoas estão cadastradas?` |
| `quem compra por essa empresa?` |

---

### 6. `client_partners_question` — Empresas Autorizadas / Sócios

Consulta a tabela `clientes_socios` e lista empresas com vínculo comercial autorizado.

| Frase de exemplo |
|---|
| `tem empresas autorizadas?` |
| `quem pode comprar no nome dele?` |
| `ele tem sócios?` |
| `quais os vínculos comerciais?` |
| `empresas vinculadas` |

---

### 7. `client_unknown_field` — Campo não encontrado no cadastro

Quando o usuário faz referência ao cliente ativo mas pede um campo que o Maestro não tem no cadastro.

**Resposta esperada:** "Não encontrei essa informação no cadastro carregado de [Nome]. Por enquanto tenho disponível: telefone, CNPJ, e-mail, cidade, vendedor, crédito ou data de fundação."

| Frase de exemplo |
|---|
| `ele tem bônus especial?` (quando não identificado como crédito) |
| `tem observações internas?` |
| `tem anotações?` |
| `qual a classificação dele?` |
| `tem contrato?` |

---

### 8. `client_history_question` — Histórico comercial (Fase 2)

> 🚧 **Não implementado na Fase 1.** O Maestro informa que a consulta depende da Fase 2 (propostas/orçamentos), mas pode mostrar dados básicos disponíveis na view (qtd_pedidos, data_ult_pedido).

| Frase de exemplo |
|---|
| `último pedido?` |
| `último orçamento?` |
| `quantos pedidos faz por mês?` |
| `em média quantos pedidos?` |
| `compra bastante?` |
| `frequência de compra?` |
| `histórico de compras?` |
| `quanto compra?` |

---

### 9. `client_switch` — Trocar cliente ativo

| Frase de exemplo |
|---|
| `agora cliente 123` |
| `troca para o cliente 456` |
| `não é esse, é o cliente 789` |
| `muda para o cliente 100` |
| `consulta outro cliente` |
| `esse não, troca` |

---

### 10. `help` — Ajuda

| Frase de exemplo |
|---|
| `ajuda` |
| `help` |
| `o que você faz?` |
| `como usar?` |
| `como funciona?` |
| `quais são suas funções?` |
| `oi` |
| `bom dia` |

---

### 11. Respostas Ambíguas

Perguntas vagas sobre o cliente são respondidas com base nos dados disponíveis, sem inventar.

| Frase de exemplo | Resposta esperada |
|---|---|
| `ele é bom cliente?` | Usa dados de crédito e pedidos disponíveis, sem julgamento. |
| `vale a pena vender para ele?` | "Não tenho dados suficientes para essa avaliação. Posso mostrar crédito disponível e histórico básico." |
| `tem problema?` | "Não há alertas no cadastro carregado. Para análise de inadimplência, Fase 2." |
| `compra muito?` | Mostra qtd_pedidos da view; para análise aprofundada, Fase 2. |

---

## Campos disponíveis (Fase 1)

Todos vêm da view `public.vw_cadastros_clientes_lista` — somente leitura.

| Campo no banco | Mapeado como | Exibido como |
|---|---|---|
| `id_cliente_text` | `clientDisplayCode` | Código do cliente |
| `nome` | `clientName` | Razão social |
| `fantasia` | `clientFantasia` | Nome fantasia |
| `documento` | `clientDocument` | CNPJ/CPF |
| `cidade_uf` | `clientCityUf` | Cidade/UF |
| `nome_vendedor` | `clientSeller` | Vendedor |
| `whatsapp_1` / `telefone_fixo` | `clientPhone` | Telefone/WhatsApp |
| `credito` | `clientCredit` | Crédito disponível |
| `limite_credito` | `clientCreditLimit` | Limite de crédito |
| `data_fundacao` | `clientDataFundacao` | Data de fundação |
| `qtd_pedidos` | `clientQtdPedidos` | Pedidos registrados (prévia) |
| `data_ult_pedido` | `clientDataUltPedido` | Último pedido (prévia) |

> **email:** não exposto na view atual. Responde "não cadastrado".

---

## Fase 2 — Propostas/Orçamentos (pendente)

Quando o usuário perguntar por histórico detalhado, o Maestro informa que precisa da Fase 2 e mostra os dados de prévia disponíveis na view (qtd_pedidos, data_ult_pedido).

Fase 2 incluirá:
- Consulta a `public.propostas` por `id_cliente`
- Valor total, status, data dos últimos orçamentos
- Frequência e ticket médio
- Família de intent `proposal_lookup`

---

## Como expandir

1. Abra `maestro-simple-intents.ts`
2. Adicione keywords ao `FIELD_KEYWORDS` da família correspondente
3. Ou crie uma nova entrada no `FIELD_KEYWORDS` com uma nova chave
4. Adicione o `case` correspondente no `presenterCampoContextual` em `maestro-simple-presenter.ts`
5. Documente aqui

> Não é necessário escrever regex. Tudo funciona por inclusão de string normalizada.
