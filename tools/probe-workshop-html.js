import fs from 'node:fs';
const h = fs.readFileSync('tmp-workshop.html', 'utf8');
const patterns = [
  /publishedfileid\\":(\d+)/g,
  /"publishedfileid":(\d+)/g,
  /filedetails\/\?id=(\d+)/g,
];
for (const re of patterns) {
  const all = [...h.matchAll(re)];
  console.log(re.source, all.length, all.slice(0, 5).map((m) => m[1]));
}
