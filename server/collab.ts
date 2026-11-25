import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { sql } from "./db";
import { digest, textFromXml } from "./domain";
import type { Operation } from "../src/lib/types";
import { appOrigin, collabPort, demoWorkspace, pilot } from "./config";
import { fail } from "./session";

function paragraph(text: string) {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}
const initial = [
  "CoSpace 1.0 发布方案",
  "让讨论自然变成下一步行动。",
  "本轮目标",
  "团队可以在同一个空间讨论、共同编辑方案，并把行动项安排到日历。",
  "交付范围",
  "协作文档与多人光标；流式 AI 修改预览；任务表格与日历联动。",
  "验收重点",
  "验证同时编辑、断线恢复、过期修改提示，以及移动端和键盘操作。",
];
export const collab = new Server({
  port: collabPort,
  address: "127.0.0.1",
  quiet: true,
  debounce: 150,
  maxDebounce: 1000,
  websocketOptions: { maxPayload: 2 * 1024 * 1024 },
  async onAuthenticate({
    token,
    documentName,
    connectionConfig,
    requestHeaders,
  }) {
    const origin = requestHeaders.get("origin");
    if ((pilot || origin) && origin !== appOrigin)
      throw new Error("Origin rejected");
    const [ticket] = await sql(
      `SELECT u.id,u.name,m.role,t.workspace_id,t.session_hash
       FROM tickets t JOIN users u ON u.id=t.user_id
       JOIN workspace_members m ON m.user_id=t.user_id AND m.workspace_id=t.workspace_id
       JOIN documents d ON d.id=$2 AND d.workspace_id=t.workspace_id
       WHERE t.token=$1 AND t.expires_at>now() AND m.revoked_at IS NULL
         AND ((t.workspace_id <> $3) = $4)
         AND (NOT $4 OR (t.document_id=d.id AND EXISTS (
           SELECT 1 FROM sessions s WHERE s.token=t.session_hash AND s.user_id=t.user_id
             AND s.workspace_id=t.workspace_id AND s.expires_at>now()
         )))`,
      [digest(token), documentName, demoWorkspace, pilot],
    );
    if (!ticket) throw new Error("Unauthorized");
    connectionConfig.readOnly = ticket.role === "viewer";
    return { identity: ticket };
  },
  async beforeHandleMessage({ context }) {
    if (pilot && !(await activeCollabSession(context.identity)))
      throw new Error("Session expired");
  },
  async onLoadDocument({ document, documentName }) {
    const [row] = await sql("SELECT state FROM documents WHERE id=$1", [
      documentName,
    ]);
    if (!row) throw new Error("Document not found");
    if (row.state) Y.applyUpdate(document, new Uint8Array(row.state));
    else if (!pilot) {
      const root = document.getXmlFragment("default");
      document.transact(() =>
        root.insert(
          0,
          (documentName === "launch"
            ? initial
            : ["团队随手记", "记录灵感、问题和待讨论事项。"]
          ).map(paragraph),
        ),
      );
      await sql("UPDATE documents SET state=$2 WHERE id=$1", [
        documentName,
        Buffer.from(Y.encodeStateAsUpdate(document)),
      ]);
    }
  },
  async onStoreDocument({ document, documentName }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    const [saved] = await sql(
      `UPDATE documents SET state=$2,updated_at=now(),
         revision=revision+CASE WHEN state IS DISTINCT FROM $2 THEN 1 ELSE 0 END
       WHERE id=$1 RETURNING revision`,
      [documentName, state],
    );
    if (pilot && saved)
      document.broadcastStateless(
        JSON.stringify({ savedHash: digest(state), revision: saved.revision }),
      );
  },
});

type CollabIdentity = {
  id: string;
  workspace_id: string;
  session_hash: string;
};

async function activeCollabSession(identity?: CollabIdentity) {
  if (!identity) return false;
  const [active] = await sql(
    `SELECT 1 FROM sessions s JOIN workspace_members m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id
     WHERE s.token=$1 AND s.user_id=$2 AND s.workspace_id=$3 AND s.expires_at>now() AND m.revoked_at IS NULL`,
    [identity.session_hash, identity.id, identity.workspace_id],
  );
  return !!active;
}

export function closeDocumentConnections(workspaceId: string, userId: string) {
  for (const document of collab.hocuspocus.documents.values()) {
    for (const connection of document.getConnections()) {
      const identity: CollabIdentity | undefined = connection.context.identity;
      if (identity?.workspace_id === workspaceId && identity.id === userId)
        connection.close();
    }
  }
}

export async function recheckDocumentConnections() {
  for (const document of collab.hocuspocus.documents.values()) {
    for (const connection of document.getConnections()) {
      if (
        !(await activeCollabSession(connection.context.identity).catch(
          () => false,
        ))
      )
        connection.close();
    }
  }
}

export async function readSavedDoc(workspaceId: string, id: string) {
  const [row] = await sql(
    "SELECT state,revision FROM documents WHERE id=$1 AND workspace_id=$2",
    [id, workspaceId],
  );
  if (!row) fail("文档不存在", 404);
  const doc = new Y.Doc();
  try {
    if (row.state) Y.applyUpdate(doc, new Uint8Array(row.state));
    const root = doc.getXmlFragment("default");
    return {
      text: textFromXml(root),
      blocks: root.toArray().map(textFromXml),
      hash: digest(root.toString()),
      savedHash: digest(row.state ?? Y.encodeStateAsUpdate(doc)),
      revision: Number(row.revision),
    };
  } finally {
    doc.destroy();
  }
}
export async function readDoc(id = "launch") {
  if (!["launch", "notes"].includes(id)) throw new Error("Document not found");
  const direct = await collab.hocuspocus.openDirectConnection(id);
  try {
    const text = textFromXml(direct.document!.getXmlFragment("default"));
    return {
      text,
      blocks: direct
        .document!.getXmlFragment("default")
        .toArray()
        .map(textFromXml),
      hash: digest(direct.document!.getXmlFragment("default").toString()),
    };
  } finally {
    await direct.disconnect();
  }
}
type XmlSnapshot = {
  text?: ReturnType<Y.XmlText["toDelta"]>;
  name?: string;
  attrs?: Record<string, string | undefined>;
  children?: XmlSnapshot[];
};
function snapshot(node: Y.XmlElement | Y.XmlText): XmlSnapshot {
  return node instanceof Y.XmlText
    ? { text: node.toDelta() }
    : {
        name: node.nodeName,
        attrs: node.getAttributes(),
        children: node
          .toArray()
          .map((n) => snapshot(n as Y.XmlElement | Y.XmlText)),
      };
}
function restore(node: XmlSnapshot): Y.XmlElement | Y.XmlText {
  if (node.text) {
    const text = new Y.XmlText();
    text.applyDelta(node.text);
    return text;
  }
  const el = new Y.XmlElement(node.name!);
  for (const [key, value] of Object.entries(node.attrs || {})) {
    if (value !== undefined) el.setAttribute(key, value);
  }
  el.insert(0, (node.children || []).map(restore));
  return el;
}
type Receipt = {
  documentId: string;
  start: number;
  count: number;
  before: XmlSnapshot[];
  afterHash: string;
  status: "applied" | "undone";
};
export async function applyDocument(op: Operation, runId: string) {
  const direct = await collab.hocuspocus.openDirectConnection(op.documentId!);
  let result: Receipt | undefined;
  try {
    await direct.transact((doc) => {
      const receipts = doc.getMap<Receipt>("operations");
      const previous = receipts.get(runId);
      if (previous) {
        if (previous.status === "undone")
          throw Object.assign(new Error("该操作已撤销"), { statusCode: 409 });
        result = previous;
        return;
      }
      const root = doc.getXmlFragment("default");
      if (digest(root.toString()) !== op.baseHash)
        throw Object.assign(new Error("文档已经被修改，请重新生成建议。"), {
          statusCode: 409,
        });
      const before: XmlSnapshot[] = [];
      let start = root.length;
      let count = 0;
      if (op.type === "replace_paragraph") {
        start = op.blockIndex!;
        if (
          !Number.isInteger(start) ||
          start < 0 ||
          start >= root.length ||
          (root.get(start) as Y.XmlElement).nodeName !== "paragraph"
        )
          throw Object.assign(new Error("请选择一个普通段落后重试。"), {
            statusCode: 409,
          });
        before.push(snapshot(root.get(start) as Y.XmlElement));
        root.delete(start, 1);
        root.insert(start, [paragraph(op.text!)]);
        count = 1;
      } else {
        const nodes = op.text!.split("\n").filter(Boolean).map(paragraph);
        root.insert(start, nodes);
        count = nodes.length;
      }
      result = {
        documentId: op.documentId!,
        start,
        count,
        before,
        afterHash: digest(root.toString()),
        status: "applied",
      };
      // Persist the receipt in the same CRDT transaction as the document change.
      // A retry after a database transaction failure therefore cannot append twice.
      receipts.set(runId, result);
    });
    return result!;
  } finally {
    await direct.disconnect();
  }
}
export async function undoDocument(documentId: string, runId: string) {
  const direct = await collab.hocuspocus.openDirectConnection(documentId);
  try {
    await direct.transact((doc) => {
      const receipts = doc.getMap<Receipt>("operations");
      const receipt = receipts.get(runId);
      if (!receipt)
        throw Object.assign(new Error("未找到可撤销的文档操作"), {
          statusCode: 409,
        });
      if (receipt.status === "undone") return;
      const root = doc.getXmlFragment("default");
      if (digest(root.toString()) !== receipt.afterHash)
        throw Object.assign(
          new Error("文档有后续修改，为保护其他人的内容，请手动调整。"),
          { statusCode: 409 },
        );
      root.delete(receipt.start, receipt.count);
      root.insert(receipt.start, receipt.before.map(restore));
      receipts.set(runId, { ...receipt, status: "undone" });
    });
  } finally {
    await direct.disconnect();
  }
}
