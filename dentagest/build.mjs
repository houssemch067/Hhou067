// Assemble build/index.html : application d'origine + module « Cloud du cabinet »
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
let html = readFileSync(dir + "src/app.html", "utf8");
const cloud = readFileSync(dir + "src/cloud.js", "utf8");
const css = readFileSync(dir + "src/cloud.css", "utf8");

const BOOT = "Store.init().then(()=>{ui.ready=true;render();licStart()});";
if (html.split(BOOT).length !== 2) throw new Error("Point d'insertion introuvable dans app.html");
html = html.replace(BOOT, () => cloud + "\nStore.init().then(()=>Cloud.boot()).then(()=>{ui.ready=true;render();licStart()});");

const STYLE_END = html.indexOf("</style>");
if (STYLE_END < 0) throw new Error("</style> introuvable");
html = html.slice(0, STYLE_END) + css + html.slice(STYLE_END);

// Le stockage côté navigateur (IndexedDB) ne doit pas contenir la mention « hors connexion seulement »
html = html.replace("Vos données restent sur votre appareil.", "Vos données restent sur votre appareil, ou dans le cloud chiffré du cabinet si vous l’activez.");

mkdirSync(dir + "build", { recursive: true });
writeFileSync(dir + "build/index.html", html);
// Fichiers statiques intégrés au worker (icônes, polices, jsPDF, manifeste, service worker)
const files = [];
const walk = (d) => readdirSync(dir + d).forEach((f) => { const p = d + "/" + f; statSync(dir + p).isDirectory() ? walk(p) : files.push(p.slice("public/".length)); });
walk("public");
files.sort();
// copie avec une extension neutre : .txt (texte) ou .bin (binaire), pour que le bundler ne les interprète pas
mkdirSync(dir + "build/static", { recursive: true });
const name = (f, i) => "static/" + i + (/\.(png|woff2)$/.test(f) ? ".bin" : ".txt");
files.forEach((f, i) => copyFileSync(dir + "public/" + f, dir + "build/" + name(f, i)));
writeFileSync(dir + "build/assets.js", files.map((f, i) => `import a${i} from "./${name(f, i)}";`).join("\n") +
  "\nexport default {\n" + files.map((f, i) => `  ${JSON.stringify("/" + f)}: a${i},`).join("\n") + "\n};\n");
console.log("build/index.html", (html.length / 1024).toFixed(0) + " Ko");
