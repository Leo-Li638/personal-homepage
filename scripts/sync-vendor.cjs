const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor");
const files = [
  ["node_modules/gsap/dist/gsap.min.js", "gsap.min.js"],
  ["node_modules/@barba/core/dist/barba.umd.js", "barba.umd.js"],
  ["node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs", "rapier.mjs"]
];

fs.mkdirSync(vendor, { recursive: true });
for (const [source, target] of files) {
  const from = path.join(root, source);
  const to = path.join(vendor, target);
  if (!fs.existsSync(from)) throw new Error(`Missing vendor source: ${source}`);
  fs.copyFileSync(from, to);
  console.log(`${source} -> vendor/${target}`);
}
