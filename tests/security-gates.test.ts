// 安全闸门回归测试（对应 docs/audit-report-2026-10.md 的 S2/S3/S6）
//
// 目标：git 动作层永远不经过 shell、任何写/读路径必须落在 cwd 之内、
// 技能 PATCH 只能改「当前已加载技能清单里」的 SKILL.md。
//
// 这些断言在修复前必须失败（Red）：
//  - execSync 字符串拼接会让 `branchName: "x; touch PWNED"` / 提交信息里的引号
//    被 cmd/sh 当成新命令执行；
//  - write-file 用 `${cwd}/${writePath}` 拼接，`../escape.txt` 直接写到 cwd 之外；
//  - diff 用 path.join(cwd, relPath)，绝对路径/`..` 可读任意文件；
//  - PATCH /api/skills 接受任意绝对路径并 writeFileSync。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGitAction } from "../lib/git-status-exec";
import { assertInsideRoot, isInsideRoot } from "../lib/path-guard";
import { findAllowedSkillFile } from "../lib/skills-edit-guard";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

test("path-guard: 根内路径放行，根外/前缀相同兄弟目录/.. 逃逸全部拒绝", () => {
  const root = join(tmpdir(), "pi-web-root");
  assert.equal(isInsideRoot(root, join(root, "a", "b.txt")), true);
  assert.equal(isInsideRoot(root, root), true);
  assert.equal(isInsideRoot(root, join(root, "..", "escape.txt")), false);
  assert.equal(isInsideRoot(root, `${root}-evil`), false);
  assert.equal(isInsideRoot(root, join(`${root}-evil`, "x.txt")), false);
  assert.throws(() => assertInsideRoot(root, join(root, "..", "escape.txt")));
});

test("git checkout: 分支名里的 shell 元字符不得执行", () => {
  const cwd = makeRepo();
  try {
    const marker = join(cwd, "PWNED");
    const res = runGitAction({ cwd, action: "checkout", branchName: `main; touch ${marker}` });
    assert.equal(res.status, 400);
    assert.equal(existsSync(marker), false, "shell 元字符被执行了");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("git checkout: 以 - 开头的分支名不得被当成 git 选项", () => {
  const cwd = makeRepo();
  try {
    const res = runGitAction({ cwd, action: "checkout", branchName: "--orphan" });
    assert.equal(res.status, 400);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("git commit: 提交信息含引号与 & 时按字面入库，不执行命令", () => {
  const cwd = makeRepo();
  try {
    const marker = join(cwd, "pwned.txt");
    const message = `fix: "a" & echo pwned > ${marker} & "`;
    writeFileSync(join(cwd, "f.txt"), "x");
    const res = runGitAction({ cwd, action: "commit", commitMessage: message });
    assert.equal(res.status, 200);
    assert.equal(existsSync(marker), false, "提交信息被 shell 解释了");
    const subject = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd, encoding: "utf8" }).trim();
    assert.equal(subject, message);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("git write-file: ../ 与绝对路径越界写被拒绝", () => {
  const cwd = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), "pi-web-outside-"));
  try {
    const up = runGitAction({ cwd, action: "write-file", filePath: "../escape.txt", content: "x" });
    assert.equal(up.status, 400);
    assert.equal(existsSync(join(cwd, "..", "escape.txt")), false);

    const abs = runGitAction({ cwd, action: "write-file", filePath: join(outside, "abs.txt"), content: "x" });
    assert.equal(abs.status, 400);
    assert.equal(existsSync(join(outside, "abs.txt")), false);

    const ok = runGitAction({ cwd, action: "write-file", filePath: "nested/ok.txt", content: "hello" });
    assert.equal(ok.status, 200);
    assert.equal(existsSync(join(cwd, "nested", "ok.txt")), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("git diff: 越界路径不读取，根内路径正常返回", () => {
  const cwd = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), "pi-web-secret-"));
  try {
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "TOP-SECRET");
    const escape = runGitAction({ cwd, action: "diff", filePath: secret });
    assert.equal(escape.status, 400);
    assert.equal(JSON.stringify(escape.json).includes("TOP-SECRET"), false);

    writeFileSync(join(cwd, "tracked.txt"), "v1");
    const inside = runGitAction({ cwd, action: "diff", filePath: "tracked.txt" });
    assert.equal(inside.status, 200);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("git rollback: 文件列表越界被拒绝", () => {
  const cwd = makeRepo();
  try {
    const res = runGitAction({ cwd, action: "rollback", rollbackFiles: ["../../etc/passwd"] });
    assert.equal(res.status, 400);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("git 动作: 非仓库/不存在的 cwd 返回 400 而不是抛错", () => {
  const res = runGitAction({ cwd: join(tmpdir(), "pi-web-does-not-exist"), action: "status" });
  assert.equal(res.status, 400);
});

test("skills-edit-guard: 只允许清单内的 SKILL.md", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skills-"));
  try {
    const skillDir = join(root, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, "SKILL.md");
    writeFileSync(skillFile, "---\nname: my-skill\n---\n");
    const allowed = [skillFile];

    assert.equal(findAllowedSkillFile(skillFile, allowed), skillFile);
    assert.equal(findAllowedSkillFile(join(root, "evil.md"), allowed), null);
    assert.equal(findAllowedSkillFile(join(root, "..", "settings.json"), allowed), null);
    assert.equal(findAllowedSkillFile("", allowed), null);
    // 软链/大小写差异：命中清单里的同一个文件（realpath 归一化）
    assert.equal(findAllowedSkillFile(join(skillDir, "..", "my-skill", "SKILL.md"), allowed), skillFile);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
