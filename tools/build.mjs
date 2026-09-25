// Bundles the state helper into the workflow skill:
// skills/workflow/scripts/qrspi-state.mjs (committed).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "esbuild";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

function sourceHash() {
    const source = new URL("./src/", import.meta.url).pathname;
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

await build({
    entryPoints: [new URL("./src/state/cli.ts", import.meta.url).pathname],
    outfile: new URL(
        "../skills/workflow/scripts/qrspi-state.mjs",
        import.meta.url,
    ).pathname,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    define: {
        __QRSPI_VERSION__: JSON.stringify(pkg.version),
        __QRSPI_BUILD_HASH__: JSON.stringify(sourceHash()),
    },
    legalComments: "none",
    logLevel: "warning",
});
