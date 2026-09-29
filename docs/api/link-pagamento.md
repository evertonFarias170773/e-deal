# Link de pagamento de um pedido

Esta API devolve **o link de pagamento de um pedido do Vibe**. Com ele, o seu sistema pode colocar um botão "Pagar" na mesma mensagem em que já envia ao cliente o link de aprovação da arte.

Ela **só entrega o link**: não cria cobrança, não altera o pedido e não devolve nenhum dado do pedido nem do cliente.

---

## Endereço

```
GET https://vibe.ai-ideal.com.br/api/v1/parceiro/link-pagamento/{id_int}
```

`{id_int}` é o número do pedido no Vibe — o mesmo que aparece na tela, por exemplo `22673`.

A chamada deve sair **do servidor do seu sistema**, nunca do navegador do cliente.

---

## Como autenticar

Toda chamada precisa do cabeçalho **`x-api-key`** com a chave que o Vibe entregou para você.

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
curl -s https://vibe.ai-ideal.com.br/api/v1/parceiro/link-pagamento/22673 \
  -H "x-api-key: <sua-chave>"
```

## Exemplo de resposta (200)

```json
{
  "id_int": 22673,
  "url": "https://vibe.ai-ideal.com.br/p/22673-Xy7kQ2mXpL9nR4sB8dF1gA"
}
```

| Campo | O que é |
|---|---|
| `id_int` | O número do pedido que você pediu. |
| `url` | O link para o cliente pagar. É só colocar no botão. |

O link é **sempre o mesmo** para o mesmo pedido: você pode pedir de novo quantas vezes precisar, ou guardar o link.

---

## O que o cliente vê ao abrir o link

Você **não precisa saber** se o pedido já foi pago antes de mandar o link. A própria página mostra ao cliente a situação do pedido na hora em que ele abre:

- **Disponível para pagar** — mostra o valor e as formas de pagamento.
- **Já pago** — avisa que o pedido está pago e não deixa pagar de novo.
- **Em revisão** — o valor está sendo conferido; a página pede para o cliente falar com o atendente e não deixa pagar.
- **Em andamento ou cancelado** — a página avisa e não deixa pagar.

Por isso, pode mandar o botão em todas as mensagens de aprovação de arte, mesmo que o pedido já esteja pago.

---

## Códigos de resposta

| Código | Quando acontece | O que fazer |
|---|---|---|
| **200** | Deu certo. O corpo traz `id_int` e `url`. | Use a `url` no botão. |
| **401** | Chave ausente ou errada. | Confira o cabeçalho `x-api-key`. |
| **404** | Pedido não encontrado. Vale também para pedido que não existe e para pedido que é tratado direto com o atendente. | Confira o número do pedido. Não mande botão de pagamento para esse pedido. |
| **429** | Muitas consultas seguidas do mesmo endereço (mais de 30 por minuto). | Espere 1 minuto e tente de novo. |
| **503** | O pagamento pelo link está desligado no momento. | Tente mais tarde; se continuar, avise o Vibe. |
| **500** | Falha do lado do Vibe. | Tente de novo em alguns minutos; se continuar, avise o Vibe. |

Todo erro volta neste formato:

```json
{ "erro": "nao_encontrado", "mensagem": "Pedido não encontrado." }
```
