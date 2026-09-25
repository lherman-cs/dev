// Browser acceptance for the built single-item Spec and Review workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "dev-workspace-browser-"));
const fixture = spawn(process.execPath, ["test/workspace-walkthrough.mjs"], { cwd: join(process.cwd(), "pi"), stdio: ["ignore", "pipe", "pipe"] });
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let output = "", socket;
fixture.stdout.on("data", data => { output += data.toString(); });
fixture.stderr.on("data", data => process.stderr.write(data));
const until = async (fn, description) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await Promise.resolve().then(fn).catch(() => null);
    if (value) return value;
    await pause(100);
  }
  throw Error(`Timed out: ${description}`);
};
try {
  const urls = await until(() => {
    const entries = [...output.matchAll(/^(Early|Spec|Review) (https?:\/\/\S+)/gm)];
    return entries.length === 3 ? Object.fromEntries(entries.map(([, name, url]) => [name, url])) : null;
  }, "fixture URLs");
  const port = await until(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome port");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 1;
  const waiting = new Map();
  socket.addEventListener("message", event => {
    const response = JSON.parse(event.data), pending = waiting.get(response.id);
    if (!pending) return;
    waiting.delete(response.id);
    response.error ? pending.reject(Error(response.error.message)) : pending.resolve(response.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const visit = async url => {
    await send("Page.navigate", { url });
    await until(() => evaluate(`location.href === ${JSON.stringify(url)} && Boolean(document.querySelector('main h1'))`), "workspace rendered");
  };
  const click = async label => {
    const found = await evaluate(`(() => { const node=[...document.querySelectorAll('button,summary')].find(n=>n.textContent.trim().includes(${JSON.stringify(label)}) && n.getBoundingClientRect().height>0); if (!node) return false; node.click(); return true })()`);
    assert.ok(found, `missing visible control: ${label}`);
  };
  const key = async (name, code = name) => {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code, windowsVirtualKeyCode: name === "Escape" ? 27 : name === "Enter" ? 13 : name.toUpperCase().charCodeAt(0) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: name === "Escape" ? 27 : name === "Enter" ? 13 : name.toUpperCase().charCodeAt(0) });
  };
  await send("Page.enable"); await send("Runtime.enable");
  await visit(urls.Early);
  assert.match(await evaluate("document.querySelector('main h1')?.textContent"), /Await the first publication/);
  assert.equal(await evaluate("document.querySelectorAll('main h1').length"), 1);
  await visit(urls.Spec);
  assert.match(await evaluate("document.querySelector('main h1')?.textContent"), /Inspect the proposed revision/);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Apply inspected'))?.disabled"), true);
  const subjectCount = await evaluate("document.querySelectorAll('.revision-subject summary').length");
  assert.ok(subjectCount >= 2, "revision offers changed subjects");
  await evaluate("[...document.querySelectorAll('.revision-subject summary')].forEach(node => node.click())");
  await until(() => evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Apply inspected'))?.disabled === false"), "all subjects inspected");
  await click("Apply inspected revision");
  await until(() => evaluate("document.querySelector('main h1')?.textContent === 'Handoff history'"), "automatic progression to decision");
  assert.match(await evaluate("document.querySelector('main')?.innerText"), /storage and retention obligations/);
  await visit(urls.Review);
  assert.match(await evaluate("document.querySelector('main h1')?.textContent"), /Retention policy gap/);
  assert.equal(await evaluate("document.querySelectorAll('main h1').length"), 1);
  assert.match(await evaluate("document.querySelector('main')?.innerText"), /Handoff recorded/);
  assert.doesNotMatch(await evaluate("document.querySelector('main')?.innerText"), /retention policy is not tested/);
  await key("w");
  assert.match(await evaluate("document.querySelector('[aria-label=\"Why this matters\"]')?.innerText"), /local history is persistent/);
  await key("Escape");
  await key("a");
  assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"Discussion\"] textarea'))"));
  await key("Escape");
  await click("Show evidence");
  assert.match(await evaluate("document.querySelector('[aria-label=\"Evidence\"]')?.innerText"), /retention policy is not tested/);
  await key("Escape");
  await until(() => evaluate("!document.querySelector('[aria-label=\"Evidence\"]')"), "detail closed");
  assert.match(await evaluate("document.querySelector('main h1')?.textContent"), /Retention policy gap/);
  await click("Accept recommendation");
  await until(() => evaluate("document.querySelector('main h1')?.textContent === 'Finish review'"), "automatic progression to completion");
  assert.equal(await evaluate("document.activeElement === document.querySelector('main h1')"), true, "focus advances to next packet");
  assert.match(await evaluate("document.querySelector('.workspace-topbar')?.innerText"), /0 decisions remaining/);
  await click("Approve exact target");
  assert.equal(await evaluate("document.querySelector('input[value=approve]')?.disabled"), false);
  await click("Approve revision");
  await until(() => evaluate("document.body.innerText.includes('Approved this exact revision')"), "exact-target approval");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await visit(urls.Review);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await click("Ask agent");
  assert.ok(await evaluate("document.querySelector('[aria-label=\"Discussion\"]')?.getBoundingClientRect().width <= window.innerWidth"));
  await key("Escape");
  assert.equal(await evaluate("(() => { const button = document.querySelector('button[aria-label=\"Use dark theme\"]'); button?.click(); return Boolean(button) })()"), true);
  assert.equal(await evaluate("document.documentElement.classList.contains('dark')"), true);
  console.log("Browser walkthrough passed: revision inspection, one-item progression, context depth, keyboard focus, approval, mobile and dark mode.");
} finally {
  socket?.close(); fixture.kill("SIGTERM"); chrome.kill("SIGTERM");
  if (chrome.exitCode === null) await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), pause(2000)]);
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 7) console.error("Chrome profile cleanup:", error.message); else await pause(250); }
  }
}
