import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const origin = process.env.COSPACE_PILOT_TEST_ORIGIN!;
const mailOrigin = process.env.COSPACE_PILOT_TEST_MAIL_ORIGIN!;
const https = new URL(origin).protocol === "https:";
const owner = "owner@example.test";
const member = "member@example.test";

async function mailLink(inbox: string) {
  const response = await fetch(
    mailOrigin + "/test/mail/" + encodeURIComponent(inbox),
  );
  expect(response.ok).toBe(true);
  const link = (await response.text()).match(
    /https?:\/\/[^\s]+#(?:invite|login)=[A-Za-z0-9_-]+/,
  )?.[0];
  expect(link).toBeDefined();
  return link!;
}
async function join(page: Page, link: string, name: string) {
  await page.goto(link);
  await page.getByLabel("显示名称").fill(name);
  await page.getByRole("button", { name: "确认加入" }).click();
}
async function write(
  api: APIRequestContext,
  path: string,
  data?: unknown,
  method = "POST",
) {
  return api.fetch(origin + "/api" + path, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
}
async function workspace(page: Page) {
  const response = await page.request.get(origin + "/api/workspace");
  expect(response.ok()).toBe(true);
  return response.json();
}
async function createDoc(page: Page, title: string) {
  await page.getByRole("button", { name: "新建文档" }).click();
  await page.getByLabel("文档名称").fill(title);
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  return (await workspace(page)).documents.find(
    (doc: { title: string }) => doc.title === title,
  ).id as string;
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "提取行动项", exact: true }).click();
  await page.getByRole("button", { name: "生成提取行动项" }).click();
  await expect(
    page.getByRole("textbox", { name: "行动项名称 1", exact: true }),
  ).toBeVisible({ timeout: 120_000 });
}
async function invite(page: Page, role = "editor") {
  await page.getByRole("button", { name: "成员", exact: true }).click();
  await page.getByLabel("邀请邮箱").fill(member);
  await page.getByLabel("角色", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "发送邀请" }).click();
  await expect(page.getByText("邀请邮件已发出。")).toBeVisible();
  return mailLink(member);
}

test("two email accounts and workspaces complete the reviewed action-item flow", async ({
  browser,
}) => {
  const contextOptions = { ignoreHTTPSErrors: https };
  const alphaOwner = await browser.newContext(contextOptions);
  const alphaEditor = await browser.newContext(contextOptions);
  const a = await alphaOwner.newPage();
  const b = await alphaEditor.newPage();
  const connections = new Set<string>();
  a.on("websocket", (socket) => connections.add(socket.url()));

  if (https) {
    const ready = await a.request.get(origin + "/api/ready");
    expect(ready.ok()).toBe(true);
    expect(ready.headers()["x-content-type-options"]).toBe("nosniff");
  }

  const betaLink = await mailLink(owner);
  await join(a, await mailLink("alpha-owner"), "林试用");
  await expect(
    a.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  const alpha = await workspace(a);
  expect(await alphaOwner.cookies(origin)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "cs_session",
        httpOnly: true,
        sameSite: "Strict",
        secure: https,
      }),
    ]),
  );
  expect(alpha.members).toHaveLength(1);
  expect(alpha.documents).toHaveLength(0);
  expect(alpha.user.role).toBe("owner");

  const revoked = await invite(a);
  await a.getByRole("button", { name: `撤销 ${member} 的邀请` }).click();
  await join(b, revoked, "陈试用");
  await expect(b.getByText("此链接无效、已使用或已过期。")).toBeVisible();
  const memberLink = await invite(a);
  await join(b, memberLink, "陈试用");
  await expect(
    b.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  const editorId = (await workspace(b)).user.id as string;
  expect(
    (await write(b.request, "/invitations", { email: owner })).status(),
  ).toBe(403);
  await join(b, memberLink, "陈试用");
  await expect(b.getByText("此链接无效、已使用或已过期。")).toBeVisible();
  await b.goto(origin);

  await a.getByRole("button", { name: "文档", exact: true }).click();
  const alphaDoc = await createDoc(a, "Alpha 会议纪要");
  await expect(
    b.getByRole("heading", { name: "Alpha 会议纪要" }),
  ).toBeVisible();
  const aEditor = a.getByRole("textbox", { name: "协作文档编辑器" });
  const bEditor = b.getByRole("textbox", { name: "协作文档编辑器" });
  await aEditor.fill("陈试用负责更新上线方案。");
  await expect(bEditor).toContainText("更新上线方案");
  await bEditor.fill("陈试用负责更新上线方案。会议结束后记录验收结果。");
  await expect(aEditor).toContainText("记录验收结果");
  if (https) {
    const secureSockets = origin.replace(/^https:/, "wss:");
    expect(connections.has(secureSockets + "/ws/events")).toBe(true);
    expect(connections.has(secureSockets + "/ws/collab")).toBe(true);
  }
  await expect(a.getByText("已保存", { exact: true })).toBeVisible();
  await a.reload();
  await expect(aEditor).toContainText("记录验收结果");

  await generate(a);
  expect((await workspace(a)).tasks).toHaveLength(0);
  await bEditor.fill(
    "陈试用负责更新上线方案。会议结束后记录验收结果。复核范围已更新。",
  );
  await expect(aEditor).toContainText("复核范围已更新");
  await expect(b.getByText("已保存", { exact: true })).toBeVisible();
  await a.getByRole("button", { name: "确认应用" }).click();
  await expect(a.getByText("来源文档已变更，请重新提取行动项。")).toBeVisible();
  expect((await workspace(a)).tasks).toHaveLength(0);
  await a.getByRole("button", { name: "关闭 AI 工作流" }).click();

  await generate(a);
  await a
    .getByRole("textbox", { name: "行动项名称 1", exact: true })
    .fill("人工确认的上线任务");
  await a.getByLabel("行动项负责人 1").selectOption(editorId);
  for (const checkbox of await a
    .getByRole("checkbox", { name: /^采用第 / })
    .all()
    .then((items) => items.slice(1))) {
    await checkbox.uncheck();
  }
  await b.getByRole("button", { name: "任务", exact: true }).click();
  const confirm = a.waitForResponse((response) =>
    /\/runs\/[^/]+\/apply$/.test(response.url()),
  );
  await a.getByRole("button", { name: "确认应用" }).click();
  const confirmation = await confirm;
  expect(confirmation.ok()).toBe(true);
  const receipt = await confirmation.json();
  expect(receipt.result.taskIds).toHaveLength(1);
  const run = new URL(confirmation.url()).pathname
    .replace(/^\/api/, "")
    .replace(/\/apply$/, "");
  const taskId = receipt.result.taskIds[0];
  await expect(
    b.getByRole("textbox", { name: "任务名称 人工确认的上线任务" }),
  ).toBeVisible();
  const replay = await write(a.request, run + "/apply", { tasks: [] });
  expect(await replay.json()).toEqual(receipt);
  expect((await workspace(a)).tasks).toHaveLength(1);

  const staleTab = await alphaOwner.newPage();
  await staleTab.goto(origin);
  await expect(
    staleTab.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await staleTab.getByRole("button", { name: "新建文档" }).click();
  await staleTab.getByLabel("文档名称").fill("Alpha 未保存的文档");
  // Keep the old screen while the shared browser session switches workspaces.
  await staleTab.route("**/api/workspace", () => {});

  await join(a, betaLink, "林试用");
  await expect(
    a.getByRole("heading", { name: "Beta", exact: true }),
  ).toBeVisible();
  const beta = await workspace(a);
  expect(beta.workspace.id).not.toBe(alpha.workspace.id);
  await staleTab.getByRole("button", { name: "保存名称" }).click();
  await expect(
    staleTab.getByText("当前工作区已切换，请刷新页面后重试。", { exact: true }),
  ).toBeVisible();
  await staleTab.close();
  expect(beta.tasks).toHaveLength(0);
  expect((await workspace(a)).documents).toHaveLength(0);
  const betaDoc = await createDoc(a, "Beta 私有纪要");
  for (const path of [
    "/documents/" + alphaDoc + "/context",
    "/tasks/" + taskId,
    run,
  ]) {
    expect((await a.request.get(origin + "/api" + path)).status()).toBe(404);
  }
  expect((await write(a.request, run + "/apply", { tasks: [] })).status()).toBe(
    404,
  );
  expect(
    (
      await b.request.get(origin + "/api/documents/" + betaDoc + "/context")
    ).status(),
  ).toBe(404);
  expect(
    (await write(b.request, "/collab/token", { documentId: betaDoc })).status(),
  ).toBe(404);
  expect(
    (
      await write(b.request, "/workspaces/" + beta.workspace.id + "/switch")
    ).status(),
  ).toBe(404);
  expect(
    (
      await write(a.request, "/tasks", {
        title: "跨域验证",
        assignee: editorId,
        clientId: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(400);

  await a.getByLabel("切换工作区").selectOption(alpha.workspace.id);
  await expect(
    a.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await b.getByRole("button", { name: "文档", exact: true }).click();
  await expect(b.getByText("已保存", { exact: true })).toBeVisible();
  await a.getByRole("button", { name: "成员", exact: true }).click();
  await a.getByRole("button", { name: "移除 陈试用" }).click();
  await expect(a.getByText("成员已移除。")).toBeVisible();
  await expect(
    b.getByRole("heading", { name: "登录 CoSpace", exact: true }),
  ).toBeVisible();
  expect((await b.request.get(origin + "/api/workspace")).status()).toBe(401);

  await join(b, await invite(a, "viewer"), "陈试用");
  await expect(
    b.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  expect((await workspace(b)).user.role).toBe("viewer");
  expect(
    (await write(b.request, "/documents", { title: "只读成员创建" })).status(),
  ).toBe(403);
  await b.getByRole("button", { name: "退出登录" }).click();
  await b.getByRole("textbox", { name: "邮箱" }).fill(member);
  await b.getByRole("button", { name: "发送登录链接" }).click();
  await expect(b.getByRole("status")).toContainText("查收登录链接");
  await b.goto(await mailLink(member));
  await b.getByRole("button", { name: "确认登录" }).click();
  await expect(
    b.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();

  await alphaOwner.close();
  await alphaEditor.close();
});
