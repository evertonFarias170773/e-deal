# Criar um pedido no Vibe (Lisiton)

Esta API cria **um pedido da Lisiton no Vibe** a partir do seu sistema e devolve o **link de pagamento** (PIX) do pedido.

Num só chamado ela:

1. acha o cliente final pelo CPF ou CNPJ, ou cria o cadastro dele, vinculado à Lisiton. Ele serve **só para a entrega**: o endereço e o nome que saem na etiqueta;
2. usa o endereço de entrega informado (reaproveita o do cadastro quando é o mesmo CEP e número);
3. cria o pedido em nome da Lisiton, com um item por produto e uma linha por cor;
4. gera a cobrança PIX **para a Lisiton** e devolve o número do pedido e o link da página de pagamento.

Depois que o PIX é pago, o pedido segue sozinho para a produção. Você não precisa chamar mais nada.

## Quem paga e o que sai no papel

- **Quem paga é a Lisiton.** A cobrança PIX sai em nome dela (cadastro 8469). O preço é o do cadastro de cada produto no Vibe, que já é o preço para a Lisiton.
- **Não há documento fiscal** nesta operação: o Vibe não emite nota para estes pedidos, e o despacho sai sem nota.
- **O cliente final só recebe.** A etiqueta de envio sai com o **nome e o endereço dele**.
- Na retirada no balcão (`"codigo": "RETIRA"`), não há envio: a etiqueta do balcão identifica o pedido pela Lisiton.

---

## Endereço

```
POST https://vibe.ai-ideal.com.br/api/v1/lisiton/pedidos
Content-Type: application/json
```

A chamada deve sair **do servidor do seu sistema**, nunca do navegador do cliente.

---

## Como autenticar

Toda chamada precisa do cabeçalho **`x-api-key`** com a chave **de criação de pedidos** que o Vibe entregou para você. É uma chave diferente da chave de consulta de pedidos.

```
x-api-key: <sua-chave-de-criacao>
```

- Guarde a chave no servidor, nunca em página de navegador ou aplicativo.
- Não mande a chave por e-mail nem por mensagem. Se ela vazar, peça uma nova: a antiga deixa de valer.

---

## O que enviar (corpo JSON)

```json
{
  "chave_idempotencia": "LST-2026-000123",
  "cliente": {
    "documento": "418.273.946-92",
    "nome": "Fulano de Tal",
    "email": "fulano@exemplo.com.br",
    "telefone": "(51) 99999-0000"
  },
  "endereco": {
    "cep": "90010-150",
    "logradouro": "Rua dos Andradas",
    "numero": "1000",
    "complemento": "sala 2",
    "bairro": "Centro Histórico",
    "cidade": "Porto Alegre",
    "uf": "RS"
  },
  "transportadora": { "cnpj": "15.165.312/0001-22" },
  "itens": [
    {
      "produto": 9000,
      "cores": [
        { "cor": "Verde Flúor", "quantidade": 3 },
        { "cor": "Azul Médio", "quantidade": 2 }
      ]
    },
    { "produto": 201, "cores": [{ "cor": "Branca", "quantidade": 1 }] }
  ],
  "observacao": "Evento de 10/12"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `chave_idempotencia` | sim | Texto de 8 a 100 caracteres, **único por pedido** no seu sistema (por exemplo, o número do pedido de vocês). Veja "Repetir a chamada". |
| `cliente.documento` | sim | CPF (11 dígitos) ou CNPJ (14 dígitos), com ou sem pontuação. Precisa ser válido. |
| `cliente.nome` | sim | Nome ou razão social do cliente final. É o nome que sai na etiqueta (quando ele ainda não tem cadastro no Vibe). |
| `cliente.email` | não | Usado só quando o cadastro é criado agora. |
| `cliente.telefone` | não | Usado só quando o cadastro é criado agora. |
| `endereco.cep` | sim | 8 dígitos. |
| `endereco.logradouro`, `numero`, `bairro`, `cidade` | sim | Texto. |
| `endereco.complemento` | não | Texto. |
| `endereco.uf` | sim | 2 letras. |
| `transportadora.cnpj` | um dos dois | CNPJ da transportadora que vai retirar (o frete é FOB). Ela precisa estar cadastrada no Vibe. |
| `transportadora.codigo` | um dos dois | `"MELHOR_ENVIO"` (envio pelo Melhor Envio, no lugar do CNPJ) ou `"RETIRA"` (retirada no balcão). Nenhum outro código é aceito. |
| `itens` | sim | Pelo menos um. Cada produto aparece **uma vez**, com todas as cores dele dentro. |
| `itens[].produto` | sim | Um dos 6 códigos da tabela abaixo. |
| `itens[].cores[].cor` | sim | Uma cor da lista do produto (abaixo). Maiúscula, minúscula e acento não importam. |
| `itens[].cores[].quantidade` | sim | Inteiro maior que zero, na unidade de venda do produto (a mesma do orçamento do Vibe). |
| `observacao` | não | Texto livre, até 1.000 caracteres. Fica registrado no pedido. |

O cliente final já cadastrado no Vibe **não é alterado** pela API: valem os dados que já estão lá.

### Transportadora: um campo só

Envie **exatamente um** dos dois campos da transportadora. Os dois juntos, ou nenhum deles, é recusado com `422 dados_invalidos`.

| Como vai | O que enviar | O que o Vibe grava |
|---|---|---|
| Transportadora contratada pelo cliente (FOB) | `"transportadora": { "cnpj": "17.112.478/0001-06" }` | FOB, frete zero, a transportadora do CNPJ |
| Melhor Envio | `"transportadora": { "codigo": "MELHOR_ENVIO" }` | FOB, frete zero, o Melhor Envio |
| Retirada no balcão | `"transportadora": { "codigo": "RETIRA" }` | Retirada, frete zero, sem transportadora (o mesmo que a opção RETIRA da tela do Vibe) |

Na retirada, o endereço do cliente final continua obrigatório e fica registrado no pedido.

### Produtos e cores aceitos

| Código | Produto | Cores aceitas |
|---|---|---|
| 9000 | Dseg - Triband | as 20 cores Triband |
| 9002 | Dseg - Jet Band | **só Branca** |
| 9003 | Dseg - Bracelete | as 20 cores Triband |
| 9004 | Dseg - Pino | as 20 cores Triband |
| 201 | Pulseira Hospitalar Infantil | Branca |
| 202 | Pulseira Hospitalar Adulto | Branca |

As 20 cores Triband, com os nomes exatos do Vibe: Amarela Canario, Amarelo Fluor, Azul Claro, Azul Médio, Branca, Creme, Dourada, Laranja Fluor, Lilás, Pink Fluor, Prata, Púrple, Rosa Bebê, Azul Escuro, Verde Flúor, Vermelho Fluor, Verde Claro, Preta - Tarja, Verde Bandeira, Marron.

"Azul", "Azul Celeste", "Roxo" e "Verde Agua" **não existem** no Vibe e são recusados.

O Jet Band (9002), a 201 e a 202 só aceitam Branca: qualquer outra cor é recusada com `422 cor_nao_aceita` e a mensagem "O produto 9002 (Dseg - Jet Band) é só Branca...".

O preço, o frete (FOB ou retirada, sem valor) e a empresa do pedido são definidos pelo Vibe. Você não envia valores.

---

## O que volta

**201** — pedido criado agora. **200** — a mesma chave já tinha criado o pedido (veja "Repetir a chamada").

```json
{
  "id_int": 25950,
  "idempotente": false,
  "url_pagamento": "https://vibe.ai-ideal.com.br/p/25950-3f9a...",
  "pix": {
    "status": "gerado",
    "valor": 377,
    "vencimento": "2026-11-30",
    "copia_e_cola": "00020126..."
  }
}
```

| Campo | O que é |
|---|---|
| `id_int` | Número do pedido no Vibe. É o mesmo da consulta `GET /api/v1/lisiton/pedidos/{id_int}`. |
| `idempotente` | `true` quando a chave já tinha sido usada e nada novo foi criado. |
| `url_pagamento` | Página de pagamento do pedido. A cobrança é da Lisiton. |
| `pix.status` | `gerado` (o copia e cola está pronto), `em_preparacao` (o banco ainda está gerando; a página atualiza sozinha) ou `pendente` (o pedido foi criado, mas o PIX não saiu agora). |
| `pix.valor`, `pix.vencimento`, `pix.copia_e_cola` | Os dados do PIX, quando gerado. |
| `pix.mensagem` | Só no `pendente`: o motivo. O link continua valendo; repita a chamada com a mesma chave para tentar o PIX de novo. |

---

## Repetir a chamada (idempotência)

- **Mesma chave, mesmo conteúdo:** o Vibe não cria outro pedido nem outra cobrança. Devolve o mesmo `id_int` e o mesmo link, com `idempotente: true`. Use isso sempre que a resposta não chegar (queda de rede, tempo esgotado).
- **Mesma chave, conteúdo diferente:** recusado com **409** `chave_reusada`. Um pedido novo precisa de uma chave nova.

---

## Erros

| Código | `erro` | O que fazer |
|---|---|---|
| **400** | `json_invalido`, `chave_invalida` | Confira o corpo e a chave de idempotência. |
| **401** | `nao_autorizado` | Confira o cabeçalho `x-api-key`. |
| **409** | `chave_reusada` | A chave já foi usada com outro conteúdo: use uma chave nova. |
| **409** | `em_processamento` | O mesmo pedido está sendo criado agora. Repita em alguns segundos com a mesma chave. |
| **422** | `dados_invalidos`, `produto_nao_aceito`, `cor_nao_aceita`, `produto_inativo`, `transportadora_nao_cadastrada`, `lisiton_*` | A `mensagem` diz o que corrigir. Nada foi gravado. |
| **429** | `muitas_tentativas` | Espere 1 minuto (limite de 20 chamadas por minuto). |
| **500** | `erro_interno` | Nada foi gravado. Repita com a mesma chave. |
| **503** | `indisponivel` | Pagamento online fora do ar. Nada foi criado; tente mais tarde. |

Toda resposta de erro tem `erro` (código fixo) e `mensagem` (texto para gente).

---

## Cancelar um pedido

**Não existe cancelamento pela API.** Para cancelar, fale com a Ideal: o cancelamento é feito pela equipe dentro do Vibe.

---

## Depois do pagamento

O PIX pago é conferido pelo Vibe, e o pedido vai para a produção sem nenhuma ação sua. O andamento e os dados de envio continuam na consulta `GET /api/v1/lisiton/pedidos/{id_int}` ([lisiton-pedidos.md](lisiton-pedidos.md)). O link de pagamento também pode ser pedido de novo pela API de link ([link-pagamento.md](link-pagamento.md)), com a chave da Lisiton.
