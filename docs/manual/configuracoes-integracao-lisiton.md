# Integração Lisiton

> **Última revisão:** 27/11/2026
> **Caminho no menu:** Configurações → Integração Lisiton
> **Endereço:** `/configuracoes/integracao-lisiton`

## Para que serve

O sistema da Lisiton (cliente 8469) cria pedidos direto no Vibe, pela API, e manda ao cliente final o link de pagamento PIX. Esta tela define em qual empresa esses pedidos nascem: Ideal Gráfica, Ideal Birô ou E3 Brindes. Hoje é a E3 Brindes.

## Quem acessa

- Administrador e Super Administrador.
- Quem tem a permissão **Configurar Integrações** no perfil.
- Os demais não veem o cartão em Configurações e, se abrirem o endereço, recebem acesso negado.

## Botões e ações da tela

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Empresa dos próximos pedidos** | Centro da tela | Lista as três empresas; marque uma. |
| **Salvar empresa** | Abaixo da lista | Grava a empresa escolhida. Só fica ativo quando a escolha é diferente da atual. |

## Passo a passo

### Trocar a empresa dos pedidos da Lisiton

1. Abra **Configurações** e clique em **Integração Lisiton**.
2. Confira a **Empresa atual** e quem a definiu.
3. Em **Empresa dos próximos pedidos**, marque a empresa nova.
4. Clique em **Salvar empresa**. Aparece "Empresa da integração trocada".

## Regras e bloqueios

- A troca vale para os pedidos criados **depois** dela. Os pedidos já criados continuam na empresa em que nasceram.
- O pedido criado pela API é sempre:
  - do cliente Lisiton, com o cliente final como pagador (vinculado à Lisiton);
  - da vendedora Lisiane Colbeich;
  - FOB com frete zero, preço do cadastro de cada produto e cobrança PIX;
  - com as conversas da Lisiton no ChatGuru, a da Lisiane como principal.
- Os produtos aceitos são só os de prateleira da Lisiton (9000, 9002, 9003, 9004, 201 e 202). Por isso, depois do PIX pago e conferido, o pedido vai sozinho para REVISAO PRODUCAO, sem passar pela revisão do atendente.
- Na proposta, o pedido criado pela API aparece com "Pedido criado pela Integração Lisiton" na observação e no chat.

## O que não confundir

- **Esta tela** escolhe a empresa dos pedidos novos da API. **A empresa de um pedido já criado** se troca na própria proposta, como em qualquer pedido.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Você não tem a permissão Configurar Integrações." | O perfil não tem a permissão. | Peça a um administrador. |
| "Não foi possível ler a configuração da integração." | Falha de leitura no banco. | Recarregue a página. |

## Veja também

- [Despacho na Expedição](expedicao-despacho.md) (o aviso de pedido pronto da Lisiton vai para as duas conversas)
- Contrato da API para o sistema da Lisiton: `docs/api/lisiton-criar-pedido.md`

## Arquivos de origem

- `src/app/(erp)/configuracoes/integracao-lisiton/page.tsx`
- `src/app/(erp)/configuracoes/page.tsx`
- `src/features/integracoes/lisiton/`
- `src/app/api/v1/lisiton/pedidos/route.ts`
- `supabase/migrations/20261127_lisiton_api_criar_pedido.sql`
