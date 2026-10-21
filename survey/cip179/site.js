#!/usr/bin/env node
// Builds the survey site: the page in `site/`, with one survey baked in.
//
//   node cip179/site.js [--survey <dir>] [--out <dir>] [--offline | --unpublished]
//
// Options:
//   --survey <dir>   the files written by `build.js --out` (default: cip179/2026)
//   --out <dir>      where the site is written (default: dist)
//   --offline        don't read the published survey
//   --unpublished    a survey not published yet, to try it locally
//
// The network and the survey's reference are the sponsor's, from the vars of
// `wrangler.jsonc`: the page and the sponsor can't disagree. The Turnstile
// site key comes from there too. The definition must be the one published at
// that reference, which is read from Koios: a page showing other questions
// would record answers to the wrong ones.
//
// With `--unpublished`, the definition isn't checked, and the page doesn't
// send answers to the sponsor: it only shows the survey.

import * as Transaction from "@evolution-sdk/evolution/Transaction";
import { decodeMetadata } from "cip-179";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import { fromDetailedJson } from "./metadatum.js";
import { epochAt } from "./network.js";

const { values: args } = parseArgs({
  options: {
    survey: { type: "string", default: "cip179/2026" },
    out: { type: "string", default: "dist" },
    offline: { type: "boolean", default: false },
    unpublished: { type: "boolean", default: false },
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const read = (file) => {
  const path = join(args.survey, file);
  if (!existsSync(path)) {
    fail(`${path} is missing: yarn cip179 --survey ${join(args.survey, "survey.json")} --owner <key hash> --end-epoch <epoch> --out ${args.survey} writes it`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

const { SPONSOR_NETWORK: network, SPONSOR_KOIOS: koios, SPONSOR_SURVEY: survey, TURNSTILE_SITE_KEY: turnstileSiteKey } = wranglerVars();
const [, txId, index] = /^([0-9a-f]{64})#(\d+)$/.exec(survey ?? "") ?? [];
if (!txId) fail(`SPONSOR_SURVEY isn't "<tx id>#<index>": ${survey}`);
if (!turnstileSiteKey) fail("wrangler.jsonc has no TURNSTILE_SITE_KEY");

const metadata = read("definition.metadata.json");
const { definitions } = decodeMetadata(new Map([[17n, fromDetailedJson(metadata[17])]]));
if (definitions?.length !== 1) fail(`${args.survey}/definition.metadata.json must hold one survey definition`);
const [definition] = definitions;
if (!args.offline && !args.unpublished) await checkPublished();
// A survey not published yet has no reference: one made from its definition
// keeps the browser's respondent key and answers for it apart.
const reference = args.unpublished ? `${createHash("sha256").update(JSON.stringify(metadata[17])).digest("hex")}#0` : survey;

// The page only has texts in some languages: the survey's other translations
// would never show.
const languages = readdirSync(join(site, "texts")).map((file) => basename(file, ".js"));
const { conditions, translations, noneLabels, maxTextBytes, screening } = read("widget.json");
const baked = {
  network,
  survey: reference,
  unpublished: args.unpublished,
  turnstileSiteKey,
  definition: metadata[17],
  conditions,
  noneLabels,
  translations: {
    ...translations,
    translations: Object.fromEntries(Object.entries(translations.translations).filter(([tag]) => languages.includes(tag))),
  },
  maxTextBytes,
  // The answers that end the survey before its form, in each language.
  exits: screening.flatMap(({ labels }) => labels),
};

rmSync(args.out, { recursive: true, force: true });
// Everything but the scripts is served as it is.
cpSync(site, args.out, { recursive: true, filter: (file) => !file.endsWith(".js") && basename(file) !== "texts" });
await build({
  entryPoints: [join(site, "main.js")],
  outdir: args.out,
  bundle: true,
  format: "esm",
  // The widget's code for sealed surveys stays in chunks the page never loads.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
  plugins: [
    {
      name: "built-survey",
      setup({ onResolve, onLoad }) {
        onResolve({ filter: /^built-survey$/ }, () => ({ path: "built-survey", namespace: "built" }));
        onLoad({ filter: /.*/, namespace: "built" }, () => ({ contents: JSON.stringify(baked), loader: "json" }));
      },
    },
  ],
});

const open = Number(definition.endEpoch) - epochAt(network) + 1;
console.log(`${definition.title}: ${definition.questions.length} questions, ${args.unpublished ? "not published" : survey} on ${network}`);
if (args.unpublished) console.log("answers can't be published from this build: it is to try the survey");
console.log(open > 0 ? `open for ${open} more epoch${open > 1 ? "s" : ""}, to the end of epoch ${definition.endEpoch}` : `closed since epoch ${definition.endEpoch}`);
console.log(`languages: ${[translations.defaultLanguage, ...Object.keys(baked.translations.translations)].join(", ")}`);
console.log(`written to ${args.out}:`);
for (const file of files(args.out)) {
  const bytes = readFileSync(file);
  const text = /\.(js|css|html|svg|json)$/.test(file);
  console.log(`  ${relative(args.out, file).padEnd(40)} ${kb(bytes.length)}${text ? `, ${kb(gzipSync(bytes).length)} gzipped` : ""}`);
}

// ----------------------------------------------------------------------------

/** The `vars` of wrangler.jsonc, whose comments are dropped outside strings. */
function wranglerVars() {
  const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm, (_, string) => string ?? "")).vars;
}

/** Stops unless the definition is the one published as SPONSOR_SURVEY. */
async function checkPublished() {
  const res = await fetch(`${koios.replace(/\/$/, "")}/tx_cbor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _tx_hashes: [txId] }),
  }).catch((error) => fail(`Koios can't be reached (${error.cause?.message ?? error.message}); --offline skips this check`));
  if (!res.ok) fail(`Koios tx_cbor: ${res.status} ${await res.text()}`);
  const [row] = await res.json();
  if (!row) fail(`the survey transaction ${txId} isn't on ${network}`);
  const published = Transaction.fromCBORHex(row.cbor).auxiliaryData?.metadata?.get(17n);
  const onChain = published && decodeMetadata(new Map([[17n, published]])).definitions?.[Number(index)];
  if (!onChain) fail(`no survey definition at ${survey}`);
  if (isDeepStrictEqual(onChain, definition)) return;
  const differing = Object.keys({ ...onChain, ...definition }).filter((key) => !isDeepStrictEqual(onChain[key], definition[key]));
  fail(`${args.survey}/definition.metadata.json isn't the survey published as ${survey}: ${differing.join(", ")} differ`);
}

function files(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
