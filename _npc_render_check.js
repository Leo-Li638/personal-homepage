const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });

  await page.goto("http://127.0.0.1:8899/index.html", { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1600); // 等 greeting 气泡

  const imgOK = await page.evaluate(() => {
    const i = document.getElementById("npc-img");
    return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth + "x" + i.naturalHeight : "FAIL";
  });
  await page.screenshot({ path: "_npc_t1_idle.png" });

  // ---- 拍拍：快速点击 NPC ----
  const box = await page.locator("#npc").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.3;
  await page.mouse.click(cx, cy, { delay: 60 });
  await page.waitForTimeout(500); // 气泡+爱心出现中
  await page.screenshot({ path: "_npc_t2_pat.png" });
  const patState = await page.evaluate(() => ({
    bubble: document.getElementById("npc-bubble").textContent.slice(0, 24),
    shown: document.getElementById("npc-bubble").classList.contains("show"),
    hearts: document.querySelectorAll(".npc-heart").length,
  }));

  // ---- 拖拽抛掷：按住向左上甩 ----
  await page.waitForTimeout(1200);
  const box2 = await page.locator("#npc").boundingBox();
  const gx = box2.x + box2.width / 2, gy = box2.y + box2.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(gx - i * 40, gy - i * 28, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(120); // 空中
  await page.screenshot({ path: "_npc_t3_air.png" });
  await page.waitForTimeout(2200); // 落地
  const dragState = await page.evaluate(() => {
    const n = document.getElementById("npc");
    return { transform: n.style.transform, air: n.classList.contains("air") };
  });
  await page.screenshot({ path: "_npc_t4_landed.png" });

  console.log(JSON.stringify({ imgOK, patState, dragState, errs: errs.length ? errs : 0 }, null, 1));
  await b.close();
})().catch((e) => { console.error("FATAL", e.message.slice(0, 200)); process.exit(1); });
