import React, { useEffect, useState, useMemo } from "react";
import { Shield, ShieldAlert, ChevronDown, ChevronUp, Save, Info, Lock } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { listPerfisDoCatalogo, updatePermissoesPerfil } from "../services/usuarios-perfis.service";
import type { PerfilDoCatalogo } from "../types";
import { ConfirmacaoDiffModal } from "./ConfirmacaoDiffModal";

interface PermissionDefinition {
  key: string;
  label: string;
  desc: string;
  critica: boolean;
}

// ---------------------------------------------------------------------------
// CATÁLOGO DE PERMISSÕES V2.1 — ERP Ideal
// Fase 1: expansão puramente visual do Editor de Perfis.
// Nenhuma permissão nova está conectada a telas operacionais nesta fase.
// A implementação operacional das novas permissões ocorre nas Fases 2 a 5.
// ---------------------------------------------------------------------------
const CATALOGO_PERMISSOES: Record<string, PermissionDefinition[]> = {

  // ── Administração ─────────────────────────────────────────────────────────
  "Administração — Usuários e Perfis": [
    { key: "admin.usuarios.view",  label: "Visualizar Usuários",          desc: "Permite ver a listagem de usuários e seus perfis vinculados.",                          critica: false },
    { key: "admin.usuarios.edit",  label: "Gerenciar Usuários e Perfis",  desc: "Permite vincular perfis a usuários e editar permissões dos perfis.",                   critica: true  },
    { key: "admin.perfis.view",    label: "Visualizar Perfis",            desc: "Permite ver o catálogo de perfis e suas permissões (somente leitura).",                critica: false },
    { key: "admin.perfis.edit",    label: "Editar Permissões de Perfis",  desc: "Permite criar, editar e salvar permissões nos perfis do catálogo.",                    critica: true  }
  ],

  // ── Dashboard ─────────────────────────────────────────────────────────────
  "Dashboard": [
    { key: "dashboard.view",           label: "Visualizar Dashboard",              desc: "Permite acessar o painel de indicadores gerais do sistema.",                            critica: false },
    { key: "dashboard.view_financeiro", label: "Ver Indicadores Financeiros",      desc: "Permite visualizar cards e gráficos de faturamento e recebimentos no dashboard.",      critica: false },
    { key: "dashboard.view_producao",   label: "Ver Indicadores de Produção",      desc: "Permite visualizar cards e gráficos de pedidos e produção no dashboard.",             critica: false }
  ],

  // ── Cadastros ─────────────────────────────────────────────────────────────
  "Cadastros (Clientes)": [
    { key: "cadastros.view",       label: "Visualizar Cadastros",         desc: "Permite visualizar listagem de clientes, fornecedores e vendedores.",                   critica: false },
    { key: "cadastros.create",     label: "Criar Cadastros",              desc: "Permite criar novos registros de clientes.",                                            critica: false },
    { key: "cadastros.edit",       label: "Editar Cadastros",             desc: "Permite editar informações de clientes, endereços e contatos.",                         critica: false },
    { key: "cadastros.edit_fiscal", label: "Editar Dados Fiscais",        desc: "Permite editar dados fiscais do cliente (CNPJ, IE, regime tributário).",                critica: true  },
    { key: "cadastros.view_socios", label: "Ver Sócios e Vínculos",       desc: "Permite visualizar sócios e vínculos comerciais cadastrados.",                          critica: false }
  ],

  // ── Produtos ──────────────────────────────────────────────────────────────
  "Produtos": [
    { key: "produtos.view",         label: "Visualizar Produtos",         desc: "Permite listar e visualizar o catálogo de produtos.",                                   critica: false },
    { key: "produtos.create",       label: "Criar Produtos",              desc: "Permite cadastrar novos produtos no catálogo.",                                         critica: false },
    { key: "produtos.edit",         label: "Editar Produtos",             desc: "Permite editar dados básicos de produtos existentes.",                                   critica: false },
    { key: "produtos.edit_preco",   label: "Editar Preço e Custo",        desc: "Permite alterar preço de venda e custo dos produtos (ação crítica de negócio).",        critica: true  },
    { key: "produtos.edit_fiscal",  label: "Editar Dados Fiscais",        desc: "Permite alterar NCM, CEST, CFOP e tributação dos produtos.",                            critica: true  },
    { key: "produtos.edit_producao", label: "Editar Dados de Produção",  desc: "Permite alterar formato, cor base, blocagem e dados de fabricação do produto.",         critica: false },
    { key: "produtos.inativar",     label: "Inativar Produtos",           desc: "Permite marcar produtos como inativos (exclusão lógica).",                              critica: true  },
    { key: "produtos.upload_foto",  label: "Upload de Fotos",             desc: "Permite fazer upload de imagens de produtos para o Storage.",                           critica: false }
  ],

  // ── Banco de Variações ────────────────────────────────────────────────────
  "Banco de Variações": [
    { key: "variacoes.view",     label: "Visualizar Variações",           desc: "Permite listar e visualizar o banco global de variações.",                              critica: false },
    { key: "variacoes.create",   label: "Criar Variações",                desc: "Permite criar novos grupos e opções de variação global.",                               critica: false },
    { key: "variacoes.edit",     label: "Editar Variações",               desc: "Permite editar grupos e opções de variação existentes.",                                critica: false },
    { key: "variacoes.inativar", label: "Inativar Variações",             desc: "Permite inativar grupos de variação global (exclusão lógica).",                         critica: true  }
  ],

  // ── Orçamentos / Propostas ────────────────────────────────────────────────
  "Orçamentos e Propostas": [
    { key: "propostas.view",             label: "Visualizar Propostas",            desc: "Permite visualizar a listagem e o detalhamento de propostas e orçamentos.",           critica: false },
    { key: "propostas.view_own",         label: "Ver Apenas Próprias Propostas",   desc: "Escopo de dados: limita a visualização às propostas do próprio atendente/vendedor.", critica: false },
    { key: "propostas.view_all",         label: "Ver Todas as Propostas",          desc: "Escopo de dados: permite visualizar propostas de todos os atendentes.",              critica: false },
    { key: "propostas.create",           label: "Criar Propostas",                 desc: "Permite iniciar novos orçamentos ou rascunhos de propostas.",                        critica: false },
    { key: "propostas.edit",             label: "Editar Propostas",                desc: "Permite editar itens, quantidades e descontos individuais nos itens.",               critica: false },
    { key: "propostas.desconto_geral",   label: "Aplicar Desconto Geral",          desc: "Permite aplicar descontos globais (em valor ou percentual) no fechamento.",          critica: true  },
    { key: "propostas.edit_vendedor",    label: "Alterar Vendedor Responsável",    desc: "Permite alterar o vendedor/atendente responsável pela proposta.",                    critica: true  },
    { key: "propostas.cancel",           label: "Cancelar Propostas",              desc: "Permite cancelar propostas comerciais ativas no sistema.",                           critica: true  },
    { key: "propostas.release_producao", label: "Liberar para Produção",           desc: "Permite aprovar a proposta para produção (campo is_prd_aprovado).",                  critica: true  },
    { key: "propostas.release_nf",       label: "Liberar para Nota Fiscal",        desc: "Permite marcar a proposta para faturamento (campo libera_nf).",                      critica: true  },
    { key: "propostas.devolver_revisao", label: "Devolver para Revisão",           desc: "Permite devolver a proposta para a etapa de revisão de atendente.",                  critica: true  },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "propostas.alterar_vendedor", label: "Alterar Vendedor (Legado V1)",    desc: "[LEGADO] Sera substituida por propostas.edit_vendedor na Fase 4.",     critica: true  },
    { key: "propostas.cancelar",         label: "Cancelar Propostas (Legado V1)",  desc: "[LEGADO] Sera substituida por propostas.cancel na Fase 4.",            critica: true  }
  ],

  // ── Chat Interno ──────────────────────────────────────────────────────────
  "Chat Interno": [
    { key: "chat.view",      label: "Visualizar Chat",              desc: "Permite acessar e ler conversas do chat interno das propostas.",                       critica: false },
    { key: "chat.send",      label: "Enviar Mensagens",             desc: "Permite enviar mensagens no chat interno.",                                            critica: false },
    { key: "chat.mention",   label: "Mencionar Usuários",           desc: "Permite mencionar outros usuários em mensagens do chat.",                              critica: false },
    { key: "chat.view_all",  label: "Ver Chat de Todas as Propostas", desc: "Permite visualizar conversas de propostas de outros atendentes (escopo amplo).",  critica: false }
  ],

  // ── Cobranças ─────────────────────────────────────────────────────────────
  "Cobranças e Pagamentos": [
    { key: "cobrancas.view",       label: "Visualizar Cobranças",         desc: "Permite visualizar a lista e status das cobranças de propostas.",                   critica: false },
    { key: "cobrancas.create",     label: "Criar Cobranças",              desc: "Permite gerar novas cobranças (boleto, PIX, cartão) para propostas.",              critica: true  },
    { key: "cobrancas.emit",       label: "Emitir Cobranças",             desc: "Permite acionar o gateway de pagamento para emitir a cobrança.",                   critica: true  },
    { key: "cobrancas.confirm",    label: "Confirmar Recebimento",        desc: "Permite confirmar manualmente o recebimento de uma cobrança.",                     critica: true  },
    { key: "cobrancas.cancel",     label: "Cancelar / Estornar Cobranças", desc: "Permite cancelar ou estornar cobranças emitidas.",                               critica: true  },
    { key: "cobrancas.view_token", label: "Ver Link e Token da Cobrança", desc: "Permite visualizar o link público e o token de acesso da cobrança.",              critica: false },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "cobrancas.aprovar",        label: "Liberar OS / Confirmar (Legado V1)", desc: "[LEGADO] Sera substituido por cobrancas.confirm na Fase 4.",         critica: true  },
    { key: "cobrancas.emitir_boleto",  label: "Emitir Boleto (Legado V1)",          desc: "[LEGADO] Sera substituido por cobrancas.emit na Fase 4.",             critica: false }
  ],

  // ── Conferência ───────────────────────────────────────────────────────────
  "Conferência de Pagamentos": [
    { key: "conferencia.view",    label: "Visualizar Conferência",       desc: "Permite ver a lista de pagamentos confirmados para conferência.",                    critica: false },
    { key: "conferencia.confirm", label: "Confirmar Pagamento",          desc: "Permite confirmar registros na tela de conferência.",                               critica: true  },
    { key: "conferencia.export",  label: "Exportar Relatório",           desc: "Permite exportar o relatório de conferência de pagamentos.",                        critica: false }
  ],

  // ── Contas a Receber ──────────────────────────────────────────────────────
  "Contas a Receber": [
    { key: "contas_receber.view",       label: "Visualizar Títulos",          desc: "Permite listar e visualizar os títulos a receber.",                                critica: false },
    { key: "contas_receber.baixa",      label: "Registrar Baixa",             desc: "Permite registrar a baixa de um título a receber.",                               critica: true  },
    { key: "contas_receber.send_email", label: "Disparar E-mail de Cobrança", desc: "Permite enviar e-mail de cobrança para clientes em atraso.",                     critica: false },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "financeiro.view",    label: "Relatorios Financeiros (Legado V1)", desc: "[LEGADO] Sera substituido por dashboard.view_financeiro + contas_receber.view.", critica: false },
    { key: "financeiro.aprovar", label: "Aprovacao Financeira (Legado V1)",   desc: "[LEGADO] Sera substituido por contas_receber.baixa na Fase 4.",                  critica: true  }
  ],

  // ── Fiscal ────────────────────────────────────────────────────────────────
  "Fiscal (NF-e / NFS-e)": [
    { key: "fiscal.view",       label: "Visualizar Painel Fiscal",     desc: "Permite ver a fila de faturamento e o histórico de notas fiscais.",                   critica: false },
    { key: "fiscal.simulate",   label: "Simular Emissão de NF",        desc: "Permite pré-visualizar e simular a emissão de notas fiscais antes de confirmar.",     critica: false },
    { key: "fiscal.emit_nfe",   label: "Emitir NF-e (Produto)",        desc: "Permite emitir oficialmente Notas Fiscais de Produto (NF-e).",                        critica: true  },
    { key: "fiscal.emit_nfse",  label: "Emitir NFS-e (Serviço)",       desc: "Permite emitir oficialmente Notas Fiscais de Serviço (NFS-e).",                       critica: true  },
    { key: "fiscal.cancel_nf",  label: "Cancelar Nota Fiscal",         desc: "Permite solicitar cancelamento de NF junto à Sefaz ou Prefeitura.",                   critica: true  },
    { key: "fiscal.admin",      label: "Configurar Parâmetros Fiscais", desc: "Permite configurar série, ambiente (produção/homologação) e CFOP padrão.",            critica: true  },
    // Permissão V1 mantida para compatibilidade retroativa durante migração
    { key: "fiscal.emitir", label: "Emitir NF (Legado V1)", desc: "[LEGADO] Sera substituido por fiscal.emit_nfe e fiscal.emit_nfse na Fase 4.",               critica: true  }
  ],

  // ── Pedidos / OS ──────────────────────────────────────────────────────────
  "Pedidos e Ordens de Serviço": [
    { key: "pedidos.view",          label: "Visualizar Pedidos e OS",     desc: "Permite listar pedidos e visualizar boletins de OS.",                                critica: false },
    { key: "pedidos.edit_data",     label: "Editar Datas de Entrega",     desc: "Permite alterar a data de entrega e data da OS.",                                    critica: false },
    { key: "pedidos.edit_obs",      label: "Editar Observações da OS",    desc: "Permite editar campos de observação internos da Ordem de Serviço.",                  critica: false },
    { key: "pedidos.approve_arte",  label: "Aprovar Arte junto ao Cliente", desc: "Permite registrar a aprovação de arte pelo cliente.",                            critica: true  },
    { key: "pedidos.release_nf",    label: "Liberar para Nota Fiscal",    desc: "Permite marcar o pedido como liberado para faturamento.",                           critica: true  },
    { key: "pedidos.admin",         label: "Ações Administrativas de OS", desc: "Permite reatribuir, encerrar ou reverter etapas de OS (ação crítica).",             critica: true  }
  ],

  // ── Produção (Kanban) ─────────────────────────────────────────────────────
  "Produção (Kanban)": [
    { key: "producao.view",  label: "Visualizar Kanban",          desc: "Permite visualizar o quadro Kanban de produção com todos os pedidos.",                 critica: false },
    { key: "producao.mover", label: "Mover Pedidos no Kanban",    desc: "Permite arrastar pedidos entre as etapas de produção no Kanban.",                     critica: false },
    { key: "producao.admin", label: "Configurar Etapas",          desc: "Permite configurar as etapas do Kanban e suas regras de transição.",                  critica: true  }
  ],

  // ── Impressão ─────────────────────────────────────────────────────────────
  "Impressão": [
    { key: "impressao.view",     label: "Visualizar Fila de Impressão", desc: "Permite ver a fila de impressão e os itens pendentes.",                           critica: false },
    { key: "impressao.iniciar",  label: "Iniciar Impressão",            desc: "Permite marcar um item como em processo de impressão.",                            critica: false },
    { key: "impressao.concluir", label: "Concluir Impressão",           desc: "Permite marcar a impressão de um item como concluída.",                           critica: false }
  ],

  // ── Expedição ─────────────────────────────────────────────────────────────
  "Expedição": [
    { key: "expedicao.view",      label: "Visualizar Expedição",       desc: "Permite ver a fila de expedição e os pedidos prontos para envio.",                  critica: false },
    { key: "expedicao.processar", label: "Processar Envio / Retirada", desc: "Permite registrar envios e confirmar retiradas na expedição.",                      critica: false },
    { key: "expedicao.admin",     label: "Configurar Expedição",       desc: "Permite configurar métodos de envio e integrações logísticas.",                     critica: true  }
  ],

  // ── Relatórios ────────────────────────────────────────────────────────────
  "Relatórios": [
    { key: "relatorios.view",       label: "Visualizar Relatórios",         desc: "Permite acessar e visualizar relatórios gerais do sistema.",                       critica: false },
    { key: "relatorios.financeiro", label: "Relatórios Financeiros",        desc: "Permite visualizar relatórios de faturamento, recebimentos e contas.",             critica: false },
    { key: "relatorios.producao",   label: "Relatórios de Produção",        desc: "Permite visualizar relatórios de pedidos, produção e expedição.",                  critica: false },
    { key: "relatorios.export",     label: "Exportar Dados (CSV / PDF)",    desc: "Permite exportar dados de relatórios em formato CSV ou PDF.",                      critica: false }
  ],

  // ── Configurações Gerais ──────────────────────────────────────────────────
  "Configurações do Sistema": [
    { key: "config.view",        label: "Acessar Configurações",      desc: "Permite acessar o hub de Configurações do sistema.",                                   critica: false },
    { key: "config.empresas",    label: "Gerenciar Empresas",         desc: "Permite cadastrar e editar empresas e filiais do grupo.",                              critica: true  },
    { key: "config.integracoes", label: "Configurar Integrações",     desc: "Permite configurar integrações externas (N8N, gateways de pagamento, etc.).",          critica: true  },
    { key: "config.faturamento", label: "Configurar Faturamento",     desc: "Permite configurar parâmetros de cobrança, vencimentos e meios de pagamento.",         critica: true  }
  ]
};

export function PerfisPermissoesPanel() {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [perfis, setPerfis] = useState<PerfilDoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [perfilSelecionado, setPerfilSelecionado] = useState<PerfilDoCatalogo | null>(null);
  const [editedPermissoes, setEditedPermissoes] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Carregar perfis do Supabase
  const fetchPerfis = async () => {
    try {
      const data = await listPerfisDoCatalogo();
      setPerfis(data);
      if (data.length > 0) {
        // Preservar seleção atual se existir, senão selecionar o primeiro
        const currentSelectedId = perfilSelecionado?.id;
        const matching = currentSelectedId ? data.find((p) => p.id === currentSelectedId) : null;
        const nextSelected = matching || data[0];
        setPerfilSelecionado(nextSelected);
        setEditedPermissoes(nextSelected.permissoes);
      }
    } catch (err) {
      console.error("[PerfisPermissoesPanel] Erro ao carregar perfis:", err);
      showToast({
        type: "error",
        title: "Falha ao carregar perfis",
        description: "Ocorreu um erro ao buscar os perfis cadastrados no Supabase."
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPerfis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPerfil = (perfil: PerfilDoCatalogo) => {
    setPerfilSelecionado(perfil);
    setEditedPermissoes(perfil.permissoes);
  };

  const toggleAccordion = (group: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [group]: !prev[group]
    }));
  };

  const handleCheckboxChange = (permKey: string, checked: boolean) => {
    if (!perfilSelecionado || perfilSelecionado.slug === "super_admin") return;

    // 🔒 Proteção: Bloquear auto-desmarcação de admin.usuarios.edit do próprio perfil conectado
    const isSelfProfile = user && user.id_perfil === perfilSelecionado.id;
    if (isSelfProfile && permKey === "admin.usuarios.edit" && !checked) {
      showToast({
        type: "warning",
        title: "Ação bloqueada",
        description: "Você não pode remover a permissão admin.usuarios.edit do seu próprio perfil para evitar auto-bloqueio."
      });
      return;
    }

    if (checked) {
      setEditedPermissoes((prev) => Array.from(new Set([...prev, permKey])));
    } else {
      setEditedPermissoes((prev) => prev.filter((p) => p !== permKey));
    }
  };

  const handleGroupSelection = (groupName: string, selectAll: boolean) => {
    if (!perfilSelecionado || perfilSelecionado.slug === "super_admin") return;

    const groupPerms = CATALOGO_PERMISSOES[groupName].map((p) => p.key);
    const isSelfProfile = user && user.id_perfil === perfilSelecionado.id;

    setEditedPermissoes((prev) => {
      let updated = [...prev];
      if (selectAll) {
        const toAdd = groupPerms.filter((k) => !updated.includes(k));
        updated.push(...toAdd);
      } else {
        updated = updated.filter((k) => {
          if (groupPerms.includes(k)) {
            // Se for auto-bloqueio, impede
            if (isSelfProfile && k === "admin.usuarios.edit") {
              showToast({
                type: "warning",
                title: "Ação bloqueada",
                description: "Você não pode remover a permissão admin.usuarios.edit do seu próprio perfil para evitar auto-bloqueio."
              });
              return true; // mantém
            }
            return false; // remove
          }
          return true; // mantém as outras
        });
      }
      return Array.from(new Set(updated));
    });
  };

  const isSelected = (permKey: string) => {
    if (perfilSelecionado?.slug === "super_admin") {
      return true; // Super admin tem todas as permissões e wildcard implícito
    }
    return editedPermissoes.includes(permKey);
  };

  const handleOpenConfirmacao = () => {
    if (!perfilSelecionado) return;
    setIsDiffModalOpen(true);
  };

  const handleSave = async () => {
    if (!perfilSelecionado) return;
    setIsSaving(true);
    try {
      // Higienizar e filtrar permissões
      const isSuperAdmin = perfilSelecionado.slug === "super_admin";
      let finalPerms: string[] = [];

      if (isSuperAdmin) {
        finalPerms = ["*"];
      } else {
        const allowedKeys = Object.values(CATALOGO_PERMISSOES)
          .flatMap((group) => group.map((p) => p.key));
        
        finalPerms = editedPermissoes
          .map((p) => p.trim())
          .filter((p) => p !== "" && p !== "*" && allowedKeys.includes(p));
        finalPerms = Array.from(new Set(finalPerms));
      }

      await updatePermissoesPerfil(perfilSelecionado.id, finalPerms);

      showToast({
        type: "success",
        title: "Permissões salvas",
        description: "As alterações de permissões foram gravadas com sucesso."
      });

      setIsDiffModalOpen(false);
      await fetchPerfis();
    } catch (err: unknown) {
      console.error("[Erro RLS/Database] Falha ao executar updatePermissoesPerfil:", err);
      
      showToast({
        type: "error",
        title: "Erro de permissão (RLS)",
        description: "O banco de dados recusou a atualização. Certifique-se de que as políticas de escrita estão ativas no Supabase."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const totalPermissoesExibidas = useMemo(() => {
    if (perfilSelecionado?.slug === "super_admin") return "Acesso Total (*)";
    return `${editedPermissoes.length} ativas`;
  }, [perfilSelecionado, editedPermissoes]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent mx-auto" />
          <p className="text-sm text-slate-500 font-semibold">Carregando catálogo de perfis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr] items-start text-foreground">
      {/* Coluna Esquerda: Listagem de Perfis */}
      <div className="space-y-4">
        <div className="rounded-3xl border p-4 bg-white space-y-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wider px-2">
            Perfis de Acesso
          </h2>
          <div className="flex flex-col gap-1.5">
            {perfis.map((p) => {
              const active = perfilSelecionado?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPerfil(p)}
                  className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col gap-1.5 ${
                    active
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 font-semibold"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-bold truncate">{p.nome}</span>
                    <span className={`text-[9px] font-bold rounded px-1 py-0.5 border ${
                      active 
                        ? "bg-blue-100 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                        : "bg-slate-50 border-slate-200 text-slate-600 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400"
                    }`}>
                      {p.slug}
                    </span>
                  </div>
                  <span className="text-xs opacity-85">
                    {p.slug === "super_admin" ? "Acesso total" : `${p.permissoes.length} permissões`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Coluna Direita: Editor de Permissões */}
      {perfilSelecionado && (
        <div className="rounded-3xl border bg-white flex flex-col shadow-sm" style={{ borderColor: "var(--border)" }}>
          {/* Cabeçalho do Editor */}
          <div className="border-b p-6 space-y-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{perfilSelecionado.nome}</h2>
                  <span className="rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    slug: {perfilSelecionado.slug}
                  </span>
                </div>
                {perfilSelecionado.descricao && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {perfilSelecionado.descricao}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-semibold bg-neutral-50 border rounded-2xl px-3.5 py-1.5">
                <Shield className="h-4 w-4 text-blue-600" />
                <span>{totalPermissoesExibidas}</span>
              </div>
            </div>

            {perfilSelecionado.slug === "super_admin" && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 flex gap-3 text-sm text-blue-800 leading-relaxed font-semibold">
                <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                <p>
                  O perfil <strong>Super Administrador</strong> possui acesso total e irrestrito ao sistema (`*`). 
                  Sua edição é travada pelo sistema por motivos de segurança e para evitar a perda do acesso root.
                </p>
              </div>
            )}
          </div>

          {/* Acordeões de Permissões */}
          <div className="p-6 space-y-4">
            {Object.entries(CATALOGO_PERMISSOES).map(([groupName, permissions]) => {
              const isCollapsed = collapsedGroups[groupName];
              return (
                <div key={groupName} className="rounded-2xl border bg-neutral-50/20" style={{ borderColor: "var(--border)" }}>
                  <div className="w-full flex items-center justify-between p-4 border-b border-transparent hover:border-slate-100 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleAccordion(groupName)}
                      className="flex-1 flex items-center justify-start gap-2 font-bold text-sm select-none"
                    >
                      <span>{groupName}</span>
                      {isCollapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
                    </button>
                    {!isCollapsed && perfilSelecionado?.slug !== "super_admin" && (
                      <div className="flex items-center gap-3">
                        <button 
                          type="button" 
                          onClick={() => handleGroupSelection(groupName, true)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                        >
                          Marcar todas
                        </button>
                        <button 
                          type="button" 
                          onClick={() => handleGroupSelection(groupName, false)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
                        >
                          Desmarcar
                        </button>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="border-t p-4 grid gap-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
                      {permissions.map((perm) => {
                        const checked = isSelected(perm.key);
                        const isSuperAdmin = perfilSelecionado.slug === "super_admin";
                        const isSelfProfile = Boolean(user && user.id_perfil === perfilSelecionado.id);
                        const isSelfAdminEditLock = Boolean(isSelfProfile && perm.key === "admin.usuarios.edit");
                        const disabled = isSuperAdmin || isSelfAdminEditLock;

                        return (
                          <label
                            key={perm.key}
                            className={`relative border rounded-2xl p-4 flex items-start gap-3 select-none cursor-pointer transition-all ${
                              checked
                                ? "bg-white border-blue-200 dark:border-blue-900/50 shadow-sm"
                                : "bg-neutral-50/30 hover:bg-white border-slate-100"
                            } ${disabled ? "opacity-80 cursor-not-allowed" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => handleCheckboxChange(perm.key, e.target.checked)}
                              className="h-4.5 w-4.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            />
                            <div className="space-y-1 pr-6">
                              <span className="text-sm font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                                {perm.label}
                                {perm.critica && (
                                  <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 uppercase">
                                    <ShieldAlert className="h-2.5 w-2.5" /> Crítica
                                  </span>
                                )}
                              </span>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {perm.desc}
                              </p>
                              <code className="inline-block text-[10px] bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-500 select-all">
                                {perm.key}
                              </code>
                            </div>
                            {disabled && (
                              <Lock className="absolute top-4 right-4 h-3.5 w-3.5 text-neutral-400 shrink-0" />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Rodapé do Editor */}
          <div className="border-t p-6 flex items-center justify-end gap-3" style={{ borderColor: "var(--border)", background: "var(--card-footer, #fafafa)" }}>
            <button
              type="button"
              disabled={perfilSelecionado.slug === "super_admin"}
              onClick={handleOpenConfirmacao}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-sm flex items-center gap-2 transition ${
                perfilSelecionado.slug === "super_admin"
                  ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
              }`}
            >
              <Save className="h-4 w-4" />
              Salvar Alterações
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmação & Diff */}
      {perfilSelecionado && (
        <ConfirmacaoDiffModal
          isOpen={isDiffModalOpen}
          onClose={() => setIsDiffModalOpen(false)}
          onConfirm={() => void handleSave()}
          originalPermissoes={perfilSelecionado.permissoes}
          editedPermissoes={editedPermissoes}
          perfilNome={perfilSelecionado.nome}
          isSaving={isSaving}
        />
      )}
      {/* Botão Salvar Flutuante (Sticky) */}
      {perfilSelecionado && perfilSelecionado.slug !== "super_admin" && (
        <div className="fixed bottom-24 right-6 md:right-8 z-40">
          <button
            type="button"
            onClick={handleOpenConfirmacao}
            className="rounded-full bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/30 flex items-center gap-2 hover:bg-blue-700 hover:-translate-y-1 hover:shadow-xl transition-all"
          >
            <Save className="h-4.5 w-4.5" />
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}
