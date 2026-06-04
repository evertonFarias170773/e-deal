"use client";

import { useState, useEffect, useCallback } from "react";
import { PedidoMock, PedidoStatus, ModeloMock, ArteStatus, ProducaoStatus } from "../types";
import { initialPedidosMock } from "../mocks/pedidos.mock";

const STORAGE_KEY = "erp_ideal_mock_pedidos_db";
const CHAT_STORAGE_KEY_PREFIX = "erp_ideal_mock_pedidos_chat_";

export interface MockChatMessage {
  id: string;
  id_int: number;
  autor_nome: string;
  setor: string;
  tipo: "SISTEMA" | "PRODUCAO" | "MENSAGEM" | "FINANCEIRO";
  mensagem: string;
  created_at: string;
  anexos?: { url: string; name: string; type: string }[];
}

export function usePedidosMockDb() {
  const [pedidos, setPedidos] = useState<PedidoMock[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Initialize DB in localStorage if not exists
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const needsUpgrade = !Array.isArray(parsed) || parsed.length < 80 || parsed.some(p => !p.produtos);
          if (needsUpgrade) {
            console.log("Old database format or missing 'produtos' field detected. Resetting to 100 orders...");
            localStorage.setItem(STORAGE_KEY, JSON.stringify(initialPedidosMock));
            setPedidos(initialPedidosMock);
          } else {
            setPedidos(parsed);
          }
        } catch (e) {
          console.error("Failed to parse stored mock database, resetting...", e);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(initialPedidosMock));
          setPedidos(initialPedidosMock);
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialPedidosMock));
        setPedidos(initialPedidosMock);
      }
      setIsLoaded(true);
    }
  }, []);

  const saveDb = useCallback((newPedidos: PedidoMock[]) => {
    const synchronized = newPedidos.map(p => ({
      ...p,
      modelos: p.produtos ? p.produtos.flatMap(prod => prod.modelos) : p.modelos || []
    }));
    setPedidos(synchronized);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(synchronized));
      // Dispatch a storage event locally so other tabs/components listen
      window.dispatchEvent(new Event("storage_db_updated"));
    }
  }, []);

  // Listen to local storage updates from other pages
  useEffect(() => {
    const handleStorageUpdate = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          setPedidos(JSON.parse(stored));
        } catch (e) {
          console.error(e);
        }
      }
    };

    window.addEventListener("storage_db_updated", handleStorageUpdate);
    return () => {
      window.removeEventListener("storage_db_updated", handleStorageUpdate);
    };
  }, []);

  // GET chat messages helper
  const getChatMessages = useCallback((idInt: number): MockChatMessage[] => {
    if (typeof window === "undefined") return [];
    const chatKey = `${CHAT_STORAGE_KEY_PREFIX}${idInt}`;
    const stored = localStorage.getItem(chatKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        return [];
      }
    }

    // Load status from local storage to seed defaults properly
    const storedDb = localStorage.getItem(STORAGE_KEY);
    let statusPedido: PedidoStatus = "NOVO";
    if (storedDb) {
      try {
        const parsedDb = JSON.parse(storedDb);
        const found = parsedDb.find((p: any) => p.id_int === idInt);
        if (found) {
          statusPedido = found.statusPedido;
        }
      } catch (e) {}
    }

    const defaults: MockChatMessage[] = [
      {
        id: `chat_${idInt}_init`,
        id_int: idInt,
        autor_nome: "Sistema",
        setor: "Sistema",
        tipo: "SISTEMA",
        mensagem: `Pedido criado a partir da proposta comercial #${idInt}. Status: NOVO.`,
        created_at: new Date(Date.now() - 3600000 * 24).toISOString() // 1 day ago
      },
      {
        id: `chat_${idInt}_fin`,
        id_int: idInt,
        autor_nome: "Faturamento",
        setor: "Financeiro",
        tipo: "FINANCEIRO",
        mensagem: "Cobrança financeira gerada e confirmada via PIX.",
        created_at: new Date(Date.now() - 3600000 * 23.5).toISOString()
      }
    ];

    const timeRef = Date.now();

    if (statusPedido !== "NOVO" && statusPedido !== "CANCELADO") {
      defaults.push({
        id: `chat_${idInt}_design_init`,
        id_int: idInt,
        autor_nome: "Everton Farias (Designer)",
        setor: "Design",
        tipo: "PRODUCAO",
        mensagem: "Iniciado o desenvolvimento do layout da arte gráfica dos lotes.",
        created_at: new Date(timeRef - 3600000 * 22).toISOString()
      });
    }

    if ([
      "AGUARDANDO_APROVACAO_CLIENTE", 
      "AGUARDANDO_APROVACAO_ATENDENTE", 
      "AGUARDANDO_OS", 
      "EM_IMPRESSAO", 
      "EM_ACABAMENTO", 
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_design_upload`,
        id_int: idInt,
        autor_nome: "Everton Farias (Designer)",
        setor: "Design",
        tipo: "PRODUCAO",
        mensagem: "Upload da primeira versão de arte finalizado para aprovação da prova digital.",
        created_at: new Date(timeRef - 3600000 * 20).toISOString()
      });
      defaults.push({
        id: `chat_${idInt}_design_link`,
        id_int: idInt,
        autor_nome: "Sistema",
        setor: "Sistema",
        tipo: "SISTEMA",
        mensagem: "Link público de aprovação de arte gerado e notificado ao cliente.",
        created_at: new Date(timeRef - 3600000 * 19.5).toISOString()
      });
    }

    if ([
      "AGUARDANDO_APROVACAO_ATENDENTE", 
      "AGUARDANDO_OS", 
      "EM_IMPRESSAO", 
      "EM_ACABAMENTO", 
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_client_aprov`,
        id_int: idInt,
        autor_nome: "Cliente Final",
        setor: "Comercial",
        tipo: "PRODUCAO",
        mensagem: "✅ Arte do modelo aprovada pelo cliente através da central de assinaturas.",
        created_at: new Date(timeRef - 3600000 * 18).toISOString()
      });
    }

    if ([
      "AGUARDANDO_OS", 
      "EM_IMPRESSAO", 
      "EM_ACABAMENTO", 
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_atend_lib`,
        id_int: idInt,
        autor_nome: "Atendente Comercial",
        setor: "Comercial",
        tipo: "PRODUCAO",
        mensagem: "Arte homologada pelo comercial e liberada para o setor de pré-impressão.",
        created_at: new Date(timeRef - 3600000 * 17).toISOString()
      });
      defaults.push({
        id: `chat_${idInt}_sys_os`,
        id_int: idInt,
        autor_nome: "Sistema",
        setor: "Sistema",
        tipo: "SISTEMA",
        mensagem: "Ordem de Serviço (OS) unificada impressa e distribuída para o setor gráfico.",
        created_at: new Date(timeRef - 3600000 * 16.5).toISOString()
      });
    }

    if ([
      "EM_IMPRESSAO", 
      "EM_ACABAMENTO", 
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_impressao_start`,
        id_int: idInt,
        autor_nome: "José Silva (Impressor)",
        setor: "Produção",
        tipo: "PRODUCAO",
        mensagem: "🖨️ Início de impressão física dos lotes na impressora offset.",
        created_at: new Date(timeRef - 3600000 * 12).toISOString()
      });
    }

    if ([
      "EM_ACABAMENTO", 
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_impressao_end`,
        id_int: idInt,
        autor_nome: "José Silva (Impressor)",
        setor: "Produção",
        tipo: "PRODUCAO",
        mensagem: "✅ Lote de impressão finalizado e encaminhado para acabamento (facas/corte).",
        created_at: new Date(timeRef - 3600000 * 8).toISOString()
      });
    }

    if ([
      "REVISAO_FINAL", 
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_acabamento_end`,
        id_int: idInt,
        autor_nome: "Maria Sousa (Acabamento)",
        setor: "Produção",
        tipo: "PRODUCAO",
        mensagem: "Guilhotinamento e empacotamento em blocos de 100 concluídos. Enviado para revisão final de qualidade.",
        created_at: new Date(timeRef - 3600000 * 5).toISOString()
      });
    }

    if ([
      "PRONTO_EXPEDICAO", 
      "EXPEDIDO"
    ].includes(statusPedido)) {
      defaults.push({
        id: `chat_${idInt}_expedicao_pesagem`,
        id_int: idInt,
        autor_nome: "Carlos Santos (Líder Logístico)",
        setor: "Expedição",
        tipo: "PRODUCAO",
        mensagem: "Conferência de volumes e pesagem na balança. Peso aferido dentro da tolerância de segurança.",
        created_at: new Date(timeRef - 3600000 * 2).toISOString()
      });
    }

    if (statusPedido === "EXPEDIDO") {
      defaults.push({
        id: `chat_${idInt}_expedido_end`,
        id_int: idInt,
        autor_nome: "Carlos Santos (Líder Logístico)",
        setor: "Expedição",
        tipo: "PRODUCAO",
        mensagem: "📦 Pedido despachado via transportadora parceira. Código de rastreamento anexado.",
        created_at: new Date(timeRef - 3600000 * 1).toISOString()
      });
    }

    localStorage.setItem(chatKey, JSON.stringify(defaults));
    return defaults;
  }, []);

  // ADD chat message helper
  const addChatMessage = useCallback((
    idInt: number,
    autor: string,
    setor: string,
    tipo: MockChatMessage["tipo"],
    mensagem: string,
    anexos?: MockChatMessage["anexos"]
  ) => {
    if (typeof window === "undefined") return;
    const chatKey = `${CHAT_STORAGE_KEY_PREFIX}${idInt}`;
    const current = getChatMessages(idInt);
    const newMessage: MockChatMessage = {
      id: `chat_msg_${Date.now()}`,
      id_int: idInt,
      autor_nome: autor,
      setor,
      tipo,
      mensagem,
      created_at: new Date().toISOString(),
      anexos
    };

    const updated = [...current, newMessage];
    localStorage.setItem(chatKey, JSON.stringify(updated));
    window.dispatchEvent(new Event(`chat_updated_${idInt}`));
  }, [getChatMessages]);

  const updatePedidoStatus = useCallback((idInt: number, status: PedidoStatus) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        return { ...p, statusPedido: status };
      }
      return p;
    });
    saveDb(updated);

    addChatMessage(
      idInt,
      "Sistema",
      "Sistema",
      "SISTEMA",
      `Status do pedido alterado para [${status}] por Operador Interno.`
    );
  }, [pedidos, saveDb, addChatMessage]);

  const toggleUrgente = useCallback((idInt: number) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextUrgente = !p.urgente;
        addChatMessage(
          idInt,
          "Sistema",
          "Produção",
          "PRODUCAO",
          nextUrgente
            ? "⚡ Pedido marcado como URGENTE pelo Gerente de Produção."
            : "Pedido desmarcado como URGENTE."
        );
        return { ...p, urgente: nextUrgente };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const uploadArteModelo = useCallback((idInt: number, idModelo: string, fileName: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              const nextVersao = (m.arteAtual?.versao ?? 0) + 1;
              const novaArte = {
                versao: nextVersao,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: fileName,
                dataUpload: new Date().toISOString()
              };

              const novoHistorico = [
                ...m.historicoArtes,
                {
                  versao: nextVersao,
                  urlArquivo: novaArte.urlArquivo,
                  nomeArquivo: fileName,
                  status: "EM_REVISAO_INTERNA" as ArteStatus,
                  dataUpload: novaArte.dataUpload
                }
              ];

              addChatMessage(
                idInt,
                "Designer Gráfico",
                "Arte",
                "PRODUCAO",
                `Nova versão de arte carregada para o modelo "${m.nomeModelo}" (v${nextVersao}): ${fileName}. Enviado para revisão interna.`,
                [{ url: novaArte.urlArquivo, name: fileName, type: "application/pdf" }]
              );

              return {
                ...m,
                statusArte: "EM_REVISAO_INTERNA" as ArteStatus,
                arteAtual: novaArte,
                historicoArtes: novoHistorico
              };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });

        return { ...p, produtos: nextProdutos, statusPedido: "ARTE_EM_ANDAMENTO" as PedidoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const enviarParaAprovacaoCliente = useCallback((idInt: number, idModelo: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              addChatMessage(
                idInt,
                "Sistema",
                "Arte",
                "PRODUCAO",
                `Link de aprovação gerado e enviado ao cliente para o modelo "${m.nomeModelo}". Link: /pedidos/aprovacao/${m.tokenAprovacao}`
              );
              return {
                ...m,
                statusArte: "AGUARDANDO_CLIENTE" as ArteStatus
              };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });
        return { ...p, produtos: nextProdutos, statusPedido: "AGUARDANDO_APROVACAO_CLIENTE" as PedidoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const liberarArteModelo = useCallback((idInt: number, idModelo: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        let allLiberados = true;
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              addChatMessage(
                idInt,
                "Atendente",
                "Comercial",
                "PRODUCAO",
                `✅ Arte do modelo "${m.nomeModelo}" foi LIBERADA para impressão.`
              );
              return { ...m, statusArte: "LIBERADA" as ArteStatus };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });

        nextProdutos.forEach((prod) => {
          prod.modelos.forEach((m) => {
            if (m.statusArte !== "LIBERADA" && m.statusArte !== "NAO_NECESSARIA") {
              allLiberados = false;
            }
          });
        });

        const nextStatus = allLiberados ? "AGUARDANDO_OS" : p.statusPedido;

        return { ...p, produtos: nextProdutos, statusPedido: nextStatus as PedidoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const registrarDecisaoCliente = useCallback((
    token: string,
    status: "APROVADA_CLIENTE" | "REPROVADA_CLIENTE",
    comentario?: string,
    clienteNome?: string
  ) => {
    let targetPedidoId: number | null = null;
    let targetModeloNome = "";

    const updated = pedidos.map((p) => {
      const hasToken = p.produtos.some((prod) => prod.modelos.some((m) => m.tokenAprovacao === token));
      if (hasToken) {
        targetPedidoId = p.id_int;
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.tokenAprovacao === token) {
              targetModeloNome = m.nomeModelo;
              const updatedHistorico = m.historicoArtes.map((h) => {
                if (m.arteAtual && h.versao === m.arteAtual.versao) {
                  return { ...h, status: status };
                }
                return h;
              });

              return {
                ...m,
                statusArte: status,
                comentarioCliente: status === "REPROVADA_CLIENTE" ? comentario : undefined,
                aprovadoPorNome: status === "APROVADA_CLIENTE" ? clienteNome || "Cliente Final" : undefined,
                aprovadoEm: status === "APROVADA_CLIENTE" ? new Date().toISOString() : undefined,
                historicoArtes: updatedHistorico
              };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });

        let nextPedidoStatus = p.statusPedido;
        if (status === "APROVADA_CLIENTE") {
          nextPedidoStatus = "AGUARDANDO_APROVACAO_ATENDENTE" as PedidoStatus;
        } else if (status === "REPROVADA_CLIENTE") {
          nextPedidoStatus = "ARTE_EM_ANDAMENTO" as PedidoStatus;
        }

        return { ...p, produtos: nextProdutos, statusPedido: nextPedidoStatus };
      }
      return p;
    });

    if (targetPedidoId !== null) {
      saveDb(updated);

      if (status === "APROVADA_CLIENTE") {
        addChatMessage(
          targetPedidoId,
          clienteNome || "Cliente",
          "Cliente",
          "PRODUCAO",
          `✅ Arte do modelo "${targetModeloNome}" foi APROVADA pelo cliente (${clienteNome || "Cliente Final"}). Aguardando liberação do atendente.`
        );
      } else {
        addChatMessage(
          targetPedidoId,
          "Cliente",
          "Cliente",
          "PRODUCAO",
          `❌ Arte do modelo "${targetModeloNome}" foi REPROVADA pelo cliente. Motivo: "${comentario || "Não especificado"}"`
        );
      }
      return true;
    }
    return false;
  }, [pedidos, saveDb, addChatMessage]);

  const registrarPesagem = useCallback((idInt: number, pesoAferido: number, volumes: number) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        addChatMessage(
          idInt,
          "Gerente de Produção",
          "Expedição",
          "PRODUCAO",
          `Volumes aferidos para expedição: ${volumes} vol(s) com peso total de ${pesoAferido}kg. (Peso teórico esperado: ${p.pesoTeorico}kg).`
        );
        return { ...p, pesoAferido, volumes, statusPedido: "REVISAO_FINAL" as PedidoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const moverEtapaPedido = useCallback((idInt: number, novoStatus: PedidoStatus) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        addChatMessage(
          idInt,
          "Gerente",
          "Produção",
          "PRODUCAO",
          `Pedido movido para a etapa [${novoStatus}] no Kanban.`
        );
        return { ...p, statusPedido: novoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const pausarProducao = useCallback((idInt: number, motivo: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        addChatMessage(
          idInt,
          "Gerente",
          "Produção",
          "PRODUCAO",
          `⚠️ Produção pausada. Motivo: ${motivo}`
        );
        return { ...p, blockReason: motivo, tempoParadoMinutos: 5 };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const liberarPausa = useCallback((idInt: number) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        addChatMessage(
          idInt,
          "Gerente",
          "Produção",
          "PRODUCAO",
          "✅ Pausa operacional resolvida. Pedido liberado para retomar a produção."
        );
        const { blockReason, tempoParadoMinutos, ...rest } = p;
        return rest as PedidoMock;
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const iniciarImpressaoModelo = useCallback((idInt: number, idModelo: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              addChatMessage(
                idInt,
                "Impressor",
                "Produção",
                "PRODUCAO",
                `🖨️ Iniciada a impressão física do modelo "${m.nomeModelo}".`
              );
              return { ...m, statusProducao: "EM_IMPRESSAO" as ProducaoStatus };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });
        return {
          ...p,
          produtos: nextProdutos,
          statusPedido: "EM_IMPRESSAO" as PedidoStatus,
          dataInicioImpressao: new Date().toISOString()
        };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const finalizarImpressaoModelo = useCallback((idInt: number, idModelo: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              addChatMessage(
                idInt,
                "Impressor",
                "Produção",
                "PRODUCAO",
                `✅ Concluída a impressão do modelo "${m.nomeModelo}". Lote enviado para Acabamento.`
              );
              return { ...m, statusProducao: "EM_ACABAMENTO" as ProducaoStatus };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });
        return {
          ...p,
          produtos: nextProdutos,
          statusPedido: "EM_ACABAMENTO" as PedidoStatus
        };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const despacharPedido = useCallback((idInt: number, pesoAferido: number, volumes: number) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        addChatMessage(
          idInt,
          "Balança Expedição",
          "Expedição",
          "PRODUCAO",
          `📦 Pedido despachado. Aferido: ${volumes} volume(s) com ${pesoAferido.toFixed(2)}kg (Teórico: ${p.pesoTeorico.toFixed(2)}kg).`
        );
        return { ...p, pesoAferido, volumes, statusPedido: "EXPEDIDO" as PedidoStatus };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb, addChatMessage]);

  const salvarComentarioInternoModelo = useCallback((idInt: number, idModelo: string, comentario: string) => {
    const updated = pedidos.map((p) => {
      if (p.id_int === idInt) {
        const nextProdutos = p.produtos.map((prod) => {
          const nextModelos = prod.modelos.map((m) => {
            if (m.id === idModelo) {
              return { ...m, comentarioInterno: comentario };
            }
            return m;
          });
          return { ...prod, modelos: nextModelos };
        });
        return { ...p, produtos: nextProdutos };
      }
      return p;
    });
    saveDb(updated);
  }, [pedidos, saveDb]);

  const addPedido = useCallback((pedidoData: Omit<PedidoMock, "id_int" | "modelos">) => {
    const nextId = pedidos.length > 0 ? Math.max(...pedidos.map(p => p.id_int)) + 1 : 18000;
    const newPedido: PedidoMock = {
      ...pedidoData,
      id_int: nextId,
      modelos: pedidoData.produtos ? pedidoData.produtos.flatMap(prod => prod.modelos) : []
    };
    const updated = [newPedido, ...pedidos];
    saveDb(updated);

    // Seed default chat messages for the new order
    const chatKey = `${CHAT_STORAGE_KEY_PREFIX}${nextId}`;
    const defaults: MockChatMessage[] = [
      {
        id: `chat_${nextId}_init`,
        id_int: nextId,
        autor_nome: "Sistema",
        setor: "Sistema",
        tipo: "SISTEMA",
        mensagem: `Pedido/OS #${nextId} criado pelo vendedor ${pedidoData.vendedor} para o cliente ${pedidoData.clienteNome}.`,
        created_at: new Date().toISOString()
      }
    ];
    localStorage.setItem(chatKey, JSON.stringify(defaults));

    return nextId;
  }, [pedidos, saveDb]);

  return {
    pedidos,
    isLoaded,
    updatePedidoStatus,
    toggleUrgente,
    uploadArteModelo,
    enviarParaAprovacaoCliente,
    liberarArteModelo,
    registrarDecisaoCliente,
    registrarPesagem,
    despacharPedido,
    moverEtapaPedido,
    pausarProducao,
    liberarPausa,
    iniciarImpressaoModelo,
    finalizarImpressaoModelo,
    getChatMessages,
    addChatMessage,
    salvarComentarioInternoModelo,
    addPedido
  };
}
