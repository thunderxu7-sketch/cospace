"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { MobilePairing as Pairing } from "@cospace/contracts";

function secondsUntil(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

export default function MobilePairing({ name }: { name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [pairing, setPairing] = useState<Pairing>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(
      () => setSeconds(secondsUntil(pairing.expiresAt)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function issueCode() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setPairing(undefined);
    setError("");
    try {
      const result = await api<Pairing>("/mobile/pairings", {
        method: "POST",
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setSeconds(secondsUntil(result.expiresAt));
        setPairing(result);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 429)
        setError("生成配对码太频繁，请稍后重试。");
      else
        setError(cause instanceof Error ? cause.message : "暂时无法生成配对码");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="device-button"
        aria-label="连接手机"
        onClick={() => {
          dialog.current?.showModal();
          void issueCode();
        }}
      >
        <Smartphone size={15} aria-hidden="true" />
        <span>连接手机</span>
      </button>
      <dialog
        ref={dialog}
        className="pairing-dialog"
        aria-labelledby="pairing-title"
        aria-describedby="pairing-instructions"
        onClose={() => {
          request.current?.abort();
          setPairing(undefined);
          setError("");
          setPending(false);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" ||
            ((event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "k")
          )
            event.stopPropagation();
        }}
      >
        <div className="pairing-heading">
          <h2 id="pairing-title">连接手机</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭手机配对"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p id="pairing-instructions">
          打开手机上的 CoSpace，输入配对码，以 <strong>{name}</strong>{" "}
          的身份连接。
        </p>
        {pending && <p role="status">正在生成配对码…</p>}
        {error && <p role="alert">{error}</p>}
        {pairing && seconds > 0 && (
          <div className="pairing-code-block">
            <code data-testid="mobile-pairing-code">{pairing.code}</code>
            <small>
              仅可使用一次 · {Math.floor(seconds / 60)} 分{" "}
              {String(seconds % 60).padStart(2, "0")} 秒后过期
            </small>
          </div>
        )}
        {pairing && seconds === 0 && <p role="status">配对码已过期</p>}
        {!pending && (error || (pairing && seconds === 0)) && (
          <button
            type="button"
            className="primary"
            onClick={() => void issueCode()}
          >
            重新生成
          </button>
        )}
      </dialog>
    </>
  );
}
