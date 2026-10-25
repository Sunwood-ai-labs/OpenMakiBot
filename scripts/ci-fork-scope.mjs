import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { vitestMatrix } from "./ci-scope.mjs";

const platforms = ["macos-latest", "ubuntu-latest", "windows-latest"];
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error("GITHUB_OUTPUT is required");

const matrix = vitestMatrix(platforms);
const forkMatrix = {
  ...matrix,
  include: matrix.include.map((entry) => ({
    ...entry,
    runner: entry.os === "ubuntu-latest" ? "ubuntu-24.04" : entry.os,
  })),
};
const androidSource = existsSync(resolve("android"));
const iosSource = existsSync(resolve("ios"));
appendFileSync(
  output,
  `vitest_os=${JSON.stringify(platforms)}\nvitest_matrix=${JSON.stringify(forkMatrix)}\nandroid_source=${androidSource}\nios_source=${iosSource}\n`,
);
