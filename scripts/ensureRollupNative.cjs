const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const IS_WIN_X64 = process.platform === "win32" && process.arch === "x64";

if (!IS_WIN_X64) {
  process.exit(0);
}

const projectRoot = process.cwd();
const nativeModuleDir = path.join(
  projectRoot,
  "node_modules",
  "@rollup",
  "rollup-win32-x64-msvc",
);

if (fs.existsSync(nativeModuleDir)) {
  process.exit(0);
}

function fail(message, error) {
  if (error) {
    console.error(`[ensureRollupNative] ${message}`, error);
  } else {
    console.error(`[ensureRollupNative] ${message}`);
  }
  process.exit(1);
}

const rollupPkgPath = path.join(projectRoot, "node_modules", "rollup", "package.json");
if (!fs.existsSync(rollupPkgPath)) {
  // Rollup is not installed yet; nothing to do.
  process.exit(0);
}

let rollupVersion = null;
try {
  rollupVersion = JSON.parse(fs.readFileSync(rollupPkgPath, "utf8")).version;
} catch (error) {
  fail("Could not read rollup version.", error);
}

if (!rollupVersion) {
  fail("Rollup version is missing.");
}

const nativeSpec = `@rollup/rollup-win32-x64-msvc@${rollupVersion}`;
const packResult = spawnSync("npm", ["pack", "--silent", nativeSpec], {
  cwd: projectRoot,
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (packResult.status !== 0) {
  fail(
    `Failed to download ${nativeSpec}.`,
    packResult.error || packResult.stderr || packResult.stdout,
  );
}

const tarballName = (packResult.stdout || "").trim().split(/\r?\n/).pop();
if (!tarballName) {
  fail(`Could not resolve tarball filename for ${nativeSpec}.`);
}

const tarballPath = path.join(projectRoot, tarballName);
const installResult = spawnSync(
  "npm",
  ["install", "--no-save", "--ignore-scripts", tarballPath],
  {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

try {
  if (fs.existsSync(tarballPath)) {
    fs.unlinkSync(tarballPath);
  }
} catch {
  // Best effort cleanup only.
}

if (installResult.status !== 0) {
  fail(`Failed to install ${nativeSpec} from tarball.`);
}

if (!fs.existsSync(nativeModuleDir)) {
  fail(`Installed ${nativeSpec}, but module directory is still missing.`);
}

console.log(`[ensureRollupNative] Installed ${nativeSpec}.`);
