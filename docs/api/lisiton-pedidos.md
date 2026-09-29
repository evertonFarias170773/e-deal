# API de pedidos da Lisiton

Esta API devolve os dados de **um pedido da Lisiton** no Vibe, para gerar a etiqueta no Melhor Envio sem copiar e colar.

Ela **só lê**: não cria, não altera e não apaga nada no Vibe.

---

## Endereço

```
GET https://<endereço-do-vibe>/api/v1/lisiton/pedidos/{id_int}
```

`{id_int}` é o número do pedido no Vibe — o mesmo que aparece na tela, por exemplo `22773`.

---

## Como autenticar

Toda chamada precisa do cabeçalho **`x-api-key`** com a chave que o Vibe entregou para a Lisiton.

```
x-api-key: <sua-chave>
```

Cuidados com a chave:

- Guarde a chave no servidor do seu sistema, nunca em página de navegador ou aplicativo instalado no celular.
- Não mande a chave por e-mail nem por mensagem. Se ela vazar, peça uma nova: a antiga deixa de valer.
- O Vibe não registra a chave em log, nem inteira nem em pedaço.

---

## Exemplo de chamada

```bash
curl -s https://<endereço-do-vibe>/api/v1/lisiton/pedidos/22773 \
  -H "x-api-key: <sua-chave>"
```

---

## Exemplo de resposta (200)

Os dados abaixo são **fictícios**.

```json
{
  "id_int": 22773,
  "pagador": {
    "nome": "LISITON DOCUMENTOS SEGUROS LTDA",
    "documento": "00000000000100",
    "email": "financeiro@exemplo.com.br",
    "telefone": "51999990000",
    "endereco": {
      "cep": "96800000",
      "logradouro": "Rua Exemplo",
      "numero": "100",
      "complemento": "Sala 2",
      "bairro": "Centro",
      "cidade": "Santa Cruz do Sul",
      "uf": "RS"
    }
  },
  "entrega": {
    "destinatario": {
      "nome": "LOJA EXEMPLO LTDA",
      "documento": "11111111000111",
      "email": "compras@lojaexemplo.com.br",
      "telefone": "61988880000"
    },
    "recebedor": {
      "nome": "Maria Exemplo",
      "cpf": "12345678909"
    },
    "endereco": {
      "cep": "71200000",
      "logradouro": "Avenida Exemplo",
      "numero": "50",
      "complemento": "Loja 3",
      "bairro": "Zona Industrial",
      "cidade": "Brasília",
      "uf": "DF"
    }
  },
  "valor_total": 345,
  "envio": {
    "modalidade": "FOB",
    "servico": "MELHOR ENVIO",
    "transportadora": {
      "id": 70010,
      "nome": "MELHOR ENVIO LTDA"
    },
    "valor_frete": 0
  },
  "peso_aferido_kg": 4.95,
  "volumes": {
    "quantidade": 1,
    "tipo": "Caixa",
    "lista": [
      {
        "numero": 1,
        "peso_kg": null,
        "altura_cm": null,
        "largura_cm": null,
        "comprimento_cm": null
      }
    ]
  }
}
```

---

## O que cada campo significa

**Regra geral:** campo sem dado no Vibe vem **`null`**. Nenhum campo vem como texto vazio (`""`).

### Pedido

| Campo | O que é |
|---|---|
| `id_int` | Número do pedido no Vibe. |
| `valor_total` | Valor total do pedido em reais, **o mesmo número da tela do Vibe**: soma dos itens (itens cancelados ficam de fora), mais o frete, menos o desconto geral. |

### `pagador` — quem paga o pedido (a Lisiton)

| Campo | O que é |
|---|---|
| `nome` | Razão social do cadastro. |
| `documento` | CNPJ ou CPF, só números. |
| `email` | E-mail principal do cadastro. Se não houver, o e-mail financeiro; se não houver, o de contato. |
| `telefone` | WhatsApp 1 do cadastro. Se não houver, o WhatsApp 2; se não houver, o telefone fixo. Só números. |
| `endereco` | Endereço **principal** do cadastro — ver os campos de endereço abaixo. |

### `entrega` — para onde a mercadoria vai

| Campo | O que é |
|---|---|
| `destinatario.nome` | Nome do destinatário da etiqueta: quem foi escolhido no despacho ou, se ninguém foi escolhido, o dono do endereço de entrega. |
| `destinatario.documento` | CNPJ ou CPF do destinatário, só números. |
| `destinatario.email` | E-mail do destinatário, na mesma ordem do pagador. |
| `destinatario.telefone` | Telefone informado na etiqueta, se houver; senão o do cadastro do destinatário, na mesma ordem do pagador. |
| `recebedor.nome` | Pessoa que recebe no endereço, quando o cadastro informa. |
| `recebedor.cpf` | CPF (ou CNPJ) de quem recebe, só números. |
| `endereco` | Endereço de entrega: o definido no despacho ou, se não houver, o da proposta. É o **mesmo** endereço que o Vibe imprime na etiqueta. |

### Campos de endereço (em `pagador.endereco` e `entrega.endereco`)

| Campo | O que é |
|---|---|
| `cep` | CEP, só números (8 dígitos). |
| `logradouro` | Rua, avenida, travessa… |
| `numero` | Número. |
| `complemento` | Complemento (sala, loja, bloco…). |
| `bairro` | Bairro. |
| `cidade` | Município. |
| `uf` | Estado, em duas letras maiúsculas. |

### `envio` — como o pedido sai

| Campo | O que é |
|---|---|
| `modalidade` | `CIF` (a empresa contrata e paga o frete), `FOB` (o cliente contrata e paga) ou `RETIRA` (o cliente busca). Vale a do despacho, se houver; senão a da proposta. |
| `servico` | O frete escolhido na proposta, por exemplo `SEDEX`, `PAC` ou `MELHOR ENVIO`. |
| `transportadora.id` | Código da transportadora no cadastro do Vibe, quando ela é cadastrada. |
| `transportadora.nome` | Nome da transportadora. |
| `valor_frete` | Valor do frete em reais, como está no pedido. |

### Peso e volumes

| Campo | O que é |
|---|---|
| `peso_aferido_kg` | **Peso total pesado na balança**, em quilos. Ver abaixo de onde ele vem. `null` quando o pedido ainda não foi pesado. |
| `volumes.quantidade` | Quantos volumes (caixas, pacotes) o pedido tem. |
| `volumes.tipo` | Tipo do volume: `Caixa`, `Pacote`… |
| `volumes.lista` | Um item por volume. |
| `volumes.lista[].numero` | Número do volume: 1, 2, 3… |
| `volumes.lista[].peso_kg` | Peso daquele volume, quando a revisão do pedido registrou o peso de cada caixa. |
| `volumes.lista[].altura_cm`, `largura_cm`, `comprimento_cm` | Medidas do volume. **Hoje vêm sempre `null`**: o Vibe ainda não registra medida por volume. |

### De onde vem o peso aferido

O `peso_aferido_kg` é o peso que a **Expedição pesa na balança**, no momento de despachar o pedido. É o campo "Peso aferido" da tela de despacho do Vibe.

Por isso:

- enquanto o pedido não passa pelo despacho, o peso vem `null`;
- ele é o peso **real** do pacote pronto, não uma estimativa pelos produtos;
- quando o pedido tem um volume só, esse é o peso do volume.

---

## Códigos de resposta

| Código | Quando acontece | O que fazer |
|---|---|---|
| **200** | Deu certo. | Use os dados. |
| **401** | Chave ausente ou errada. | Confira o cabeçalho `x-api-key`. |
| **404** | Pedido não encontrado. | Confira o número. A mesma resposta vale para número que não existe e para pedido que não é da Lisiton — a API não diz qual dos dois é. |
| **429** | Muitas consultas em pouco tempo. | Espere 1 minuto e tente de novo. O limite é de **30 consultas por minuto** por endereço de origem. |
| **500** | Falha do lado do Vibe. | Tente de novo em alguns minutos. Se continuar, avise o Vibe. |

Todas as respostas de erro têm o mesmo formato:

```json
{ "erro": "nao_encontrado", "mensagem": "Pedido não encontrado." }
```

| `erro` | Código HTTP |
|---|---|
| `nao_autorizado` | 401 |
| `nao_encontrado` | 404 |
| `muitas_tentativas` | 429 |
| `erro_interno` | 500 |

---

## Para quem mantém o Vibe

- Rota: `src/app/api/v1/lisiton/pedidos/[id_int]/route.ts`.
- A chave fica na variável de ambiente **`LISITON_API_KEY`** do servidor (Vercel). Sem ela configurada, **toda** chamada recebe 401.
- A leitura é feita no servidor, com o service role (`SUPABASE_SERVICE_ROLE_KEY`). Não há grant novo no banco, nem migration, nem escrita.
- Só atende pedidos com `id_cliente = 8469` (Lisiton). O filtro está na própria consulta: pedido de outro cliente nem chega a ser lido.
- A chave é comparada em tempo constante (as duas passam por SHA-256 antes do `timingSafeEqual`).
- O limite por IP é por instância do servidor (`src/lib/security/rate-limit-memory.ts`).
- O valor total sai de `totaisDaProposta` (`src/features/orcamentos/lib/total-da-proposta.ts`), a regra única do sistema — a do "Salvar alterações", que a lista de propostas, a lista rápida e a área do cliente também usam.
- O peso aferido é `expedicoes.peso_kg` — o primeiro degrau da precedência de peso de `src/features/expedicao/lib/peso.ts`.
- O log registra só falhas do servidor, com o número do pedido. Nunca a chave, o IP ou dado pessoal.
