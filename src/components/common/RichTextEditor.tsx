"use client";

import { useRef, useEffect } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Sync external value changes into the editor, but avoid cursor jumps if the user is typing
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      // Only update if the content actually changed externally (e.g. init)
      // If we are actively typing, the innerHTML is already updated via onInput
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
    icon: string;
    arg?: string;
  }) => (
    <button
      type="button"
      onClick={() => execCommand(command, arg)}
      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded transition-colors"
      title={command}
    >
      {icon}
    </button>
  );

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white overflow-hidden focus-within:border-teal-500 focus-within:ring-4 focus-within:ring-teal-500/10 transition">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50 p-2">
        <ToolbarButton command="bold" icon="B" />
        <ToolbarButton command="italic" icon="I" />
        <ToolbarButton command="underline" icon="U" />
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton command="insertUnorderedList" icon="• Lista" />
        <ToolbarButton command="insertOrderedList" icon="1. Lista" />
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton command="justifyLeft" icon="↤ Esq" />
        <ToolbarButton command="justifyCenter" icon="↔ Cen" />
        <ToolbarButton command="justifyRight" icon="↦ Dir" />
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton command="removeFormat" icon="T ⃠ Limpar" />
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto text-sm text-slate-800 outline-none"
        data-placeholder={placeholder}
        style={{
          // Simple placeholder trick using empty content + before pseudo-element (handled via CSS usually, but we can just let it be empty)
        }}
      />
    </div>
  );
}
