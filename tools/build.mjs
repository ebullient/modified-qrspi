// Bundles the state helper into the publishable build output:
// tools/dist/qrspi-x.mjs (generated output).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

function sourceHash() {
    const source = fileURLToPath(new URL("./src/", import.meta.url));
    const files = [];
    const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort(
            (a, b) => a.name.localeCompare(b.name),
        )) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) visit(path);
            else files.push(path);
        }
    };
    visit(source);
    const hash = createHash("sha256");
    for (const path of files) {
        hash.update(`${relative(source, path)}\0`);
        hash.update(readFileSync(path));
    }
    return hash.digest("hex");
}

function localVersion() {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: new URL(".", import.meta.url),
        encoding: "utf8",
    }).trim();
    const dirty = execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        { cwd: new URL(".", import.meta.url), encoding: "utf8" },
    ).trim();
    return `${pkg.version}+g${sha}${dirty === "" ? "" : ".dirty"}`;
}

const buildVersion =
    process.env.CI === "true"
        ? (process.env.QRSPI_BUILD_VERSION ?? pkg.version)
        : localVersion();
const buildHash = sourceHash();

await build({
    entryPoints: [
        fileURLToPath(new URL("./src/state/bin.ts", import.meta.url)),
    ],
    outfile: fileURLToPath(new URL("./dist/qrspi-x.mjs", import.meta.url)),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    define: {
        __QRSPI_VERSION__: JSON.stringify(buildVersion),
        __QRSPI_BUILD_HASH__: JSON.stringify(buildHash),
    },
    banner: { js: `// QRSPI_BUILD_HASH: ${buildHash}` },
    legalComments: "none",
    logLevel: "warning",
});
