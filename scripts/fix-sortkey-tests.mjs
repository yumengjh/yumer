import fs from "node:fs";
import path from "node:path";

const replacements = [
  ['"004000"', "SK4"],
  ['"003000"', "SK3"],
  ['"002000"', "SK2"],
  ['"001000"', "SK0"],
  ['"000998"', "SK0"],
  ['"001998"', "SK1"],
  ['"002998"', "SK2"],
  ['"003998"', "SK3"],
  ['"001750"', "SK1"],
  ['"002750"', "SK2"],
  ['"003750"', "SK3"],
  ['"004750"', "SK4"],
  ['"005750"', "SK5"],
  ['"027000"', "SK0"],
  ['"027500"', "SK1"],
];

const header = `import { assertSortKeyBetween, compareSortKeys, createCanonicalSortKey, SK0, SK1, SK2, SK3, SK4 } from "./test-sort-key";
const SK5 = createCanonicalSortKey(4);
`;

const files = [
  "src/services/sync/__tests__/engine-order.test.ts",
  "src/services/sync/__tests__/snapshot.test.ts",
];

for (const file of files) {
  const full = path.join(process.cwd(), file);
  let content = fs.readFileSync(full, "utf8");
  if (!content.includes("test-sort-key")) {
    content = content.replace(/^(import[^\n]+\n)/, `$1${header}`);
  }
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(full, content);
}

console.log("done");
