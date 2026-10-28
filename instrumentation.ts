/**
 * Next.js 启动钩子：进程存活期间只跑一次，跑在 Node.js runtime。
 *
 * 这里做的是「把 DSH 的模型凭据同步进 pi 的进程环境」。
 * pi 的 models.json 用 `$DGRID_*` 环境变量引用 key，真值由 DSH 存在
 * `~/.dsh/.credentials.yaml`；不补进去的话 pi 会认为所有 provider 都没配置，
 * 界面上模型列表就是空的（看起来像"切不了模型"）。
 *
 * 取消同步：设 `PI_WEB_SYNC_DSH_CREDENTIALS=0`，或直接 export 自己的同名变量
 * （已存在的变量永不覆盖）。
 */
export async function register(): Promise<void> {
  if (process.env.PI_WEB_SYNC_DSH_CREDENTIALS === "0") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { loadDshCredentialsIntoEnv } = await import("./lib/dsh-credentials");
    const result = loadDshCredentialsIntoEnv();
    // 只打印变量名与数量，绝不打印密文。
    if (result.injected.length > 0) {
      console.log(
        `[pi-web] synced ${result.injected.length} credential env var(s) from DSH: ${result.injected.join(", ")}`,
      );
    }
    if (result.skipped.length > 0) {
      console.log(
        `[pi-web] kept ${result.skipped.length} pre-set env var(s): ${result.skipped.join(", ")}`,
      );
    }
    if (!result.loaded && process.env.PI_WEB_DEBUG_CREDENTIALS === "1") {
      console.log(`[pi-web] DSH credentials not loaded: ${result.error ?? "unknown"}`);
    }
  } catch (err) {
    // 同步失败绝不能阻塞启动：pi 会照常按「未配置 provider」运行。
    console.error("[pi-web] DSH credential sync failed:", err);
  }
}