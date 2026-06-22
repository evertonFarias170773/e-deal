"use client";

import { useRef, useEffect, useState } from "react";
import { GripVertical, ChevronUp, ChevronDown, Bold, Italic, Underline, Strikethrough, Baseline, Highlighter, ListOrdered, List, Eraser } from "lucide-react";

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ label, value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);

  // Sync external value changes into the editor, but avoid cursor jumps if the user is typing
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      editorRef.current.focus();
      onChange(editorRef.current.innerHTML);
    }
  };

  const ToolbarButton = ({
    command,
    icon,
    arg,
  }: {
    command: string;
    icon: React.ReactNode;
    arg?: string;
  }) => (
    <button
      type="button"
      onClick={() => execCommand(command, arg)}
      className="p-1.5 text-slate-700 hover:bg-slate-200 rounded transition-colors"
      title={command}
    >
      {icon}
    </button>
  );

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col">
      {/* TOOLBAR (Cabeçalho) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 p-2 sm:px-3 sm:py-2 rounded-t-xl">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 text-slate-500">
          {/* Drag Handle & Collapse Toggle */}
          <div className="flex items-center gap-1">
            <GripVertical className="w-4 h-4 cursor-grab hover:text-slate-700" />
            <button type="button" onClick={() => setIsOpen(!isOpen)} className="p-1 hover:bg-slate-200 rounded text-slate-700 transition">
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Nome do Bloco */}
          <div className="border border-dashed border-slate-300 bg-white/50 px-3 py-1 rounded text-sm text-slate-500 truncate max-w-[150px] sm:max-w-xs">
            Ref: {label}
          </div>

          {/* Font Dropdowns */}
          <div className="hidden lg:flex items-center gap-2">
            <select className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer">
              <option>Sans Serif</option>
            </select>
            <select className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer">
              <option>Normal</option>
            </select>
          </div>

          {/* Separator */}
          <div className="hidden sm:block w-px h-5 bg-slate-200 mx-1" />

          {/* Formatting */}
          <div className="flex items-center gap-0.5">
            <ToolbarButton command="bold" icon={<Bold className="w-4 h-4" />} />
            <ToolbarButton command="italic" icon={<Italic className="w-4 h-4" />} />
            <ToolbarButton command="underline" icon={<Underline className="w-4 h-4" />} />
            <ToolbarButton command="strikethrough" icon={<Strikethrough className="w-4 h-4" />} />
          </div>

          {/* Separator */}
          <div className="hidden sm:block w-px h-5 bg-slate-200 mx-1" />

          {/* Colors */}
          <div className="flex items-center gap-0.5">
            <ToolbarButton command="foreColor" icon={<Baseline className="w-4 h-4" />} />
            <ToolbarButton command="hiliteColor" icon={<Highlighter className="w-4 h-4" />} />
          </div>

          {/* Separator */}
          <div className="hidden sm:block w-px h-5 bg-slate-200 mx-1" />

          {/* Lists & Clear */}
          <div className="flex items-center gap-0.5">
            <ToolbarButton command="insertOrderedList" icon={<ListOrdered className="w-4 h-4" />} />
            <ToolbarButton command="insertUnorderedList" icon={<List className="w-4 h-4" />} />
            <ToolbarButton command="removeFormat" icon={<Eraser className="w-4 h-4" />} />
          </div>
        </div>

        {/* Ação: Fechar */}
        <div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* EDITOR BODY */}
      {isOpen && (
        <div className="p-3">
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            className="min-h-[120px] max-h-[400px] overflow-y-auto rounded border border-slate-200 p-4 text-sm text-slate-800 outline-none transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20"
            data-placeholder={placeholder}
          />
        </div>
      )}
    </div>
  );
}
