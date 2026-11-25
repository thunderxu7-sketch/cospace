"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

export type EmailLink = { purpose: "invite" | "login"; token: string };

export function emailLinkFromLocation(): EmailLink | null {
  const values = new URLSearchParams(window.location.hash.slice(1));
  for (const purpose of ["invite", "login"] as const) {
    const token = values.get(purpose);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return { purpose, token };
  }
  return null;
}

export default function PilotAccess({ link }: { link: EmailLink | null }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (link) {
        const name = String(fields.get("name") || "").trim();
        await api("/auth/redeem", {
          method: "POST",
          body: JSON.stringify({ ...link, ...(name ? { name } : {}) }),
        });
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        window.location.reload();
      } else {
        await api("/auth/login-link", {
          method: "POST",
          body: JSON.stringify({ email: fields.get("email") }),
        });
        setNotice("如果该邮箱已加入 CoSpace，请查收登录链接。");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "暂时无法操作，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const invitation = link?.purpose === "invite";
  return (
    <div className="login-shell">
      <form className="login-card pilot-form" onSubmit={submit}>
        <h1>{invitation ? "加入 CoSpace 工作区" : "登录 CoSpace"}</h1>
        {!link && (
          <label>
            邮箱
            <input
              name="email"
              type="email"
              maxLength={254}
              required
              autoComplete="email"
            />
          </label>
        )}
        {invitation && (
          <label>
            显示名称
            <input name="name" maxLength={80} autoComplete="name" />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {invitation ? "确认加入" : link ? "确认登录" : "发送登录链接"}
        </button>
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {link && <a href="/">返回登录</a>}
      </form>
    </div>
  );
}
