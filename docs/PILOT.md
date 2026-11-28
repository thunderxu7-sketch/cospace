# CoSpace 邀请制 Web 试用

试用流程从邮箱邀请进入工作区。编辑者可以创建文档并共同编辑，等文档显示「已保存」后提取行动项，在原文旁核对、修订和勾选，确认后从任务列表查看。只读成员可以查看文档和任务。管理员可以撤销待接受邀请和移除成员。

## 部署与首个工作区

1. 准备独立的 PostgreSQL 数据库、HTTPS 域名、Ollama 模型服务和 Resend 已验证发件地址。试用版会把选中的文档快照发送给配置的模型服务。联调使用合成材料，使用团队材料前确认模型端点和数据留存方式。
2. 按 [环境变量示例](../.env.example) 设置 `COSPACE_MODE=pilot`、`DATABASE_URL`、`APP_ORIGIN`、`COSPACE_EMAIL_FROM`、`COSPACE_EMAIL_API_KEY`、`OLLAMA_URL` 和 `OLLAMA_MODEL`。Web、API、协作服务在同一主机的回环地址监听。使用 [Caddy 模板](../deploy/Caddyfile.example) 把 HTTPS、API 和两条 WebSocket 路由接到同一域名。在 Caddy 的环境中把 `COSPACE_PUBLIC_HOST` 设为 `APP_ORIGIN` 的主机名。自定义服务端口时，将相同的 `COSPACE_WEB_PORT`、`COSPACE_API_PORT` 和 `COSPACE_COLLAB_PORT` 提供给 Caddy 与应用。
3. 同一套环境配置用于迁移、构建、启动和引导。应用启动会检查迁移版本。按单实例部署 Fastify 和协作服务。

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

4. 在另一个终端创建工作区并发送管理员邀请。重复执行会为尚未领取的同名工作区重新发送邀请。

```bash
npm run pilot:bootstrap -- "试用团队" admin@example.com
```

管理员点击邮件中的链接并确认加入，然后在「成员」页邀请其他人。邮件邀请有效 48 小时，登录链接有效 15 分钟，网页会话有效 24 小时。邮箱链接绑定收件人的身份，请直接发给该成员。

生产入口用 `/api/health` 检查应用响应，用 `/api/ready` 检查数据库连通性。邀请外部团队前，在目标域名核对实际收件、Cookie Secure 属性、两条 WSS、模型流式生成及从备份恢复文档与任务。日常监控记录错误、连接状况和模型耗时，应用日志保留请求路由及状态。

## 在 Docker 主机部署

将试用域名解析到主机并开放 80 和 443 端口。Caddy 自动签发证书。Compose 为 CoSpace 启动独立的 PostgreSQL，数据库和应用的内部端口留在容器网络内。Ollama 使用 `OLLAMA_URL` 所指定的服务，地址须能从容器访问。

用 [试用环境变量示例](../deploy/pilot.env.example) 创建仓库根目录下的 `.env.pilot`，将文件权限设为 `600`。用 `openssl rand -hex 32` 生成 `COSPACE_POSTGRES_PASSWORD`，并在部署机写入已验证的 Resend 发件地址和发送密钥。

```bash
docker compose --env-file .env.pilot -f deploy/compose.pilot.yaml build app
docker compose --env-file .env.pilot -f deploy/compose.pilot.yaml run --rm app npm run db:migrate
docker compose --env-file .env.pilot -f deploy/compose.pilot.yaml up -d --wait
docker compose --env-file .env.pilot -f deploy/compose.pilot.yaml exec app \
  npm run pilot:bootstrap -- "试用团队" admin@example.com
```

## Render 免费试用

将 CoSpace 部署为单实例 Docker Web Service，Dockerfile 路径为 `./deploy/Dockerfile`，在仓库根目录构建，健康检查路径填 `/api/ready`。镜像通过 Render 提供的端口接收 HTTPS 代理流量，并在启动时执行迁移。默认使用平台提供的 `onrender.com` 地址生成邀请和登录链接。发件地址和密钥都尚未设置时，服务仍可启动，`/api/auth/config` 返回 `emailEnabled: false`，登录链接和邀请请求返回 503。已有会话和已发出的有效链接可以继续使用。只设置一项时，启动会报配置错误。

在 Render 中配置托管 PostgreSQL 的 `DATABASE_URL`（启用 TLS）、已验证的 `COSPACE_EMAIL_FROM`、`COSPACE_EMAIL_API_KEY` 和 `COSPACE_GROQ_API_KEY`。试用版启用 Groq 时默认使用 `openai/gpt-oss-20b`。文档原文会发送给 Groq 进行行动项提取。从可信终端使用同一份数据库和邮件配置，另加 `COSPACE_MODE=pilot` 和公网 `APP_ORIGIN`，运行 `npm run pilot:bootstrap` 创建工作区。

Render 免费试用模板使用 MailerSend 的试用发件域名。选择 Sandbox，使用控制台分配的域名，将该域名下的纯邮箱地址填入 `COSPACE_EMAIL_FROM`，发送令牌填入 `COSPACE_EMAIL_API_KEY`。运行 `pilot:bootstrap` 的终端也须配置同一地址、令牌和 `COSPACE_EMAIL_API_URL=https://api.mailersend.com/v1/email`。审核前的两个收件人名额用于独立的管理员和成员测试邮箱，使用项目自己的发件域名完成 DNS 验证和账号审核后，再邀请其他团队成员。使用 Resend 已验证域名时，把服务和引导终端的地址都设置为 `https://api.resend.com/emails`。[MailerSend Sandbox 规则](https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial)

## 两账号与两工作区验收

准备一个空的临时 PostgreSQL 数据库，以及 Playwright Chromium，运行以下命令。测试会执行迁移并创建两组工作区数据。测试邮箱接收服务监听回环地址。

```bash
npx playwright install chromium
COSPACE_PILOT_TEST_DATABASE_URL=postgres://... npm run test:pilot
```

默认使用可重复的模型响应。若本机已运行 Ollama，可对另一个空数据库设置 `COSPACE_PILOT_TEST_OLLAMA_URL=http://127.0.0.1:11434`，使用测试文档复跑真实模型。可以用 `COSPACE_PILOT_TEST_OLLAMA_MODEL` 指定模型。

设置 `COSPACE_PILOT_TEST_CADDY=caddy` 可通过同一份部署模板复跑 HTTPS 验收，覆盖 Secure Cookie 和两条 WSS。也可指定 Caddy 可执行文件的绝对路径。测试证书仅用于本机回环地址，验收使用独立的浏览器上下文。

验收覆盖邀请撤销及重复兑换、角色权限、多人编辑和持久化、过期建议拦截、人工修订、重复确认、任务实时更新，以及文档、任务、AI 运行记录和协作票据的工作区隔离。

2026-11-24 本机通过 Caddy HTTPS 和 Ollama `qwen3:14b` 完成整套浏览器验收。用测试库备份恢复到新库后，核对了文档状态及版本、任务负责人、AI 确认回执和工作区归属。该次邮件通过本机测试收件箱领取。

## 2026-11-28 公网验收记录

两个独立测试邮箱分别收到并兑换了登录链接。工作区管理员邀请另一账号担任编辑者，收件人在自己的邮箱中收到邀请，通过邮件加入目标工作区。两名成员通过公网 WebSocket 共同编辑会议纪要，从服务端读回的第 2 版包含双方的修改。

Render 上的 Groq 集成使用 `openai/gpt-oss-20b`，从纪要提取了「整理试用反馈清单」和「复核邀请邮件模板」。确认前任务列表没有新增条目。管理员核对原文，将第一条修订为「整理首轮团队试用反馈清单」，指定负责人并确认。编辑者通过 WebSocket 收到更新。重复确认返回相同回执。在线 PostgreSQL 中核对了文档版本、已确认记录、任务标题、负责人和工作区归属。

切换到另一工作区后，其列表中只有该工作区自己的文档和任务。验收结束后撤回了本轮新增的临时编辑者权限，重新读取账号可用工作区时，原先的权限边界已恢复。
