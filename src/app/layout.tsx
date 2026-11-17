import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CoSpace · 团队协作工作台",
  description: "从讨论到行动，在同一个空间共同完成。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
