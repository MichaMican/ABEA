// Renders every platform icon from assets/icon.svg.
// Usage: npm i --no-save sharp png-to-ico && node assets/generate-icons.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "assets/icon.svg"), "utf8");
const inner = svg.slice(svg.indexOf("<defs>"), svg.lastIndexOf("</svg>"));
const defs = inner.slice(0, inner.indexOf("</defs>") + 7);
const bubble = inner.slice(inner.indexOf("<path"));

/** Full-bleed square (iOS / Android / maskable PWA – the OS applies the mask). */
const square = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="url(#g)"/><rect width="64" height="34" fill="url(#h)"/>${bubble}</svg>`;
/** macOS Big Sur style: rounded square with transparent margin + soft shadow. */
const mac = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.28"/></filter></defs>
  <g filter="url(#s)"><svg x="100" y="100" width="824" height="824" viewBox="0 0 64 64">${inner}</svg></g></svg>`;
/** Android adaptive icon layers (108dp canvas, 66dp safe zone). */
const fgAdaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="-10 -10 84 84">${bubble}</svg>`;
const bgAdaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="url(#g)"/><rect width="64" height="34" fill="url(#h)"/></svg>`;

const png = (src, size) => sharp(Buffer.from(src), { density: 384 }).resize(size, size).png().toBuffer();
const out = async (rel, buf) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, await buf);
  console.log("wrote", rel);
};

function icns(entries) {
  const chunks = entries.map(([type, data]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// Web
await out("web/public/icon-192.png", png(svg, 192));
await out("web/public/icon-512.png", png(svg, 512));
await out("web/public/icon-maskable-512.png", png(square, 512));
await out("web/public/apple-touch-icon.png", png(square, 180));

// Desktop
await out("desktop/build/icon.png", png(svg, 1024));
await out("desktop/build/icon.ico", pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => png(svg, s)))));
await out(
  "desktop/build/icon.icns",
  icns([
    ["ic07", await png(mac, 128)],
    ["ic08", await png(mac, 256)],
    ["ic09", await png(mac, 512)],
    ["ic10", await png(mac, 1024)],
    ["ic11", await png(mac, 32)],
    ["ic12", await png(mac, 64)],
    ["ic13", await png(mac, 256)],
    ["ic14", await png(mac, 512)],
  ]),
);

// Mobile – Android (only when the native project has been generated with `cap add android`)
const res = "mobile/android/app/src/main/res";
if (existsSync(join(root, res))) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const round = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">${defs}
  <clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath><g clip-path="url(#c)">
  <rect width="64" height="64" fill="url(#g)"/><rect width="64" height="34" fill="url(#h)"/>${bubble}</g></svg>`;
  for (const [d, k] of Object.entries(densities)) {
    await out(`${res}/mipmap-${d}/ic_launcher.png`, png(svg, 48 * k));
    await out(`${res}/mipmap-${d}/ic_launcher_round.png`, png(round, 48 * k));
    await out(`${res}/mipmap-${d}/ic_launcher_foreground.png`, png(fgAdaptive, 108 * k));
    await out(`${res}/mipmap-${d}/ic_launcher_background.png`, png(bgAdaptive, 108 * k));
  }
  rmSync(join(root, res, "drawable-v24/ic_launcher_foreground.xml"), { force: true });
  rmSync(join(root, res, "drawable/ic_launcher_background.xml"), { force: true });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  await out(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  await out(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
  // Status-bar notification icon: white silhouette of the chat bubble.
  const path = bubble.match(/d="([^"]+)"/)[1];
  await out(
    `${res}/drawable/ic_stat_abea.xml`,
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp"
    android:viewportWidth="40" android:viewportHeight="40">
    <group android:translateX="-12" android:translateY="-11">
        <path android:fillColor="#FFFFFFFF" android:pathData="${path}"/>
    </group>
</vector>
`,
  );
  for (const dir of readdirSync(join(root, res)).filter((d) => d.startsWith("drawable"))) {
    const file = join(root, res, dir, "splash.png");
    if (!existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    await out(`${res}/${dir}/splash.png`, splash(width, height));
  }
}

// Mobile – iOS (only when generated with `cap add ios`)
const xcassets = "mobile/ios/App/App/Assets.xcassets";
if (existsSync(join(root, xcassets))) {
  await out(`${xcassets}/AppIcon.appiconset/AppIcon-512@2x.png`, sharp(await png(square, 1024)).flatten().png().toBuffer());
  for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    await out(`${xcassets}/Splash.imageset/${f}`, splash(2732, 2732));
  }
}

/** Brand gradient with the white bubble centred – used for launch screens. */
async function splash(width, height) {
  const size = Math.round(Math.min(width, height) * 0.28);
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" preserveAspectRatio="none" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="url(#g)"/></svg>`;
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="16 13 32 32">${bubble}</svg>`;
  return sharp(Buffer.from(bg))
    .resize(width, height)
    .composite([{ input: await sharp(Buffer.from(mark)).resize(size, size).png().toBuffer(), gravity: "center" }])
    .flatten()
    .png()
    .toBuffer();
}
