const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(process.env.SMOKE_OUTPUT_DIR || path.join(root, "test-results", "smoke"));
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
const contentTypes = {
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webp": "image/webp"
};

fs.mkdirSync(outputDir, { recursive: true });

function createServer() {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream"
      });
      fs.createReadStream(file).pipe(res);
    });
  });
}

function isIgnorableExternalFailure(entry) {
  const url = entry.url || "";
  return /busuanzi\.ibruce\.info|giscus\.app/.test(url) ||
    (/api\.github\.com/.test(url) && entry.status === 403);
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.02 && rect.width > 0 && rect.height > 0;
    };
    const npc = document.getElementById("sp-npc");
    const glCanvas = document.getElementById("sp-npc-gl");
    const splashElement = document.getElementById("splash");
    const splashStyle = splashElement ? getComputedStyle(splashElement) : null;
    return {
      bodyClasses: document.body.className,
      brandText: document.getElementById("sp-brand")?.textContent || "",
      brandVisible: visible("#sp-brand"),
      glReady: Boolean(window.__npcGL && window.__npcGL.ready),
      glStats: window.__npcGL?.stats?.() || null,
      glCanvasVisible: Boolean(glCanvas && getComputedStyle(glCanvas).opacity !== "0"),
      worldReady: Boolean(window.__npcWorld?.ready),
      worldActive: Boolean(window.__npcWorld?.active),
      worldBarba: Boolean(window.__npcWorld?.barba),
      worldStats: window.__npcWorld?.stats?.() || null,
      worldCanvasVisible: visible("#npc-world"),
      npcClass: npc?.className || "",
      npcPosition: npc ? getComputedStyle(npc).position : "",
      splashClass: splashElement?.className || "",
      splashOpacity: splashStyle?.opacity || null,
      splashVisibility: splashStyle?.visibility || null,
      splashVisible: visible("#splash"),
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

async function runScenario(browser, name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  const badResponses = [];
  const localRequests = new Set();

  page.on("console", (message) => {
    const entry = { type: message.type(), text: message.text() };
    if (entry.type === "error") errors.push(entry);
    if (entry.type === "warning") warnings.push(entry);
  });
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.stack || error.message }));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") localRequests.add(url.pathname);
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(7000);
  const initial = await inspectPage(page);
  await page.screenshot({ path: path.join(outputDir, `${name}-splash.png`), fullPage: false });

  await page.locator("#sp-enter").click();
  await page.waitForFunction(() => {
    const splash = document.getElementById("splash");
    return !splash || getComputedStyle(splash).visibility === "hidden" || Number(getComputedStyle(splash).opacity) < 0.02;
  }, null, { timeout: 6000 });
  await page.waitForTimeout(250);
  const entered = await inspectPage(page);
  await page.screenshot({ path: path.join(outputDir, `${name}-entered.png`), fullPage: false });
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    function count(now) {
      frames++;
      if (now - started >= 1200) {
        resolve(Math.round((frames / (now - started)) * 1000));
        return;
      }
      requestAnimationFrame(count);
    }
    requestAnimationFrame(count);
  }));

  await page.evaluate(() => {
    window.__smokeCanvas = document.getElementById("npc-world");
    window.__smokePhysicsBefore = window.__npcWorld?.state?.physicsSteps || 0;
  });
  await page.locator(".sbnav a[href='#ssec1']").click();
  await page.waitForTimeout(650);
  const transition = await page.evaluate(() => ({
    canvasSame: window.__smokeCanvas === document.getElementById("npc-world"),
    worldActive: Boolean(window.__npcWorld?.active),
    physicsAdvanced: (window.__npcWorld?.state?.physicsSteps || 0) > window.__smokePhysicsBefore,
    hash: location.hash,
    contentOpacity: getComputedStyle(document.getElementById("content")).opacity
  }));

  const beforeDrive = await page.locator("#sp-npc").boundingBox();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(900);
  await page.keyboard.up("ArrowUp");
  const driving = await page.evaluate(() => ({
    bodyClasses: document.body.className,
    drove: Boolean(window.__driveDbg && window.__driveDbg.keys),
    hudVisible: getComputedStyle(document.getElementById("npc-drive-hud")).opacity !== "0",
    worldHudVisible: getComputedStyle(document.getElementById("world-hud")).opacity !== "0",
    speedText: document.getElementById("npc-drive-speed")?.textContent || "",
    speed: window.__driveDbg?.speed?.() || 0,
    worldSpeed: window.__npcWorld?.stats?.().speed || 0
  }));
  const afterDrive = await page.locator("#sp-npc").boundingBox();
  await page.screenshot({ path: path.join(outputDir, `${name}-driving.png`), fullPage: false });

  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const worldJumpState = await page.evaluate(() => ({
    verticalVelocity: window.__npcWorld?.body?.linvel?.().y || 0
  }));
  await page.keyboard.press("r");
  await page.waitForTimeout(120);
  const resetState = await page.evaluate(() => ({
    state: window.__driveDbg?.st?.() || "",
    speed: window.__driveDbg?.speed?.() || 0,
    pos: window.__driveDbg?.pos?.() || null,
    worldSpeed: Math.hypot(
      window.__npcWorld?.body?.linvel?.().x || 0,
      window.__npcWorld?.body?.linvel?.().z || 0
    ),
    worldPos: window.__npcWorld?.body?.translation?.() || null
  }));

  const apiRateLimited = badResponses.some((entry) => /api\.github\.com/.test(entry.url) && entry.status === 403);
  const freshErrors = errors.filter((entry) => {
    if (apiRateLimited && /status of 403/.test(entry.text)) return false;
    return !isIgnorableExternalFailure(entry);
  });
  const freshFailedRequests = failedRequests.filter((entry) => !isIgnorableExternalFailure(entry));
  const freshBadResponses = badResponses.filter((entry) => !isIgnorableExternalFailure(entry));
  const requiredLocalAssets = [
    "/index.html",
    "/npc-drive.js",
    "/npc-world.js",
    "/vendor/gsap.min.js",
    "/vendor/barba.umd.js",
    "/vendor/rapier.mjs",
    "/assets/three.min.js",
    "/assets/GLTFLoader.js",
    "/assets/npc_maid_3d.glb"
  ];
  const missingLocalAssets = requiredLocalAssets.filter((asset) => {
    if (asset === "/index.html") return !localRequests.has("/") && !localRequests.has("/index.html");
    return !localRequests.has(asset);
  });

  const report = {
    name,
    initial,
    entered,
    fps,
    transition,
    driving,
    worldJumpState,
    resetState,
    movement: beforeDrive && afterDrive ? {
      dx: Math.round(afterDrive.x - beforeDrive.x),
      dy: Math.round(afterDrive.y - beforeDrive.y)
    } : null,
    errors,
    warnings,
    failedRequests,
    badResponses,
    freshErrors,
    freshFailedRequests,
    freshBadResponses,
    missingLocalAssets
  };
  fs.writeFileSync(path.join(outputDir, `${name}-report.json`), JSON.stringify(report, null, 2));
  await context.close();
  return report;
}

let server;
let baseUrl;

(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader"
    ]
  });

  try {
    const desktop = await runScenario(browser, "desktop", {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1
    });
    const mobile = await runScenario(browser, "mobile", {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true
    });
    const reports = [desktop, mobile];
    const failures = [];

    for (const report of reports) {
      if (!report.initial.brandVisible) failures.push(`${report.name}: brand is not visible`);
      if (!report.initial.brandText.includes("一.chat")) failures.push(`${report.name}: brand text is incorrect`);
      if (!report.initial.splashVisible) failures.push(`${report.name}: splash is not visible`);
      if (!report.initial.glReady) failures.push(`${report.name}: WebGL model did not become ready`);
      if (!report.initial.worldReady) failures.push(`${report.name}: Rapier world did not become ready`);
      if (!report.entered.bodyClasses.includes("npc-adopted")) failures.push(`${report.name}: NPC was not adopted`);
      if (!report.entered.worldActive) failures.push(`${report.name}: world did not activate after entering`);
      if (!report.entered.worldCanvasVisible) failures.push(`${report.name}: persistent 3D canvas is not visible`);
      if (!report.transition.canvasSame) failures.push(`${report.name}: 3D canvas was replaced during navigation`);
      if (!report.transition.worldActive) failures.push(`${report.name}: world stopped during navigation`);
      if (!report.transition.physicsAdvanced) failures.push(`${report.name}: physics loop stopped during navigation`);
      if (report.transition.hash !== "#ssec1") failures.push(`${report.name}: navigation did not reach #ssec1`);
      if (!report.entered.splashClass.includes("hide")) failures.push(`${report.name}: splash did not hide`);
      if (report.entered.splashVisible) failures.push(`${report.name}: splash is still visible after its transition`);
      if (!report.driving.worldHudVisible) failures.push(`${report.name}: world HUD is hidden after ArrowUp`);
      if (!report.driving.speed || report.driving.speed < 60) failures.push(`${report.name}: drive physics did not build speed`);
      if (!report.driving.worldSpeed || report.driving.worldSpeed < 2) failures.push(`${report.name}: Rapier vehicle did not build speed`);
      if (!report.movement || Math.hypot(report.movement.dx, report.movement.dy) < 4) failures.push(`${report.name}: NPC did not move`);
      if (report.worldJumpState.verticalVelocity < 1) failures.push(`${report.name}: Space did not trigger a Rapier jump`);
      if (report.resetState.state !== "idle" || report.resetState.speed > 1) failures.push(`${report.name}: R did not reset the vehicle`);
      if (report.resetState.worldSpeed > 1 || Math.abs((report.resetState.worldPos?.z ?? 0) + 58) > 2) {
        failures.push(`${report.name}: R did not reset the Rapier vehicle`);
      }
      if (report.missingLocalAssets.length) failures.push(`${report.name}: local asset requests missing (${report.missingLocalAssets.join(", ")})`);
      if (report.freshErrors.length) failures.push(`${report.name}: console/page errors (${report.freshErrors.length})`);
      if (report.freshFailedRequests.length) failures.push(`${report.name}: failed requests (${report.freshFailedRequests.length})`);
      if (report.freshBadResponses.length) failures.push(`${report.name}: HTTP errors (${report.freshBadResponses.length})`);
    }

    console.log(JSON.stringify({ ok: failures.length === 0, baseUrl, outputDir, failures, reports }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  if (server?.listening) server.close();
  process.exitCode = 1;
});
