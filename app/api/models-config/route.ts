import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reloadAllSessionModelConfigs } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsJson(body);
    // 让所有运行中的会话立即重载新配置（新增/修改/删除供应商与模型无需重开会话即可用）。
    // 同步等待刷新结果：保存接口返回时带统计，方便前端提示；刷新失败不影响保存本身。
    const reloaded = await reloadAllSessionModelConfigs();
    return NextResponse.json({ success: true, reloaded });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
