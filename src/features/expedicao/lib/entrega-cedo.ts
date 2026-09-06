/**
 * O aviso de "entrega marcada cedo demais" — só para os Correios.
 *
 * POR QUE ELE EXISTE
 *   Sem a integração com a API dos Correios, `EM TRANSITO → ENTREGUE` depende de
 *   alguém saber que chegou. Levantado em 06/09/2026: dos 44 entregues do
 *   painel, 13 foram marcados em rajada — vários pedidos com menos de um minuto
 *   entre um clique e o outro —, e 11 tiveram a entrega registrada menos de uma
 *   hora depois do despacho. Não é defeito de código: a transição do despacho
 *   está correta e leva o pedido a `EM TRANSITO`. É o hábito de fechar a tela.
 *
 *   O aviso não corrige o hábito. Ele coloca o dado na frente de quem clica, no
 *   instante do clique.
 *
 * É AVISO, NÃO BLOQUEIO. Os Correios entregam no mesmo dia dentro da cidade, e
 * travar impediria registro legítimo. Quem confirma, registra.
 *
 * SÓ CORREIOS, e o resto tem motivo:
 *   - retirada de balcão não passa por aqui (`confirmarRetirada` é outro
 *     caminho), e ali entrega em segundos é legítima: o cliente está no balcão;
 *   - transportadora e motoboy chegam a `EM TRANSITO` pela coleta, e o dono
 *     marca em lote de propósito — avisar ali seria ruído diário, e ruído diário
 *     vira clique automático em três dias.
 *
 * O TEXTO É ESPECÍFICO DE PROPÓSITO. "Tem certeza?" não segura ninguém: em três
 * dias o dedo aprende o caminho do botão. O que segura é o número — "faz 2h20",
 * com a régua ao lado ("costuma levar mais de um dia").
 */

import type { PedidoExpedicao } from "../types";

/**
 * A janela. Doze horas porque abaixo disso a entrega é possível mas incomum —
 * é o mesmo dia, dentro da cidade —, e acima disso o aviso viraria ruído.
 */
export const HORAS_ENTREGA_SUSPEITA = 12;

/** "2h20", "45min", "11h" — o tempo como quem fala, não como quem calcula. */
function decorrido(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60000));
  if (minutos < 1) return "menos de um minuto";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}

/**
 * O texto do aviso, ou `null` quando não há o que avisar.
 *
 * `agora` entra por parâmetro em vez de sair de `Date.now()` aqui dentro: assim
 * a função é pura e testável, e quem chama passa o instante do CLIQUE — nunca do
 * render, onde ler o relógio é chamada impura no meio do React.
 *
 * NÃO AVISA SEM `data_despacho`. Sem ela não há de quando contar as 12 horas, e
 * inventar um ponto de partida seria pior que calar. Medido em 06/09/2026: zero
 * pedidos em `EM TRANSITO` sem a data, então isto é guarda estrutural, não
 * remendo para um caso existente.
 */
export function avisoEntregaCedoDemais(p: PedidoExpedicao, agora: number): string | null {
  if (p.tipoFrete !== "CORREIOS") return null;

  const despacho = p.expedicao?.dataDespacho;
  if (!despacho) return null;

  const instante = new Date(despacho).getTime();
  if (!Number.isFinite(instante)) return null;

  const decorridoMs = agora - instante;
  // Despacho no futuro (relógio da máquina atrasado) não é entrega cedo demais.
  if (decorridoMs < 0) return null;
  if (decorridoMs >= HORAS_ENTREGA_SUSPEITA * 3600_000) return null;

  return (
    `Este pedido foi postado nos Correios faz ${decorrido(decorridoMs)}. ` +
    `Entrega dos Correios costuma levar mais que isso — no mesmo dia, só dentro da cidade. ` +
    `Confirmando, a entrega fica registrada assim mesmo, com a data e a hora de agora.`
  );
}
