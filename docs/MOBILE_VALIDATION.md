# 移动端验收与性能复测

测试以 CoSpace 本地演示工作区为环境。浏览器、原生客户端和测试工具连接同一个 Fastify 和 PostgreSQL。日常回归在数据库内准备带唯一 ID 的行动项建议，真实模型演示由网页调用 Ollama 生成。测试会按本轮的运行和任务 ID 清理业务数据。

## 网页和接口回归

按项目说明启动数据库、Web 与 API，然后执行以下命令。

```bash
npx playwright test tests/e2e/mobile.spec.ts --project=chromium
```

2026 年 11 月 18 日对本地生产构建执行完整 Playwright 套件，Chromium、Firefox 和 WebKit 共 **41 项通过**，约 44 秒。其中新增的 8 项覆盖一次性配对、过期和撤销、账号与角色权限、另一个成员的网页通过 WebSocket 更新、生成者重新聚焦后的建议状态、并发确认、提交后响应丢失、放弃、任务版本冲突，以及万行任务的分页。分页用例核对精确到微秒的时间和相同时间下的 ID 次序，每次默认返回 30 条。

## Web 与原生端到端验收

移动端使用 Expo SDK 55.0.32、React Native 0.83.10 和 React 19.2.0。本机按锁文件安装依赖，完成严格 TypeScript 检查、Android 与 iOS 原生工程生成，以及两端的生产 Hermes bundle 导出。

已在 Android 16 arm64 模拟器上通过 Expo Go 和 Metro 实跑跨端操作。手机完成配对并检查原文，服务端提交后测试转发器丢弃一次确认响应。强制关闭并重开 App 后，手机取回原来的两个任务 ID，测试期间只有一次确认请求。另一成员的 Web 任务表自动回显，且手机改状态、Web 先修改导致的 409 和界面冲突反馈均通过。该轮原生操作使用固定的 PostgreSQL 建议。

同一模拟器另跑了真实模型流程。Ollama 的 `qwen3:14b` 从网页发布文档生成两条行动项，本次模型阶段约 5.6 秒。手机查看原文并确认后，另一成员的网页上出现同一批任务。手机状态修改回显和并发版本冲突的检查同样通过。

准备已安装 `dev.cospace.mobile` 的测试模拟器或测试设备，并安装 Maestro。使用包含 JS bundle 的构建，使 Maestro 清理本地状态后可以直接从配对页启动。Android 可用 `npm --prefix apps/mobile run android -- --variant release`，iOS 模拟器可用 `npm --prefix apps/mobile run ios -- --configuration Release`。

脚本启动 Chromium，在网页取出一次性配对码，然后由 Maestro 操作 App 完成预览、确认和状态更新。另一位成员的网页始终开着，脚本检查已有任务表自动刷新，并核对数据库记录与建议回执中的任务 ID。

```bash
# Android 默认本地 API，可选择已启动的模拟器或测试设备
node scripts/mobile-e2e.mjs --android

# 确认已提交后丢掉响应，关闭 App 并恢复网络，再启动并找回原来的任务
node scripts/mobile-e2e.mjs --android --lost-response

# 在网页的发布方案中走真实 Ollama 生成流程
node scripts/mobile-e2e.mjs --android --real-model

# 在连接宿主机回环地址的 iOS 模拟器上验收
node scripts/mobile-e2e.mjs
```

Android 脚本在测试期间将设备的 `tcp:4027` 通过 `adb reverse` 指向本机测试转发器，执行结束后恢复之前的映射。模拟响应丢失时，转发器先收到 Fastify 的成功回执，再断开连接，并临时阻断对应建议的详情读取。原生端重启后通过真实详情接口取回原来的任务，脚本同时检查重启没有再次提交确认。

`COSPACE_MAESTRO` 和 `COSPACE_ADB` 可指定命令路径。若有多个设备，用 `COSPACE_ANDROID_SERIAL` 指定 adb 设备，用 `COSPACE_MAESTRO_DEVICE` 指定 Maestro 设备。截图和 `result.json` 默认写入 `.local/mobile-e2e/<runId>/`。`maestroJourneyMs` 是自动化流程耗时，原生首行指标使用下方测量流程。

## 安卓任务首行

开发构建基线已采集。Apple M4 上的 Android 16 arm64 模拟器通过 Expo Go 55.0.7 和 Metro 运行。后端有 10,000 条测试任务，默认请求 30 条。每次从独立 App 进程启动并恢复有效会话，进入工作区后再点击「任务」。从 tab 点击事件到首行完成布局的 30 次采样，**P50 为 94.15 ms，P95 为 124.41 ms**，区间为 80.04–138.20 ms。Metro、API 和 PostgreSQL 均已启动，采样期间宿主机并行下载 Gradle 依赖。Release 真机数据另行采集。

以 `EXPO_PUBLIC_MEASURE_LIST=1` 生成并安装测量构建。目标口径使用 release、固定设备与本机热服务。设备系统和构建类型随采样记录。

```bash
EXPO_PUBLIC_MEASURE_LIST=1 npm --prefix apps/mobile run android -- --variant release
COSPACE_MOBILE_BUILD=release node scripts/mobile-list-perf.mjs
```

脚本准备 10,000 条任务，在配对后进行 30 次独立采样。每次停止并重启 App，待工作区恢复，再点「任务」。计时由原生界面的 tab 事件开始，在第一条任务完成布局时结束，经 Android `logcat` 收集。结果写入 `.local/mobile-e2e/task-list-*/samples.json` 和 `result.json`。首行 P95 目标为 1 秒，真机和模拟器各自记录。

滚动用 Android Perfetto FrameTimeline 另采样。固定 60 Hz，连续滑动 15 秒，重复 5 轮，记录错过显示截止时间的帧比例。把设备、系统、构建类型和原始 trace 一起保存，按相同条件比较改动前后。
