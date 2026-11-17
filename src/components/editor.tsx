"use client";
import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TableKit } from "@tiptap/extension-table";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Sparkles,
  FileText,
  Table2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Member, DocContext } from "@/lib/types";

export default function DocumentEditor(props: {
  id: string;
  title: string;
  user: Member;
  onAi: (context: DocContext) => void;
}) {
  const [resource, setResource] = useState<{
    doc: Y.Doc;
    provider: HocuspocusProvider;
    cache: IndexeddbPersistence;
  } | null>(null);
  const [status, setStatus] = useState("正在连接");
  useEffect(() => {
    const doc = new Y.Doc();
    const cache = new IndexeddbPersistence(
      "cospace-" + props.user.id + "-" + props.id,
      doc,
    );
    const provider = new HocuspocusProvider({
      url: `ws://${window.location.hostname}:4028`,
      name: props.id,
      document: doc,
      token: async () => (await api("/collab/token", { method: "POST" })).token,
      onStatus: ({ status }) =>
        setStatus(
          status === "connected"
            ? "协作已连接"
            : status === "connecting"
              ? "正在重连"
              : "离线 · 更改保存在本机",
        ),
      onAuthenticationFailed: () => setStatus("协作授权失败，请重新登录"),
    });
    setResource({ doc, provider, cache });
    return () => {
      provider.destroy();
      void cache.destroy();
      doc.destroy();
    };
  }, [props.id, props.user.id]);
  if (!resource) return <div className="loading">正在打开文档…</div>;
  return <EditorBody {...props} {...resource} status={status} />;
}
function EditorBody({
  id,
  title,
  user,
  onAi,
  doc,
  provider,
  status,
}: {
  id: string;
  title: string;
  user: Member;
  onAi: (context: DocContext) => void;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  status: string;
}) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(provider.synced);
  const [, redraw] = useState(0);
  useEffect(() => {
    const sync = () => setReady(true);
    provider.on("synced", sync);
    return () => {
      provider.off("synced", sync);
    };
  }, [provider]);
  const editor = useEditor({
    immediatelyRender: false,
    editable: user.role === "editor",
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      TableKit.configure({ table: { resizable: true } }),
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({
        provider,
        user: { name: user.name, color: user.color },
      }),
    ],
    editorProps: {
      attributes: {
        class: "document-editor",
        "aria-label": "协作文档编辑器",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onSelectionUpdate: () => redraw((n) => n + 1),
    onTransaction: () => redraw((n) => n + 1),
  });
  async function ai(rewrite = false) {
    if (!editor) return;
    try {
      const context = await api<DocContext>("/documents/" + id + "/context");
      if (rewrite) {
        const index = editor.state.selection.$from.index(0);
        const block = editor.state.doc.child(index);
        if (block.type.name !== "paragraph") {
          setError("请把光标放在需要改写的普通段落中。");
          return;
        }
        context.blockIndex = index;
        context.selectedText = block.textContent;
      }
      onAi(context);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const buttons = [
    {
      label: "加粗",
      Icon: Bold,
      active: editor?.isActive("bold"),
      action: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      Icon: Italic,
      active: editor?.isActive("italic"),
      action: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "二级标题",
      Icon: Heading2,
      active: editor?.isActive("heading"),
      action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "无序列表",
      Icon: List,
      active: editor?.isActive("bulletList"),
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      Icon: ListOrdered,
      active: editor?.isActive("orderedList"),
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "插入表格",
      Icon: Table2,
      action: () =>
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      label: "撤销",
      Icon: Undo2,
      action: () => editor?.chain().focus().undo().run(),
    },
    {
      label: "重做",
      Icon: Redo2,
      action: () => editor?.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="document-view">
      <div className="section-toolbar">
        <div>
          <FileText size={17} />
          <strong>{title}</strong>
          <span className="document-sync">
            <i />
            {status}
          </span>
        </div>
        <button
          className="text-button"
          disabled={user.role === "viewer" || !ready}
          onClick={() => ai()}
        >
          <Sparkles size={14} />
          提取行动项
        </button>
      </div>
      <div className="editor-toolbar" role="toolbar" aria-label="文档格式">
        {buttons.map(({ label, Icon, action, active }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            className={"icon-button " + (active ? "active" : "")}
            onClick={action}
            disabled={user.role === "viewer" || !ready}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          className="text-button"
          disabled={user.role === "viewer" || !ready}
          onClick={() => ai(true)}
        >
          <Sparkles size={14} />
          改写当前段落
        </button>
        <span className="toolbar-note">更改自动同步</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="document-scroll">
        <div className="document-paper">
          <div className="document-eyebrow">
            PROJECT DOCUMENT <span>共享文档</span>
          </div>
          <h2>{title}</h2>
          <div className="doc-byline">
            团队共同维护 <span>·</span> 支持同时编辑与本地离线恢复
          </div>
          {!ready && <div className="doc-loading">正在同步最新版本…</div>}
          <EditorContent editor={editor} />
          <div className="document-end">— 留下清晰的下一步 —</div>
        </div>
      </div>
    </div>
  );
}
