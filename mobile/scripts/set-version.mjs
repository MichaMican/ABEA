#!/usr/bin/env node
// Stamps a semantic version into the native mobile projects.
//   node scripts/set-version.mjs <version> [buildNumber]
// Defaults: ABEA_VERSION_NAME / ABEA_VERSION_CODE. Android reads those env vars directly in
// app/build.gradle; iOS needs them written into the Xcode project.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2] || process.env.ABEA_VERSION_NAME;
const build = process.argv[3] || process.env.ABEA_VERSION_CODE || "1";
const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
if (!match) {
  console.error(`Invalid semantic version: ${version ?? "(none)"}`);
  process.exit(1);
}
if (!/^\d+$/.test(build)) {
  console.error(`Invalid build number: ${build}`);
  process.exit(1);
}
// App Store versions must be numeric; the prerelease suffix is kept in package.json and the app.
const marketing = `${match[1]}.${match[2]}.${match[3]}`;

const pkgUrl = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, "utf8"));
pkg.version = version;
writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + "\n");

const pbxUrl = new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url);
const pbx = readFileSync(pbxUrl, "utf8")
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketing};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
writeFileSync(pbxUrl, pbx);

console.log(`ABEA mobile version ${version} (iOS ${marketing}, build ${build})`);
