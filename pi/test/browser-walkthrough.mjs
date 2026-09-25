// Manual UI acceptance gate. Requires local Google Chrome and the built web/dist assets.
// Run through the verifier: node test/browser-walkthrough.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "dev-workspace-browser-"));
const fixture = spawn(process.execPath, ["test/workspace-walkthrough.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let output = "", socket;
fixture.stdout.on("data", data => { output += data.toString(); });
fixture.stderr.on("data", data => { process.stderr.write(data); });
const until = async (fn, description) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await Promise.resolve().then(fn).catch(() => null);
    if (result) return result;
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
    const response = JSON.parse(event.data);
    if (!response.id) return;
    const pending = waiting.get(response.id);
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
  const visit = async url => { await send("Page.navigate", { url }); await until(async () => await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('h1') && document.querySelector('[data-slot=tabs-trigger]'))`), "workspace rendered"); };
  const viewport = async (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const click = async selector => {
    const box = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`);
    assert.ok(box, `missing clickable element: ${selector}`);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  };
  const capture = async file => { const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(file, Buffer.from(data, "base64")); };
  await send("Page.enable"); await send("Runtime.enable");
  await viewport(1245, 900);
  await visit(urls.Early);
  assert.match(await evaluate("document.body.innerText"), /shaping the first draft/i);
  await click("textarea"); await send("Input.insertText", { text: "What is the smallest outcome?" });
  await until(async () => await evaluate("document.querySelector('textarea')?.value") === "What is the smallest outcome?", "typing into initial discussion");
  await click("[data-slot=tabs-trigger]:nth-child(2)");
  assert.match(await evaluate("document.body.innerText"), /No update is waiting/);
  await click("[data-slot=tabs-trigger]:nth-child(1)");
  assert.equal(await evaluate("document.querySelector('textarea')?.value"), "What is the smallest outcome?");
  await visit(urls.Early);
  assert.equal(await evaluate("document.querySelector('textarea')?.value"), "What is the smallest outcome?");
  await capture("/tmp/dev-early-wide.png");

  await visit(urls.Spec);
  assert.match(await evaluate("document.body.innerText"), /Approval is suspended/);
  assert.match(await evaluate("document.querySelector('aside')?.innerText"), /Submit review/);
  await click("aside button");
  assert.equal(await evaluate("document.querySelector('input[value=approve]')?.disabled"), true);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await capture("/tmp/dev-spec-wide.png");
  await click("[data-slot=tabs-trigger]:nth-child(2)");
  assert.match(await evaluate("document.body.innerText"), /Inspect revision details/);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Apply inspected'))?.disabled"), true);
  const detail = await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Inspect revision details'))?.outerHTML");
  assert.ok(detail);
  const focus = await evaluate("(() => { const s=[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Inspect revision details')); s.focus(); return document.activeElement===s })()");
  assert.equal(focus, true);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "char", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(async () => await evaluate("Boolean(document.querySelector('details[open]'))"), "keyboard inspection expanded");
  await until(async () => await evaluate("![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Apply inspected'))?.disabled"), "apply enabled after inspection");
  await capture("/tmp/dev-spec-changes.png");

  await visit(urls.Review);
  await until(async () => await evaluate("document.querySelectorAll('[role=img] svg .node text').length") === 5, "sanitized Mermaid labels");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[role=img] svg .node text')].map(n=>n.textContent)"), ["Human review", "Local browser", "Loopback workspace", "Pi review agent", "Local candidate"]);
  assert.equal(await evaluate("document.querySelectorAll('foreignObject').length"), 0);
  await capture("/tmp/dev-review-wide.png");
  await click("aside button");
  assert.match(await evaluate("document.querySelector('[data-slot=dialog-content]')?.innerText"), /Comment.*Request changes.*Approve/s);
  await capture("/tmp/dev-review-submit.png");
  await click("input[value=request_changes]");
  await click("#review-summary"); await send("Input.insertText", { text: "Clarify who owns retention before approval." });
  await click("[data-slot=dialog-content] button[type=submit]");
  await until(async () => /Changes requested/.test(await evaluate("document.querySelector('aside')?.innerText")), "change request recorded");
  await click("aside button");
  assert.equal(await evaluate("document.querySelector('input[value=approve]')?.disabled"), true);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await viewport(390, 844);
  await visit(urls.Review);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.match(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Submit review' && b.getBoundingClientRect().height>0)?.textContent"), /Submit review/);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-slot=tabs-trigger]')].every(t=>t.getBoundingClientRect().right <= innerWidth)"), true);
  await capture("/tmp/dev-review-mobile.png");
  await visit(urls.Spec);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-slot=tabs-trigger]')].every(t=>t.getBoundingClientRect().right <= innerWidth)"), true);
  await capture("/tmp/dev-spec-mobile.png");
  console.log("Browser walkthrough passed. Screenshots: /tmp/dev-{early-wide,spec-wide,spec-changes,review-wide,review-submit,review-mobile,spec-mobile}.png");
} finally {
  socket?.close();
  fixture.kill("SIGTERM"); chrome.kill("SIGTERM");
  if (chrome.exitCode === null) await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), pause(2000)]);
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 7) console.error("Chrome profile cleanup:", error.message); else await pause(250); }
  }
}
