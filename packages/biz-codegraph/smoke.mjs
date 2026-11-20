import { rebuildIndex, codegraphStats, querySymbols } from "./src/index.js";

const root = "F:/develop/metaBase1.0/Meta-ZCode";
let t0 = Date.now();
const counts = await rebuildIndex(root);
console.log("rebuild ms", Date.now() - t0);
console.log("counts", JSON.stringify(counts));
t0 = Date.now();
console.log("stats", JSON.stringify(await codegraphStats(root)));
console.log("stats ms", Date.now() - t0);
t0 = Date.now();
// 首次符号查询：懒算精确边（含语言服务首次建 program），之后命中缓存
const r1 = await querySymbols(root, { symbol: "createToolRegistry", direction: "inbound", limit: 5 });
console.log("first query ms", Date.now() - t0);
console.log("symbols", JSON.stringify(r1.symbols.map((s) => s.location)));
console.log("edges", JSON.stringify(r1.edges.slice(0, 5).map((e) => `${e.from.filePath}:${e.from.line}`)));
t0 = Date.now();
const r2 = await querySymbols(root, { symbol: "createToolRegistry", direction: "inbound", limit: 5 });
console.log("cached query ms", Date.now() - t0);
console.log("cached edges same", r2.edges.length === r1.edges.length);
