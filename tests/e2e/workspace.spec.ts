import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
const origin = "http://127.0.0.1:3027";
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["cookies"]>>
>();
async function signIn(context: BrowserContext, id = "lin") {
  if (sessions.has(id)) await context.addCookies(sessions.get(id)!);
  else {
    const r = await context.request.post("/api/login", {
      headers: { origin },
      data: { id, password: "cospace-demo-2026" },
    });
    expect(r.ok()).toBe(true);
    sessions.set(id, await context.cookies());
  }
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("好想法");
  return page;
}
async function openNotes(page: Page) {
  await page.getByRole("button", { name: "团队随手记", exact: true }).click();
  await expect(page.getByText("协作已连接", { exact: true })).toBeVisible();
  return page.getByRole("textbox", { name: "协作文档编辑器" });
}
async function appendLine(editor: Locator, text: string) {
  await editor.click();
  await editor.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
  );
  await editor.press("ArrowRight");
  await editor.press("Enter");
  await editor.pressSequentially(text);
}
async function documentText(editor: Locator) {
  return editor.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(".collaboration-carets__caret")
      .forEach((n) => n.remove());
    return [...copy.children].map((p) => p.textContent).join("\n");
  });
}
test("chat propagates across identities and failed sends can be retried", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const marker = "[e2e:" + Date.now() + "] collaboration message";
  try {
    const p1 = await signIn(a),
      p2 = await signIn(b, "chen");
    await p1.route("**/api/messages", (route) => route.abort());
    await p1.getByRole("textbox", { name: "输入消息" }).fill(marker);
    await p1.getByRole("button", { name: "发送消息" }).click();
    await expect(p1.getByRole("button", { name: "重试发送" })).toBeVisible();
    await p1.unroute("**/api/messages");
    await p1.getByRole("button", { name: "重试发送" }).click();
    await expect(p2.getByText(marker, { exact: true })).toBeVisible();
    await expect(p1.getByRole("textbox", { name: "输入消息" })).toBeEmpty();
  } finally {
    await a.close();
    await b.close();
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
    });
    await db.query("DELETE FROM messages WHERE body=$1", [marker]);
    await db.end();
  }
});
test("two editors converge, survive offline edits and restore after reload", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  let p1: Page | undefined, p2: Page | undefined;
  const marker = "[e2e:" + Date.now() + "]";
  try {
    p1 = await signIn(a);
    p2 = await signIn(b, "chen");
    const e1 = await openNotes(p1),
      e2 = await openNotes(p2);
    await appendLine(e1, marker + " 林的想法");
    await expect(e2).toContainText(marker + " 林的想法");
    await a.setOffline(true);
    await appendLine(e1, marker + " 离线记录");
    await appendLine(e2, marker + " 陈的修改");
    await a.setOffline(false);
    await expect(e2).toContainText(marker + " 离线记录");
    await expect(e1).toContainText(marker + " 陈的修改");
    await expect
      .poll(async () => (await documentText(e1)) === (await documentText(e2)))
      .toBe(true);
    await p2.reload();
    const reloaded = await openNotes(p2);
    await expect(reloaded).toContainText(marker + " 离线记录");
    await expect(reloaded).toContainText(marker + " 陈的修改");
  } finally {
    await a.setOffline(false);
    await a.close();
    await b.close();
    // Remove only test-owned paragraph nodes using the real CRDT protocol.
    const { HocuspocusProvider } = await import("@hocuspocus/provider");
    const Y = await import("yjs");
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ id: "lin", password: "cospace-demo-2026" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const token = await (
      await fetch(origin + "/api/collab/token", {
        method: "POST",
        headers: { origin, cookie },
      })
    ).json();
    const doc = new Y.Doc();
    let provider: any;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("cleanup sync timeout")),
          10000,
        );
        provider = new HocuspocusProvider({
          url: "ws://127.0.0.1:4028",
          name: "notes",
          document: doc,
          token: token.token,
          onSynced: ({ state }) => {
            if (state) {
              clearTimeout(timer);
              resolve();
            }
          },
        });
      });
      doc.transact(() => {
        const root = doc.getXmlFragment("default");
        const clean = (node: any) => {
          if (typeof node.toDelta === "function") {
            for (const suffix of [" 林的想法", " 离线记录", " 陈的修改"]) {
              const text = node
                .toDelta()
                .map((p: any) => (typeof p.insert === "string" ? p.insert : ""))
                .join("");
              const index = text.indexOf(marker + suffix);
              if (index >= 0) node.delete(index, (marker + suffix).length);
            }
          } else if (typeof node.toArray === "function")
            node.toArray().forEach(clean);
        };
        for (let i = root.length - 1; i >= 0; i--) {
          const node = root.get(i);
          if (node.toString().includes(marker)) {
            clean(node);
            if (node.toString() === "<paragraph></paragraph>")
              root.delete(i, 1);
          }
        }
      });
      await expect.poll(() => provider.unsyncedChanges).toBe(0);
    } finally {
      provider?.destroy();
      doc.destroy();
    }
  }
});
test("task creation, keyboard edit and calendar scheduling share persisted data", async ({
  context,
}) => {
  const page = await signIn(context);
  const title = "[e2e:" + Date.now() + "] keyboard task";
  let taskId = "";
  try {
    await page.getByRole("button", { name: /^任务 \d+$/ }).click();
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page.getByRole("textbox", { name: "任务内容" }).fill(title);
    await page.getByRole("button", { name: "创建任务", exact: true }).click();
    const name = page.getByRole("textbox", {
      name: "任务名称 " + title,
      exact: true,
    });
    await expect(name).toBeVisible();
    await page
      .getByRole("combobox", { name: "任务状态 " + title, exact: true })
      .selectOption("doing");
    await page.getByRole("button", { name: "日历", exact: true }).click();
    await page.getByRole("button", { name: title + "安排时间 ↗" }).click();
    await page
      .getByRole("textbox", { name: "开始时间", exact: true })
      .fill("2026-11-18T09:00");
    await page
      .getByRole("textbox", { name: "结束时间", exact: true })
      .fill("2026-11-18T10:00");
    await page.getByRole("button", { name: "保存排期", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const workspace = await (
      await context.request.get("/api/workspace")
    ).json();
    const t = workspace.tasks.find((t: any) => t.title === title);
    taskId = t.id;
    expect(t.status).toBe("doing");
    expect(t.start_at).toBe("2026-11-18T01:00:00.000Z");
    const event = page.locator(".fc-timegrid-event").filter({ hasText: title });
    const box = await event.boundingBox();
    const slot = await page
      .locator(".fc-timegrid-slots tr")
      .first()
      .boundingBox();
    expect(box && slot).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2 + slot!.height * 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => {
        const w = await (await context.request.get("/api/workspace")).json();
        return w.tasks.find((t: any) => t.id === taskId).start_at;
      })
      .toBe("2026-11-18T02:00:00.000Z");
    await expect(page.getByText(/个任务存在同一成员的时间重叠/)).toBeVisible();
    await page.getByRole("button", { name: /^任务 \d+$/ }).click();
    await expect(
      page.getByRole("textbox", { name: "任务名称 " + title, exact: true }),
    ).toBeVisible();
  } finally {
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
    });
    await db.query("DELETE FROM tasks WHERE title=$1", [title]);
    await db.end();
  }
});
test("budget renders a formula workbook and saves a real snapshot", async ({
  context,
}) => {
  const page = await signIn(context);
  await page.getByRole("button", { name: "预算", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "发布预算", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await page.getByRole("button", { name: "保存预算", exact: true }).click();
  await expect(page.getByText(/已保存 \d/)).toBeVisible();
  const saved = await (await context.request.get("/api/budget")).json();
  const sheet = saved.snapshot.sheets["budget-sheet"];
  expect(sheet.cellData[1][3].f).toBe("=B2*C2");
  expect(sheet.cellData[5][3].f).toBe("=SUM(D2:D4)");
  expect(sheet.cellData[5][3].v).toBe(13360);
});
test("desktop chat and document controls pass WCAG A/AA automated checks", async ({
  context,
}) => {
  const page = await signIn(context);
  const chat = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(chat.violations).toEqual([]);
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await expect(page.getByText("协作已连接", { exact: true })).toBeVisible();
  const doc = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(doc.violations).toEqual([]);
});
test("mobile layout keeps navigation and read-only restrictions usable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: browser.browserType().name() !== "firefox",
    deviceScaleFactor: 1,
  });
  try {
    const page = await signIn(context, "guest");
    await expect(
      page.getByRole("textbox", { name: "输入消息" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "团队随手记", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "团队随手记", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "协作文档编辑器" }),
    ).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: /^任务 \d+$/ }).click();
    await expect(
      page.getByRole("button", { name: "新建任务", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("AI proposal review, confirmation and undo update the task view", async ({
  context,
}) => {
  const db = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
  });
  const id = crypto.randomUUID(),
    title = "[e2e:" + Date.now() + "] review action";
  await db.query(
    "INSERT INTO runs(id,user_id,mode,status,proposal,sources) VALUES($1,'lin','tasks','ready',$2,'[]')",
    [
      id,
      JSON.stringify({
        type: "create_tasks",
        tasks: [{ title, assignee: "lin" }],
      }),
    ],
  );
  try {
    const page = await signIn(context);
    await page.getByRole("button", { name: "AI 工作流", exact: true }).click();
    await page.getByRole("button", { name: "查看我的运行记录" }).click();
    await page.locator(".run-history button").first().click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(
      (await db.query("SELECT count(*) FROM tasks WHERE source=$1", [id]))
        .rows[0].count,
    ).toBe("0");
    await page.getByRole("button", { name: "确认应用", exact: true }).click();
    await expect(
      page.getByText("已应用到工作区", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "任务名称 " + title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "撤销本次修改", exact: true })
      .click();
    await expect(
      page.getByText("本次修改已撤销", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "任务名称 " + title, exact: true }),
    ).toHaveCount(0);
  } finally {
    await db.query("DELETE FROM tasks WHERE source=$1", [id]);
    await db.query("DELETE FROM runs WHERE id=$1", [id]);
    await db.end();
  }
});
test("search dialog contains keyboard focus and closes with Escape", async ({
  context,
}) => {
  const page = await signIn(context);
  await page.getByRole("button", { name: "搜索工作区 ⌘ K" }).click();
  const dialog = page.getByRole("dialog", { name: "搜索工作区" });
  await expect(dialog).toBeVisible();
  await page.getByRole("textbox", { name: "搜索内容" }).fill("不存在的内容");
  await page.getByRole("button", { name: "关闭搜索" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "搜索内容" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
