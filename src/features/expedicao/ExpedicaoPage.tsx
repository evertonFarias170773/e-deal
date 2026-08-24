"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bike,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Factory,
  LayoutGrid,
  MapPin,
  Package,
  PackageCheck,
  Search,
  Send,
  Truck
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { EmptyState } from "@/components/common/EmptyState";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { listarPainelExpedicao } from "./services/expedicao.service";
import { encerrarTeste } from "@/features/pedidos/services/encerrar-teste.client";
import { marcarPronto, marcarEntregue } from "./services/expedicao-acoes.service";
import { marcarPrepostagemCancelada } from "./services/correios.client";
import { liberarRecotacao, revogarRecotacao } from "./services/recotacao.client";
import { abrirDeclaracaoConteudo, abrirEtiqueta, abrirEtiquetaRetirada } from "./services/etiqueta.client";
import { abrirEtiquetaCorreios } from "./services/correios.client";
import { ConfirmarAcaoModal } from "./components/ConfirmarAcaoModal";
import { labelTipoFrete, TIPOS_FRETE } from "./lib/tipo-frete";
import { rotuloClienteComNumero } from "./lib/cliente-rotulo";
import { DespacharModal } from "./components/DespacharModal";
import { RetiradaModal } from "./components/RetiradaModal";
import { VoltarStatusModal } from "./components/VoltarStatusModal";
import { TransportadorasModal } from "./components/TransportadorasModal";
import { RastreioModal } from "./components/RastreioModal";
import { KanbanTransportadoras } from "./components/KanbanTransportadoras";
import type { EtapaExpedicao, PedidoExpedicao, TipoFreteNormalizado } from "./types";

const filterClass =
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

type AlertaFiltro = "TODOS" | "ATRASADOS" | "HOJE" | "SEM_NF" | "FRETE_INDEFINIDO";

const ICONE_TIPO_FRETE: Record<TipoFreteNormalizado, typeof Truck> = {
  CORREIOS: Send,
  MOTOBOY: Bike,
  TRANSPORTADORA: Truck,
  RETIRA_BALCAO: MapPin,
  SEM_CUSTO: Package,
  INDEFINIDO: AlertCircle
};

function formatarPromessa(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatarPeso(p: PedidoExpedicao): string {
  if (p.pesoKg === null) return "—";
  const kg = p.pesoKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const sufixo = p.pesoOrigem === "aferido" ? "" : p.pesoOrigem === "cotado" ? " (cotado)" : " (previsto)";
  return `${kg} kg${sufixo}`;
}

export function ExpedicaoPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const router = useRouter();
  const [pedidos, setPedidos] = useState<PedidoExpedicao[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const canOperar = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.processar");
  const [pedidoDespacho, setPedidoDespacho] = useState<PedidoExpedicao | null>(null);
  const [pedidoRetirada, setPedidoRetirada] = useState<PedidoExpedicao | null>(null);
  const [pedidoVoltar, setPedidoVoltar] = useState<PedidoExpedicao | null>(null);
  const [pedidoRastreio, setPedidoRastreio] = useState<PedidoExpedicao | null>(null);
  const [transportadorasAberto, setTransportadorasAberto] = useState(false);
  const [salvandoAcao, setSalvandoAcao] = useState<number | null>(null);
  /** Pedido cuja prepostagem esta sendo marcada como cancelada (trava o item). */
  const [marcandoCanceladaId, setMarcandoCanceladaId] = useState<number | null>(null);
  // Confirmação de mudança de status no modal do sistema, não no confirm() do navegador.
  const [confirmacao, setConfirmacao] = useState<{ pedido: PedidoExpedicao; tipo: "PRONTO" | "ENTREGUE" } | null>(null);

  function atorAtual() {
    return {
      uid: user?.id ?? null,
      // MockUser não tem campo `nome` (brief previa `user?.nome`) — o campo real é `name`.
      nome: user?.name ?? user?.email ?? null
    };
  }

  async function handleMarcarPronto(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarPronto(p.idInt, p.statusInterno, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido pronto para expedir", description: `#${p.idInt} agora está na bancada da expedição.` });
    } else {
      showToast({ type: "error", title: "Não foi possível marcar pronto", description: res.error });
    }
    void recarregar();
  }

  async function handleMarcarEntregue(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarEntregue(p.idInt, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido entregue", description: `#${p.idInt} concluído.` });
    } else {
      showToast({ type: "error", title: "Não foi possível concluir", description: res.error });
    }
    void recarregar();
  }

  /** Botão primário contextual por etapa — compartilhado entre a coluna "Ações" e o card mobile. */
  function acaoPrimaria(p: PedidoExpedicao) {
    const ocupado = salvandoAcao === p.idInt;
    return !canOperar
      ? null
      : p.etapa === "PRODUCAO" || p.etapa === "ACABAMENTO"
        ? { rotulo: ocupado ? "Salvando..." : "Marcar pronto", acao: () => setConfirmacao({ pedido: p, tipo: "PRONTO" }) }
        : p.etapa === "PRONTO"
          ? { rotulo: "Despachar", acao: () => setPedidoDespacho(p) }
          : p.etapa === "A_RETIRAR"
            ? { rotulo: "Confirmar retirada", acao: () => setPedidoRetirada(p) }
            : p.etapa === "EM_TRANSITO"
              ? { rotulo: ocupado ? "Salvando..." : "Marcar entregue", acao: () => setConfirmacao({ pedido: p, tipo: "ENTREGUE" }) }
              : null;
  }

  /**
   * Marca no ERP que a prepostagem ja foi cancelada no portal dos Correios.
   *
   * Nao chama os Correios: o cancelamento e manual e acontece fora do sistema.
   * A rota grava a data, o uid e o nome a partir da SESSAO DO SERVIDOR e nao
   * toca em prepostagem, objeto ou rastreio — que continuam no banco.
   */
  async function handleMarcarPrepostagemCancelada(p: PedidoExpedicao) {
    if (marcandoCanceladaId !== null) return;
    setMarcandoCanceladaId(p.idInt);
    const res = await marcarPrepostagemCancelada(p.idInt);
    setMarcandoCanceladaId(null);
    if (!res.success) {
      showToast({ type: "error", title: "Nao foi possivel marcar", description: res.errorMessage });
      return;
    }
    showToast({
      type: res.jaMarcada ? "info" : "success",
      title: res.jaMarcada ? "Ja estava marcada" : "Prepostagem marcada como cancelada",
      description: `Pedido #${p.idInt}: o rastreio e a etiqueta oficial saem da tela e uma nova prepostagem pode ser gerada.`
    });
    void recarregar();
  }

  /**
   * Liberar / cancelar a recotacao de frete de um pedido (Parte C).
   * O expedidor nao recota por conta propria: o botao no modal Despachar nasce
   * bloqueado e depende desta autorizacao, que e de USO UNICO — a aplicacao a
   * consome e o botao volta a bloquear.
   */
  async function handleLiberarRecotacao(p: PedidoExpedicao) {
    const res = await liberarRecotacao(p.idInt);
    if (res.success) {
      showToast({
        type: "success",
        title: res.idempotente ? "Já estava liberado" : "Recotação liberada",
        description: res.idempotente
          ? `O pedido ${p.idInt} já tinha liberação ativa${res.liberadoPorNome ? ` (por ${res.liberadoPorNome})` : ""}.`
          : `O expedidor já pode recotar o frete do pedido ${p.idInt}. Vale para uma aplicação.`
      });
    } else {
      showToast({ type: "error", title: "Não foi possível liberar", description: res.errorMessage });
    }
    void recarregar();
  }

  async function handleCancelarLiberacao(p: PedidoExpedicao) {
    const res = await revogarRecotacao(p.idInt);
    if (res.success) {
      showToast({
        type: "success",
        title: "Liberação cancelada",
        description: `A recotação do pedido ${p.idInt} voltou a ficar bloqueada.`
      });
    } else {
      showToast({ type: "error", title: "Não foi possível cancelar", description: res.errorMessage });
    }
    void recarregar();
  }

  async function handleEncerrarTeste(p: PedidoExpedicao) {
    if (encerrandoTesteId !== null) return;
    const ok = window.confirm(
      `Encerrar o pedido #${p.idInt} como TESTE?\n\n` +
        `Ele sai deste painel, do painel de Produção, do Kanban e da fila de impressão.\n` +
        `Continua acessível por busca e por URL, e segue contando no faturamento.\n\n` +
        `Para reabrir, use o menu Ações em Orçamentos.`
    );
    if (!ok) return;
    setEncerrandoTesteId(p.idInt);
    try {
      const res = await encerrarTeste(p.idInt);
      if (res.success) {
        showToast({
          type: "success",
          title: res.idempotente ? "Pedido já estava encerrado" : "Teste encerrado",
          description: `#${p.idInt} saiu das listas operacionais. Reabra em Orçamentos, se precisar.`
        });
        void recarregar();
      } else {
        showToast({
          type: "error",
          title: "Erro ao encerrar",
          description: res.errorMessage || "Não foi possível encerrar o teste."
        });
      }
    } finally {
      setEncerrandoTesteId(null);
    }
  }

  /**
   * A ÚNICA entrada de etiqueta do menu, resolvida pelo transporte do pedido.
   *
   * Antes eram duas — "Imprimir etiqueta 10x15" e "Etiqueta Correios (oficial)"
   * — e o expedidor escolhia; um envio dos Correios saía com o papel errado sem
   * o sistema dizer nada. Quem decide o formato é `p.tipoFrete`, que já é o
   * transporte DECLARADO no despacho (`expedicoes.tipo_frete`) com a cotação
   * normalizada como reserva. Todos os outros transportes usam a 10x15.
   *
   * O rótulo oficial dos Correios só existe DEPOIS da prepostagem — a rota
   * responde 422 sem `correios_id_prepostagem`. Nesse intervalo a entrada fica
   * desabilitada dizendo o que fazer, em vez de sumir (o expedidor ficava sem
   * affordance e sem explicação) ou de cair na 10x15 (voltaria a imprimir o
   * papel errado, agora sem ninguém ter escolhido).
   */
  function etiquetaDoPedido(p: PedidoExpedicao) {
    // RETIRA NO BALCAO tem etiqueta propria: a 10x15 e documento de envio e
    // imprimia endereco, transportadora e rastreio para um volume que ninguem
    // vai despachar. A modalidade e a fonte — e ela que decide o fluxo de
    // retirada no despacho; `tipo_frete = RETIRA_BALCAO` e consequencia dela,
    // e por isso os dois valem como sinal.
    if (p.expedicao?.modalidadeFrete === "RETIRA" || p.tipoFrete === "RETIRA_BALCAO") {
      return {
        label: "Etiqueta de retirada",
        onClick: () => {
          void abrirEtiquetaRetirada(p.idInt, p.volumes).then((res) => {
            if (!res.success) {
              showToast({ type: "error", title: "Erro na etiqueta", description: res.errorMessage });
            }
          });
        }
      };
    }
    if (p.tipoFrete === "CORREIOS") {
      // Prepostagem cancelada no portal: o rotulo oficial daquele objeto nao
      // vale mais, e a rota dos Correios ainda o entregaria. Enquanto nao houver
      // prepostagem nova, cai na 10x15 — que independe do objeto.
      if (!p.expedicao?.correiosIdPrepostagem || p.expedicao?.prepostagemCanceladaEm) {
        return {
          label: "Etiqueta Correios — gere a prepostagem",
          disabled: true,
          onClick: () => {}
        };
      }
      return {
        label: "Etiqueta Correios (oficial)",
        onClick: () => {
          void abrirEtiquetaCorreios(p.idInt).then((res) => {
            if (!res.success) showToast({ type: "error", title: "Erro no rótulo", description: res.errorMessage });
          });
        }
      };
    }
    return {
      label: "Imprimir etiqueta 10x15",
      onClick: () => {
        void abrirEtiqueta(p.idInt, p.volumes).then((res) => {
          if (!res.success) {
            showToast({ type: "error", title: "Erro na etiqueta", description: res.errorMessage });
          }
        });
      }
    };
  }

  /** Itens do menu "⋯" contextual — compartilhado entre a coluna "Ações" e o card mobile. */
  function itensMenu(p: PedidoExpedicao) {
    return [
      ...(p.codigoRastreamento
        ? [{ label: "Rastrear objeto", onClick: () => setPedidoRastreio(p) }]
        : []),
      // Marcar que a prepostagem foi cancelada NO PORTAL dos Correios. So faz
      // sentido enquanto existe prepostagem e ela ainda nao foi marcada; a
      // permissao vale mesmo — a rota reconfere `expedicao.admin` no servidor.
      ...(canAdminExpedicao && p.expedicao?.correiosIdPrepostagem && !p.expedicao?.prepostagemCanceladaEm
        ? [
            {
              label:
                marcandoCanceladaId === p.idInt
                  ? "Marcando..."
                  : "Marcar prepostagem como cancelada",
              destructive: true,
              onClick: () => { void handleMarcarPrepostagemCancelada(p); }
            }
          ]
        : []),
      // Só aparece quando não é redundante com o botão primário: PRODUCAO/ACABAMENTO
      // ainda não têm dados de expedição para editar e PRONTO já tem "Despachar".
      ...(canOperar && ["A_RETIRAR", "EM_TRANSITO", "ENTREGUE"].includes(p.etapa)
        ? [{ label: "Editar dados de expedição", onClick: () => setPedidoDespacho(p) }]
        : []),
      // UMA entrada de etiqueta, nunca duas: o formato sai do transporte do
      // pedido, não da escolha do expedidor. Ver `etiquetaDoPedido`.
      ...(p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO" ? [etiquetaDoPedido(p)] : []),
      // Sem NF-e autorizada, a remessa viaja com declaração de conteúdo. O rótulo
      // dos Correios traz só a etiqueta — este é o papel que vai no volume.
      ...(p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO" && p.nfStatus !== "AUTORIZADA"
        ? [{
            label: "Declaração de conteúdo",
            onClick: () => {
              void abrirDeclaracaoConteudo(p.idInt).then((res) => {
                if (!res.success) {
                  showToast({ type: "error", title: "Erro na declaração", description: res.errorMessage });
                }
              });
            }
          }]
        : []),
      // Boletim no lugar dos detalhes da proposta: na bancada o que se consulta é
      // o que foi produzido, não a negociação. Sempre `modo=edicao` — pedido que
      // chegou à expedição já tem OS aberta.
      { label: "Boletim da produção", onClick: () => router.push(`/pedidos/boletim?id_int=${p.idInt}&modo=edicao`) },
      // Liberacao da recotacao de frete. Sem filtro por modalidade de proposito:
      // o admin costuma liberar ANTES de o expedidor declarar CIF na bancada, e
      // esconder o item nesse momento o deixaria sem affordance e sem
      // explicacao. Os gates de CIF continuam nas duas rotas.
      ...(canAdminExpedicao && p.statusInterno === "EXPEDICAO"
        ? p.liberacaoRecotacao
          ? [
              { label: "Recotação já liberada", disabled: true, onClick: () => {} },
              {
                label: "Cancelar liberação",
                destructive: true,
                onClick: () => void handleCancelarLiberacao(p)
              }
            ]
          : [{ label: "Liberar recotação de frete", onClick: () => void handleLiberarRecotacao(p) }]
        : []),
      // Sem retorno definido a partir de PRODUCAO/ACABAMENTO no service (voltarStatus) — affordance morta.
      ...(canOperar && p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO"
        ? [{ label: "Voltar status", destructive: true, onClick: () => setPedidoVoltar(p) }]
        : []),
      // Encerrar pedido de teste: sai deste painel na hora. Só "Encerrar" aqui —
      // "Reabrir" mora em Orcamentos, onde o pedido marcado continua visivel com
      // badge; nesta lista ele ja nao existe mais.
      ...(canEncerrarTeste
        ? [{
            label: encerrandoTesteId === p.idInt ? "Encerrando teste..." : "Encerrar teste",
            destructive: true,
            onClick: () => void handleEncerrarTeste(p)
          }]
        : [])
    ];
  }

  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.view");

  /**
   * Quem libera a recotacao de frete. A chave `expedicao.admin` ja existia no
   * catalogo de perfis e nao era usada em lugar nenhum — este e o uso dela.
   * Como `hasPermissao` cai em `isSuperAdmin || isAdmin` quando o usuario nao
   * tem permissoes resolvidas, a chave nao restringe quem ja e admin: ela
   * existe para poder delegar a liberacao sem dar admin geral do ERP.
   */
  const canAdminExpedicao = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.admin");

  /**
   * Encerrar pedido de teste. Chave `propostas.release_producao`, a MESMA de
   * "Retirar da Producao" — mesma natureza, tirar pedido das listas
   * operacionais. Nao e `expedicao.admin`: a marcacao vale para todos os
   * paineis, nao so para este. Esconder o item nao protege nada (a RLS de
   * propostas e aberta); quem tranca e POST /api/pedidos/encerrar-teste.
   */
  const canEncerrarTeste = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao");
  const [encerrandoTesteId, setEncerrandoTesteId] = useState<number | null>(null);

  // Filtros na URL — padrão docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      etapa: { codec: codecs.texto(), default: "ATIVOS" },
      alerta: { codec: codecs.texto(), default: "TODOS" },
      frete: { codec: codecs.texto(), default: "TODOS" },
      emp: { codec: codecs.texto(), default: "TODOS" },
      // Visão da lista: "lista" (tabela/cards) ou "transportadoras" (colunas kanban).
      visao: { codec: codecs.texto(), default: "lista" }
    }),
    []
  );
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);
  const [search, setSearch] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  async function recarregar() {
    const data = await listarPainelExpedicao();
    setPedidos(data);
    setIsLoaded(true);
  }

  useEffect(() => {
    void (async () => {
      await recarregar();
    })();
  }, []);

  // ---- contagens (sobre o conjunto todo, não o filtrado: cards são atalhos) ----
  const porEtapa = useMemo(() => {
    const contar = (etapas: EtapaExpedicao[]) => pedidos.filter((p) => etapas.includes(p.etapa)).length;
    return {
      producao: contar(["PRODUCAO"]),
      acabamento: contar(["ACABAMENTO"]),
      pronto: contar(["PRONTO"]),
      aRetirar: contar(["A_RETIRAR"]),
      emTransito: contar(["EM_TRANSITO"]),
      entregues: contar(["ENTREGUE"])
    };
  }, [pedidos]);

  const alertas = useMemo(() => {
    const abertos = pedidos.filter((p) => p.etapa !== "ENTREGUE");
    return {
      atrasados: abertos.filter((p) => p.atrasadoDias > 0).length,
      hoje: abertos.filter((p) => p.prometidoHoje).length,
      // Sem NF só alerta do PRONTO em diante — em produção ainda é normal não ter nota.
      semNf: pedidos.filter(
        (p) => ["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA"
      ).length,
      freteIndefinido: abertos.filter((p) => p.tipoFrete === "INDEFINIDO").length
    };
  }, [pedidos]);

  // ---- filtragem em memória ----
  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filters.etapa === "ATIVOS" && p.etapa === "ENTREGUE") return false;
      if (filters.etapa !== "ATIVOS" && filters.etapa !== "TODAS" && p.etapa !== filters.etapa) return false;

      if (filters.alerta === "ATRASADOS" && !(p.atrasadoDias > 0 && p.etapa !== "ENTREGUE")) return false;
      if (filters.alerta === "HOJE" && !p.prometidoHoje) return false;
      if (
        filters.alerta === "SEM_NF" &&
        !(["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA")
      )
        return false;
      if (filters.alerta === "FRETE_INDEFINIDO" && !(p.tipoFrete === "INDEFINIDO" && p.etapa !== "ENTREGUE"))
        return false;

      if (filters.frete !== "TODOS" && p.tipoFrete !== filters.frete) return false;
      if (
        filters.emp !== "TODOS" &&
        p.empresa.toLowerCase().replace(/\s/g, "") !== filters.emp.toLowerCase().replace(/\s/g, "")
      )
        return false;

      if (q === "") return true;
      return (
        String(p.idInt).includes(q) ||
        p.cliente.toLowerCase().includes(q) ||
        p.codigoRastreamento.toLowerCase().includes(q) ||
        p.transportadoraNome.toLowerCase().includes(q)
      );
    });
  }, [pedidos, filters, search]);

  // Entregues ordenados por entrega mais recente quando o card Entregues está ativo.
  const listaExibida = useMemo(() => {
    if (filters.etapa !== "ENTREGUE") return filtrados;
    return [...filtrados].sort((a, b) =>
      (b.expedicao?.dataEntrega ?? "").localeCompare(a.expedicao?.dataEntrega ?? "")
    );
  }, [filtrados, filters.etapa]);

  const empresaOptions = useMemo(
    () => Array.from(new Set(pedidos.map((p) => p.empresa))).filter(Boolean).sort(),
    [pedidos]
  );

  function toggleEtapa(etapa: string) {
    setFilter("etapa", filters.etapa === etapa ? "ATIVOS" : etapa);
  }
  function toggleAlerta(alerta: AlertaFiltro) {
    setFilter("alerta", filters.alerta === alerta ? "TODOS" : alerta);
  }

  async function copiarRastreio(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      showToast({ type: "success", title: "Rastreio copiado", description: codigo });
    } catch {
      showToast({ type: "error", title: "Não foi possível copiar", description: codigo });
    }
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Acesso Negado"
          description="Você não tem permissão para visualizar a Expedição."
          icon={AlertCircle}
        />
      </div>
    );
  }

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition";

  return (
    <div className="space-y-6 font-sans">
      {/* Navegação cruzada com a Fila Geral — mantida da tela anterior */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200/50 bg-white p-2.5 text-xs shadow-sm dark:border-slate-800/40 dark:bg-slate-900">
        <Link
          href="/pedidos"
          className="rounded-xl px-3.5 py-2 font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Voltar para Fila Geral (OS)
        </Link>
        <div className="rounded-xl bg-[#0b2f4a] px-3.5 py-2 font-bold text-white">Expedição e Logística</div>
      </div>

      <PageHeader
        title="Expedição"
        subtitle="Do acabamento à entrega: prontos, retiradas, trânsito e alertas de urgência."
        context="Logística"
        action={
          <button
            type="button"
            onClick={() => setTransportadorasAberto(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Building2 className="h-4 w-4" /> Transportadoras
          </button>
        }
      />

      {/* Cards do funil (clicáveis = filtro de etapa) */}
      {isLoaded && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <SummaryCard
            title="Em produção"
            value={porEtapa.producao.toString()}
            description="Antes do acabamento"
            tone="neutral"
            icon={Factory}
            onClick={() => toggleEtapa("PRODUCAO")}
          />
          <SummaryCard
            title="Em acabamento"
            value={porEtapa.acabamento.toString()}
            description="Chegando na bancada"
            tone="info"
            icon={Clock}
            onClick={() => toggleEtapa("ACABAMENTO")}
          />
          <SummaryCard
            title="Pronto p/ expedir"
            value={porEtapa.pronto.toString()}
            description="Aguardando despacho"
            tone="warning"
            icon={PackageCheck}
            onClick={() => toggleEtapa("PRONTO")}
          />
          <SummaryCard
            title="A retirar"
            value={porEtapa.aRetirar.toString()}
            description="Cliente busca no balcão"
            tone="special"
            icon={MapPin}
            onClick={() => toggleEtapa("A_RETIRAR")}
          />
          <SummaryCard
            title="Em trânsito"
            value={porEtapa.emTransito.toString()}
            description="Com a transportadora"
            tone="info"
            icon={Truck}
            onClick={() => toggleEtapa("EM_TRANSITO")}
          />
          <SummaryCard
            title="Entregues"
            value={porEtapa.entregues.toString()}
            description="Últimos 30 dias"
            tone="success"
            icon={CheckCircle2}
            onClick={() => toggleEtapa("ENTREGUE")}
          />
        </section>
      )}

      {/* Chips de alerta */}
      {isLoaded && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAlerta("ATRASADOS")}
            className={`${chipBase} ${
              filters.alerta === "ATRASADOS"
                ? "border-red-600 bg-red-600 text-white"
                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5" /> Atrasados ({alertas.atrasados})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("HOJE")}
            className={`${chipBase} ${
              filters.alerta === "HOJE"
                ? "border-amber-500 bg-amber-500 text-white"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            }`}
          >
            <Clock className="h-3.5 w-3.5" /> Prometidos hoje ({alertas.hoje})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("SEM_NF")}
            className={`${chipBase} ${
              filters.alerta === "SEM_NF"
                ? "border-rose-600 bg-rose-600 text-white"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
            }`}
          >
            Sem NF ({alertas.semNf})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("FRETE_INDEFINIDO")}
            className={`${chipBase} ${
              filters.alerta === "FRETE_INDEFINIDO"
                ? "border-slate-700 bg-slate-700 text-white"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            Frete a definir ({alertas.freteIndefinido})
          </button>
          {/* Troca de VISÃO (não é filtro): tabela ⇄ colunas por transportadora. */}
          <button
            type="button"
            onClick={() => setFilter("visao", filters.visao === "transportadoras" ? "lista" : "transportadoras")}
            className={`${chipBase} ${
              filters.visao === "transportadoras"
                ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                : "border-dashed border-slate-400 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Por transportadora
          </button>
          {(filters.etapa !== "ATIVOS" || filters.alerta !== "TODOS") && (
            <button
              type="button"
              onClick={() => setFilters({ etapa: "ATIVOS", alerta: "TODOS" })}
              className={`${chipBase} border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400`}
            >
              Ver funil ativo
            </button>
          )}
        </div>
      )}

      {/* Busca e filtros */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 xl:grid-cols-[1fr_220px_220px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
              placeholder="Buscar por nº, cliente, rastreio ou transportadora..."
            />
          </label>

          <select value={filters.frete} onChange={(e) => setFilter("frete", e.target.value)} className={filterClass}>
            <option value="TODOS">Todos os fretes</option>
            {TIPOS_FRETE.map((tipo) => (
              <option key={tipo} value={tipo}>
                {labelTipoFrete(tipo)}
              </option>
            ))}
          </select>

          <select value={filters.emp} onChange={(e) => setFilter("emp", e.target.value)} className={filterClass}>
            <option value="TODOS">Todas Empresas</option>
            {empresaOptions.map((option) => (
              <option key={option} value={option.toLowerCase().replace(/\s/g, "")}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setFilters({ q: "", etapa: "ATIVOS", alerta: "TODOS", frete: "TODOS", emp: "TODOS" });
              setSearch("");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      {filters.visao === "transportadoras" ? (
        <KanbanTransportadoras
          pedidos={listaExibida}
          acaoPrimaria={acaoPrimaria}
          itensMenu={itensMenu}
          formatarPeso={formatarPeso}
        />
      ) : (
      <ResponsiveList<PedidoExpedicao>
        items={listaExibida}
        getKey={(p) => p.idInt.toString()}
        isLoading={!isLoaded}
        emptyTitle="Nenhum pedido no recorte"
        emptyDescription="Ajuste os filtros ou confira se há pedidos aprovados para produção."
        getRowHighlight={(p) =>
          p.atrasadoDias > 0 && p.etapa !== "ENTREGUE"
            ? { base: "rgba(239,68,68,0.08)", hover: "rgba(239,68,68,0.15)" }
            : p.prometidoHoje
              ? { base: "rgba(245,158,11,0.10)", hover: "rgba(245,158,11,0.17)" }
              : null
        }
        columns={[
          {
            header: "Pedido",
            cell: (p) => (
              <div className="flex flex-col">
                <span className="font-semibold text-slate-950 dark:text-slate-100">#{p.idInt}</span>
                <span className="text-[11px] text-slate-500">{p.empresa}</span>
              </div>
            )
          },
          {
            header: "Cliente",
            cell: (p) => (
              <div className="flex max-w-[190px] flex-col">
                <span
                  className="truncate font-medium text-slate-900 dark:text-slate-100"
                  title={rotuloClienteComNumero(p.idCliente, p.cliente)}
                >
                  {rotuloClienteComNumero(p.idCliente, p.cliente)}
                </span>
                {p.cidadeUf && <span className="text-[11px] text-slate-500">{p.cidadeUf}</span>}
              </div>
            )
          },
          {
            header: "Vendedor",
            cell: (p) =>
              p.vendedor ? (
                <span
                  className="block max-w-[140px] truncate text-sm text-slate-700 dark:text-slate-300"
                  title={p.vendedor}
                >
                  {p.vendedor}
                </span>
              ) : (
                <span className="text-xs italic text-slate-400">—</span>
              )
          },
          {
            header: "Status",
            cell: (p) => <StatusBadge status={p.statusInterno} />
          },
          {
            header: "Promessa",
            cell: (p) => {
              const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
              return (
                <div className="flex flex-col gap-1">
                  <span
                    className={`text-sm font-semibold ${
                      ehAtrasado ? "text-red-600" : p.prometidoHoje ? "text-amber-600" : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {formatarPromessa(p.dataPromessa)}
                  </span>
                  {ehAtrasado && (
                    <span className="inline-flex w-fit items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
                      ATRASADO {p.atrasadoDias}d
                    </span>
                  )}
                  {p.prometidoHoje && (
                    <span className="inline-flex w-fit items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                      HOJE
                    </span>
                  )}
                </div>
              );
            }
          },
          {
            header: "Frete",
            cell: (p) => {
              const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
              return (
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Icone className="h-3.5 w-3.5 shrink-0" />
                    {p.tipoFrete === "INDEFINIDO" ? "A definir" : p.transportadoraNome || labelTipoFrete(p.tipoFrete)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatarPeso(p)}
                    {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                  </span>
                </div>
              );
            }
          },
          {
            header: "NF",
            cell: (p) =>
              p.nfStatus === "AUTORIZADA" ? (
                <div className="flex flex-col gap-0.5">
                  <StatusBadge status="AUTORIZADA" />
                  {p.nfNumero && <span className="text-[10px] text-slate-500">NF {p.nfNumero}</span>}
                </div>
              ) : p.nfStatus === "PENDENTE" ? (
                <StatusBadge status="PENDENTE" />
              ) : ["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                  SEM NF
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          {
            header: "Rastreio",
            cell: (p) =>
              p.codigoRastreamento ? (
                <button
                  type="button"
                  onClick={() => void copiarRastreio(p.codigoRastreamento)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  title="Copiar código"
                >
                  {p.codigoRastreamento}
                  <Copy className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-xs italic text-slate-400">—</span>
              )
          },
          {
            header: "Ações",
            align: "right",
            cell: (p) => {
              const ocupado = salvandoAcao === p.idInt;
              const primario = acaoPrimaria(p);
              const acoesMenu = itensMenu(p);

              return (
                <div className="flex items-center justify-end gap-1.5">
                  {primario && (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={primario.acao}
                      className="rounded-2xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50"
                    >
                      {primario.rotulo}
                    </button>
                  )}
                  <ActionsMenu items={acoesMenu} />
                </div>
              );
            }
          }
        ]}
        renderCard={(p) => {
          const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
          const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
          const ocupado = salvandoAcao === p.idInt;
          const primario = acaoPrimaria(p);
          const acoesMenu = itensMenu(p);
          return (
            <article
              key={p.idInt}
              className={`rounded-3xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
                ehAtrasado
                  ? "border-red-300 dark:border-red-900"
                  : p.prometidoHoje
                    ? "border-amber-300 dark:border-amber-900"
                    : "border-[#d7e5e8] dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    #{p.idInt} · {p.empresa}
                  </p>
                  <h3 className="mt-1 font-semibold text-slate-950 dark:text-slate-100">
                    {rotuloClienteComNumero(p.idCliente, p.cliente)}
                  </h3>
                  {p.cidadeUf && <p className="text-xs text-slate-500">{p.cidadeUf}</p>}
                  {p.vendedor && <p className="text-xs text-slate-500">Vendedor: {p.vendedor}</p>}
                </div>
                <StatusBadge status={p.statusInterno} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {ehAtrasado && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 font-black text-white">
                    ATRASADO {p.atrasadoDias}d
                  </span>
                )}
                {p.prometidoHoje && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 font-black text-white">HOJE</span>
                )}
                {["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA" && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold text-red-700">
                    SEM NF
                  </span>
                )}
                {p.nfStatus === "AUTORIZADA" && p.nfNumero && (
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-bold text-teal-700 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                    NF {p.nfNumero}
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <p className="inline-flex items-center gap-1.5">
                  <Icone className="h-3.5 w-3.5" />
                  {p.tipoFrete === "INDEFINIDO" ? "Frete a definir" : p.transportadoraNome || labelTipoFrete(p.tipoFrete)}
                </p>
                <p>
                  Promessa: <strong>{formatarPromessa(p.dataPromessa)}</strong>
                </p>
                <p>
                  {formatarPeso(p)}
                  {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                </p>
                {p.codigoRastreamento && (
                  <button
                    type="button"
                    onClick={() => void copiarRastreio(p.codigoRastreamento)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {p.codigoRastreamento}
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="mt-4 flex items-center justify-end gap-1.5">
                {primario && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={primario.acao}
                    className="rounded-2xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50"
                  >
                    {primario.rotulo}
                  </button>
                )}
                <ActionsMenu items={acoesMenu} />
              </div>
            </article>
          );
        }}
      />
      )}

      {pedidoDespacho && (
        <DespacharModal
          pedido={pedidoDespacho}
          modoEdicao={pedidoDespacho.etapa !== "PRONTO"}
          ator={atorAtual()}
          onClose={() => setPedidoDespacho(null)}
          onDone={() => { setPedidoDespacho(null); void recarregar(); }}
        />
      )}
      {pedidoRetirada && (
        <RetiradaModal
          pedido={pedidoRetirada}
          ator={atorAtual()}
          onClose={() => setPedidoRetirada(null)}
          onDone={() => { setPedidoRetirada(null); void recarregar(); }}
        />
      )}
      {pedidoVoltar && (
        <VoltarStatusModal
          pedido={pedidoVoltar}
          ator={atorAtual()}
          onClose={() => setPedidoVoltar(null)}
          onDone={() => { setPedidoVoltar(null); void recarregar(); }}
        />
      )}
      {pedidoRastreio && (
        <RastreioModal
          pedido={pedidoRastreio}
          permitirMarcarEntregue={canOperar}
          onClose={() => setPedidoRastreio(null)}
          onMarcarEntregue={() => { setPedidoRastreio(null); void handleMarcarEntregue(pedidoRastreio); }}
        />
      )}
      {confirmacao && (
        <ConfirmarAcaoModal
          titulo={confirmacao.tipo === "PRONTO" ? "Marcar como pronto" : "Confirmar entrega"}
          descricao={
            confirmacao.tipo === "PRONTO"
              ? `O pedido #${confirmacao.pedido.idInt} (${confirmacao.pedido.cliente}) vai para a bancada da expedição, aguardando despacho.`
              : `O pedido #${confirmacao.pedido.idInt} (${confirmacao.pedido.cliente}) será concluído como ENTREGUE.`
          }
          detalhe={
            confirmacao.tipo === "ENTREGUE"
              ? "Último passo do fluxo. Para desfazer depois é preciso usar Voltar status, com motivo."
              : undefined
          }
          rotuloConfirmar={confirmacao.tipo === "PRONTO" ? "Marcar pronto" : "Confirmar entrega"}
          salvando={salvandoAcao === confirmacao.pedido.idInt}
          onClose={() => setConfirmacao(null)}
          onConfirmar={() => {
            const { pedido, tipo } = confirmacao;
            setConfirmacao(null);
            if (tipo === "PRONTO") void handleMarcarPronto(pedido);
            else void handleMarcarEntregue(pedido);
          }}
        />
      )}
      {transportadorasAberto && <TransportadorasModal onClose={() => setTransportadorasAberto(false)} />}
    </div>
  );
}
