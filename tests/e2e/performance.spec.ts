import { test, expect } from "@playwright/test";
import pg from "pg";
// A bounded rendering regression check, not a benchmark or a claim about concurrent users.
test("10000 real database tasks render a bounded number of rows and filter in Chinese", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const db = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
  });
  const prefix = "[perf:" + Date.now() + "]";
  try {
    await db.query(
      "INSERT INTO tasks(id,title,assignee) SELECT gen_random_uuid(),$1||' performance task '||n,'chen' FROM generate_series(1,10000) n",
      [prefix],
    );
    await context.request.post("/api/login", {
      headers: { origin: "http://127.0.0.1:3027" },
      data: { id: "lin", password: "cospace-demo-2026" },
    });
    const started = Date.now();
    await page.goto("/");
    await page.getByRole("button", { name: /^任务 \d+$/ }).click();
    const table = page.getByRole("table", { name: "任务表格" });
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    expect(Number(await table.getAttribute("aria-rowcount"))).toBeGreaterThan(
      10000,
    );
    const rendered = await table.getByRole("row").count();
    expect(rendered).toBeLessThan(50);
    const readyMs = Date.now() - started;
    await page
      .getByRole("textbox", { name: "筛选任务" })
      .fill(prefix + " performance task 9999");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(
      page.getByRole("textbox", {
        name: "任务名称 " + prefix + " performance task 9999",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "筛选任务" }).fill("陈屿");
    await expect
      .poll(async () => Number(await table.getAttribute("aria-rowcount")))
      .toBeGreaterThan(10000);
    console.log(
      JSON.stringify({
        databaseRows: 10000,
        renderedRows: rendered,
        readyMs,
        environment: "current local server; illustrative single run",
      }),
    );
  } finally {
    await db.query("DELETE FROM tasks WHERE title LIKE $1", [prefix + "%"]);
    await db.end();
  }
});
