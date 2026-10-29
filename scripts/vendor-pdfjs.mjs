import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const target = new URL("../extension/vendor/pdfjs/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "cmaps", "standard_fonts", "wasm", "iccs", "LICENSE"]) {
  await cp(new URL(name, source), new URL(name, target), { recursive: true });
}
const { version } = JSON.parse(await readFile(new URL("package.json", source), "utf8"));
await writeFile(new URL("VERSION", target), `${version}\n`);
console.log(`Bundled PDF.js ${version} in ${fileURLToPath(target)}`);
