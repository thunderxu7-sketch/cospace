"use client";
import { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import { Save, Download, RefreshCw, Sheet } from "lucide-react";
import { api } from "@/lib/api";
const initial = {
  id: "budget",
  name: "发布预算",
  locale: LocaleType.ZH_CN,
  sheetOrder: ["budget-sheet"],
  styles: {
    header: { bg: { rgb: "#EAF2ED" }, bl: 1 },
    currency: { n: { pattern: "¥#,##0.00" } },
  },
  sheets: {
    "budget-sheet": {
      id: "budget-sheet",
      name: "发布预算",
      rowCount: 100,
      columnCount: 15,
      defaultColumnWidth: 115,
      defaultRowHeight: 30,
      columnData: { 0: { w: 220 } },
      cellData: {
        0: {
          0: { v: "工作事项", s: "header" },
          1: { v: "工时", s: "header" },
          2: { v: "每小时成本", s: "header" },
          3: { v: "小计", s: "header" },
        },
        1: {
          0: { v: "交互与视觉设计" },
          1: { v: 16 },
          2: { v: 200, s: "currency" },
          3: { f: "=B2*C2", s: "currency" },
        },
        2: {
          0: { v: "协作与工作流开发" },
          1: { v: 32 },
          2: { v: 250, s: "currency" },
          3: { f: "=B3*C3", s: "currency" },
        },
        3: {
          0: { v: "验证与体验走查" },
          1: { v: 12 },
          2: { v: 180, s: "currency" },
          3: { f: "=B4*C4", s: "currency" },
        },
        5: {
          0: { v: "预算合计", s: "header" },
          1: { f: "=SUM(B2:B4)" },
          3: { f: "=SUM(D2:D4)", s: "currency" },
        },
      },
    },
  },
};
export default function Budget({ readonly }: { readonly: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const workbook = useRef<any>(null);
  const formula = useRef<ReturnType<
    ReturnType<typeof createUniver>["univerAPI"]["getFormula"]
  > | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stop = false;
    let dispose: (() => void) | undefined;
    api("/budget")
      .then(async (data) => {
        if (stop || !container.current) return;
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.ZH_CN,
          locales: { [LocaleType.ZH_CN]: zhCN },
          presets: [UniverSheetsCorePreset({ container: container.current })],
        });
        workbook.current = univerAPI.createWorkbook(data.snapshot || initial);
        workbook.current.setEditable(!readonly);
        dispose = () => univer.dispose();
        formula.current = univerAPI.getFormula();
        await formula.current.onCalculationResultApplied(15000);
        if (!stop) setVersion(data.version);
      })
      .catch((e) => setError(e.message));
    return () => {
      stop = true;
      dispose?.();
      workbook.current = null;
      formula.current = null;
    };
  }, [readonly, reload]);
  return (
    <section className="budget-view">
      <div className="section-toolbar">
        <div>
          <Sheet size={17} />
          <strong>发布预算</strong>
          <span className="muted">公式与费用估算</span>
        </div>
        <div>
          <button
            className="text-button"
            disabled={!version}
            onClick={() => {
              const blob = new Blob(
                [JSON.stringify(workbook.current.save(), null, 2)],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "CoSpace-预算副本.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={14} />
            导出副本
          </button>
          <button
            className="icon-button"
            aria-label="重新加载预算"
            onClick={() => {
              if (
                window.confirm("重新加载将丢弃尚未保存的本地修改，是否继续？")
              ) {
                setError("");
                setSaved("");
                setReload((n) => n + 1);
              }
            }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="primary"
            disabled={readonly || busy || !version}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await formula.current?.onCalculationResultApplied(15000);
                const result = await api("/budget", {
                  method: "PUT",
                  body: JSON.stringify({
                    version,
                    snapshot: workbook.current.save(),
                  }),
                });
                setVersion(result.version);
                setSaved("已保存 " + new Date().toLocaleTimeString("zh-CN"));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save size={14} />
            {busy ? "保存中…" : "保存预算"}
          </button>
        </div>
      </div>
      <div className="budget-note">
        支持公式、区域选择与复制粘贴。
        {readonly
          ? "当前为只读模式。"
          : "修改后点击保存；其他成员已保存新版本时会提示冲突。"}
        <span>{saved || "当前版本 " + (version || "…")}</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="univer-container" ref={container} />
    </section>
  );
}
