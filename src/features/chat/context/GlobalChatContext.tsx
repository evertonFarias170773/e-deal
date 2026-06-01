import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { PropostaChatDrawer } from "@/features/orcamentos/components/PropostaChatDrawer";
import type { PropostaChatResumo } from "@/features/orcamentos/services/orcamentos.service";

interface ChatContextProps {
  isOpen: boolean;
  activeIdInt: number | null;
  clienteNome: string | null;
  idCliente: string | number | null;
  tituloContexto: string;
  openChat: (
    idInt: number,
    options?: {
      clienteNome?: string | null;
      idCliente?: string | number | null;
      tituloContexto?: string;
      onMessagesUpdated?: (summary: PropostaChatResumo) => void;
      onClose?: () => void;
    }
  ) => void;
  closeChat: () => void;
}

const GlobalChatContext = createContext<ChatContextProps | null>(null);

export function GlobalChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdInt, setActiveIdInt] = useState<number | null>(null);
  const [clienteNome, setClienteNome] = useState<string | null>(null);
  const [idCliente, setIdCliente] = useState<string | number | null>(null);
  const [tituloContexto, setTituloContexto] = useState("Chat interno");

  const onMessagesUpdatedRef = useRef<((summary: PropostaChatResumo) => void) | undefined>(undefined);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);

  const openChat = useCallback(
    (
      idInt: number,
      options?: {
        clienteNome?: string | null;
        idCliente?: string | number | null;
        tituloContexto?: string;
        onMessagesUpdated?: (summary: PropostaChatResumo) => void;
        onClose?: () => void;
      }
    ) => {
      setActiveIdInt(idInt);
      setClienteNome(options?.clienteNome ?? null);
      setIdCliente(options?.idCliente ?? null);
      setTituloContexto(options?.tituloContexto ?? "Chat interno");
      onMessagesUpdatedRef.current = options?.onMessagesUpdated;
      onCloseRef.current = options?.onClose;
      setIsOpen(true);
    },
    []
  );

  const closeChat = useCallback(() => {
    setIsOpen(false);
    if (onCloseRef.current) {
      onCloseRef.current();
    }
  }, []);

  return (
    <GlobalChatContext.Provider
      value={{
        isOpen,
        activeIdInt,
        clienteNome,
        idCliente,
        tituloContexto,
        openChat,
        closeChat
      }}
    >
      {children}
      {isOpen && activeIdInt !== null && (
        <PropostaChatDrawer
          key={activeIdInt} // Force remount if ID changes
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open && onCloseRef.current) {
              onCloseRef.current();
            }
          }}
          idInt={activeIdInt}
          clienteNome={clienteNome}
          idCliente={idCliente}
          tituloContexto={tituloContexto}
          onMessagesUpdated={(summary) => {
            if (onMessagesUpdatedRef.current) {
              onMessagesUpdatedRef.current(summary);
            }
          }}
        />
      )}
    </GlobalChatContext.Provider>
  );
}

export function useGlobalChat() {
  const context = useContext(GlobalChatContext);
  if (!context) {
    throw new Error("useGlobalChat deve ser usado dentro de um GlobalChatProvider");
  }
  return context;
}
