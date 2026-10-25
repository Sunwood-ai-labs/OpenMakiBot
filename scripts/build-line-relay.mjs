import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { pinnedResvgVersion } from "./prepare-duckdb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-line-relay");
const outputBundle = join(output, "line-relay.mjs");
const outputManifest = join(output, "artifact-manifest.json");
const scopeName = "@resvg";
const wrapperName = "resvg-js";
const requireFromProject = createRequire(import.meta.url);
const packageVersion = pinnedResvgVersion(root);

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectory(path, label) {
  const info = lstatIfExists(path);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a regular directory`);
}

function assertRegularFileTarget(path, label) {
  const info = lstatIfExists(path);
  if (info && (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)) throw new Error(`${label} must be an unlinked regular file`);
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("LINE relay artifact contains a symbolic link");
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error("LINE relay artifact contains an unsupported filesystem entry");
  }
  return files;
}

function packageManifest(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function addPackage(source, stagedPackages, version, expectedName) {
  walkFiles(source);
  const manifest = packageManifest(source);
  if (manifest.version !== version || manifest.name !== expectedName) {
    throw new Error(`LINE relay Resvg package pin mismatch for ${expectedName}`);
  }
  const existing = stagedPackages.get(manifest.name);
  if (existing && existing !== source) throw new Error(`LINE relay has conflicting Resvg package sources for ${manifest.name}`);
  stagedPackages.set(manifest.name, source);
}

function resolveResvgPackages() {
  requireFromProject("@resvg/resvg-js");
  const wrapperFile = realpathSync(requireFromProject.resolve("@resvg/resvg-js"));
  const wrapperDirectory = dirname(wrapperFile);
  const wrapperManifest = packageManifest(wrapperDirectory);
  if (wrapperManifest.version !== packageVersion || wrapperManifest.name !== `${scopeName}/${wrapperName}`) {
    throw new Error("LINE relay Resvg JavaScript package does not match the pinned version");
  }

  const loadedBindings = Object.keys(requireFromProject.cache).filter((path) => path.endsWith(".node") && /[\\/]@resvg[\\/]resvg-js-[^\\/]+[\\/]resvgjs\.[^\\/]+\.node$/i.test(path));
  if (loadedBindings.length !== 1) throw new Error("LINE relay could not identify exactly one loaded Resvg native binding");
  const nativeFile = realpathSync(loadedBindings[0]);
  const nativeDirectory = dirname(nativeFile);
  const nativeManifest = packageManifest(nativeDirectory);
  if (nativeManifest.version !== packageVersion || typeof nativeManifest.name !== "string" ||
      !nativeManifest.name.startsWith(`${scopeName}/${wrapperName}-`) || !isInside(nativeDirectory, nativeFile)) {
    throw new Error("LINE relay Resvg native binding does not match the pinned package");
  }
  if (!existsSync(nativeFile) || lstatSync(nativeFile).isSymbolicLink() || !lstatSync(nativeFile).isFile()) {
    throw new Error("LINE relay Resvg native binding is not a regular file");
  }

  const stagedPackages = new Map();
  addPackage(wrapperDirectory, stagedPackages, packageVersion, `${scopeName}/${wrapperName}`);
  addPackage(nativeDirectory, stagedPackages, packageVersion, nativeManifest.name);
  return { nativePackage: nativeManifest.name, stagedPackages };
}

function stagePackages(stagedPackages) {
  const modulesDirectory = join(output, "node_modules");
  const scopeDirectory = join(modulesDirectory, scopeName);
  assertDirectory(modulesDirectory, "LINE relay node_modules");
  assertDirectory(scopeDirectory, "LINE relay @resvg directory");
  mkdirSync(scopeDirectory, { recursive: true });

  for (const [name, source] of stagedPackages) {
    const unscopedName = name.slice(`${scopeName}/`.length);
    if (unscopedName.includes("/") || unscopedName.length === 0) throw new Error("LINE relay Resvg package name is invalid");
    const target = join(scopeDirectory, unscopedName);
    if (!isInside(output, target)) throw new Error("LINE relay package path escaped the artifact directory");
    assertDirectory(target, `LINE relay package ${name}`);
    if (lstatIfExists(target)) walkFiles(target);
    cpSync(source, target, { recursive: true, dereference: true, force: true });
  }
}

function expectedFiles(bundleFiles, stagedPackages) {
  const expected = new Set(["line-relay.mjs", "artifact-manifest.json"]);
  for (const path of bundleFiles) expected.add(relative(output, path).split(sep).join("/"));
  for (const [name, source] of stagedPackages) {
    const unscopedName = name.slice(`${scopeName}/`.length);
    for (const path of walkFiles(source)) {
      const packagePath = relative(source, path).split(sep).join("/");
      expected.add(`node_modules/${scopeName}/${unscopedName}/${packagePath}`);
    }
  }
  return expected;
}

async function main() {
  const { nativePackage, stagedPackages } = resolveResvgPackages();
  if (!isInside(root, output) || output === root) throw new Error("LINE relay output directory is invalid");
  assertDirectory(output, "LINE relay output");
  mkdirSync(output, { recursive: true });
  assertRegularFileTarget(outputBundle, "LINE relay bundle target");
  assertRegularFileTarget(outputManifest, "LINE relay manifest target");

  await build({
    entryPoints: [join(root, "scripts", "line-relay.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: outputBundle,
  });
  stagePackages(stagedPackages);

  const bundleFiles = [outputBundle];
  const allowedFiles = expectedFiles(bundleFiles, stagedPackages);
  const artifactFiles = walkFiles(output);
  const relativeFiles = artifactFiles.map((path) => relative(output, path).split(sep).join("/")).sort();
  for (const path of relativeFiles) {
    if (!allowedFiles.has(path)) throw new Error(`Unexpected file in LINE relay artifact: ${path}`);
  }
  for (const path of allowedFiles) {
    if (path !== "artifact-manifest.json" && !relativeFiles.includes(path)) {
      throw new Error(`Missing file in LINE relay artifact: ${path}`);
    }
  }

  const files = artifactFiles
    .filter((path) => path !== outputManifest)
    .map((path) => ({
      path: relative(output, path).split(sep).join("/"),
      bytes: lstatSync(path).size,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  writeFileSync(outputManifest, `${JSON.stringify({
    version: 1,
    platform: process.platform,
    arch: process.arch,
    resvgVersion: packageVersion,
    nativePackage,
    files,
  }, null, 2)}\n`, { flag: "w" });
  process.stdout.write(`Built LINE relay for ${process.platform}-${process.arch} with ${files.length} hashed files.\n`);
}

await main();
