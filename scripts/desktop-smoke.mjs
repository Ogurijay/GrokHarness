import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const executablePath = resolve(process.env.DESKTOP_EXECUTABLE || "release/win-unpacked/Grok-Harness.exe");
const output = resolve("release/qa");
await mkdir(output, { recursive: true });

async function check(mode) {
  const profile = await mkdtemp(join(tmpdir(), `grok-harness-${mode}-`));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "missing") {
    delete env.XAI_API_KEY;
    delete env.GROK_BINARY;
    env.GROK_HOME = join(profile, "no-grok");
    env.PATH = join(process.env.SystemRoot || "C:\\Windows", "System32");
  }
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60_000 });
  const child = app.process();
  const errors = [];
  let backendPid;
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.grok?.desktop), null, { timeout: 30_000 });
    const state = await page.evaluate(() => window.grok.desktop.getState());
    assert.equal(state.packaged, true);
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
    if (mode === "missing") {
      assert.equal(state.cli.installed, false);
      await page.getByRole("dialog", { name: "Grok-Harness" }).waitFor();
      await page.getByRole("button", { name: "安装 Grok CLI" }).waitFor();
    } else {
      assert.equal(state.cli.installed, true);
      assert.equal(state.cli.authenticated, true);
      await page.waitForFunction(async () => (await window.grok.getState()).connection === "ready", null, { timeout: 60_000 });
      const mainPid = await app.evaluate(() => process.pid);
      const children = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${mainPid}' | Select-Object Name,ProcessId,@{Name='AgentServe';Expression={$_.CommandLine -match 'agent.+serve'}})`], { encoding: "utf8", windowsHide: true }));
      const backends = children.filter((process) => process.AgentServe && process.Name.toLowerCase() === basename(state.cli.binary).toLowerCase());
      assert.equal(backends.length, 1, "Exactly one app-owned ACP backend");
      backendPid = backends[0]?.ProcessId;
      if (!backendPid) console.log(JSON.stringify({ mainPid, launcherPid: child.pid, children }));
      assert.ok(backendPid > 0, "App-owned Grok backend must exist");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:open"));
      await page.getByRole("dialog", { name: "Grok-Harness" }).waitFor();
      await page.getByRole("button", { name: "检查更新", exact: true }).click();
      await page.waitForFunction(async () => (await window.grok.desktop.getState()).update.phase !== "checking", null, { timeout: 25_000 });
    }
    await page.screenshot({ path: join(output, `${mode}-desktop.png`) });
    await page.getByRole("button", { name: "关闭桌面应用面板" }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 560));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:open"));
    await page.getByRole("dialog", { name: "Grok-Harness" }).waitFor();
    await page.screenshot({ path: join(output, `${mode}-compact.png`) });
    assert.equal(await page.locator(".desktop-panel").evaluate((element) => element.scrollWidth > element.clientWidth), false);
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    const second = spawn(executablePath, [`--user-data-dir=${profile}`], { env, windowsHide: true, stdio: "ignore" });
    await Promise.race([
      new Promise((resolve, reject) => { second.once("exit", resolve); second.once("error", reject); }),
      new Promise((_, reject) => setTimeout(() => { second.kill(); reject(new Error("Second launch did not exit")); }, 15_000).unref()),
    ]);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await stat(join(profile, "state.sqlite"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mode, version: state.version, cliInstalled: state.cli.installed, credentialsSaved: state.cli.authenticated, backendReady: mode === "ready", singleInstance: true, database: true, screenshots: output }));
  } finally {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("App shutdown timed out")), 15_000).unref())]);
    if (backendPid) {
      assert.throws(() => process.kill(backendPid, 0), "App-owned backend must stop on exit");
    }
  }
}

await check("missing");
await check("ready");
