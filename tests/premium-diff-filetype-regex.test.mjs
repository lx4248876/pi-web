import { readFileSync } from "fs";
const src = readFileSync("components/PremiumDiffViewer.tsx", "utf8");
const lines = src.split("\n");
const htmlLine = lines.find((l) => /const isHtml\s*=/.test(l));
const mdLine = lines.find((l) => /const isMarkdown\s*=/.test(l));
const reFrom = (line) => {
  const lit = line.match(/\/.*\/[a-zA-Z]*/)[0];
  // strip trailing flags to get pattern body
  const m = lit.match(/^\/(.*)\/([a-z]*)$/s);
  return { re: new RegExp(m[1], m[2]), body: m[1] };
};
const { re: reHtml, body: bHtml } = reFrom(htmlLine);
const { re: reMd, body: bMd } = reFrom(mdLine);
console.log("html pattern body:", JSON.stringify(bHtml), "md:", JSON.stringify(bMd));

const cases = [
  ["x.html", [true, false]],
  ["dir/file.htm", [true, false]],
  ["docs/project-map.md", [false, true]],
  ["README.md", [false, true]],
  ["app/page.tsx", [false, false]],
  ["x.html?q", [true, false]],
];
let pass = 0, fail = 0;
for (const [p, [eh, em]] of cases) {
  const ah = reHtml.test(p.split("?")[0]);
  const am = reMd.test(p.split("?")[0]);
  const ok = ah === eh && am === em;
  ok ? pass++ : fail++;
  if (!ok) console.log("FAIL", JSON.stringify(p), "got", ah, am, "want", eh, em);
}
console.log(`result: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);