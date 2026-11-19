import { rebuildIndex, codegraphStats, querySymbols } from "./src/index.js";

const root = "F:/develop/metaBase1.0/Meta-ZCode";
const t0 = Date.now();
const counts = rebuildIndex(root);
console.log("rebuild ms", Date.now() - t0);
console.log("counts", JSON.stringify(counts));
console.log("stats", JSON.stringify(await codegraphStats(root)));
const r = await querySymbols(root, { symbol: "createToolRegistry", direction: "inbound", limit: 5 }, { ensure: false });
console.log("symbols", JSON.stringify(r.symbols.map((s) => s.location)));
console.log("edges", JSON.stringify(r.edges.slice(0, 5).map((e) => `${e.from.filePath}:${e.from.line}`)));
