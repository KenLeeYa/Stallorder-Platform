import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";

/** Only checkout newline conversion is equivalent; all other bytes remain significant. */
export const baselineContentHash = (source) => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");

function hasDirective(ast, directive) {
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

export function sourceFiles(root, directory, includeEvidenceSource = false) {
  const base = join(root, directory);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", "dist", ".git"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(root, path, includeEvidenceSource) : (includeEvidenceSource ? /\.(?:[cm]?js|tsx?|json|sql|toml|ya?ml)$/u : /\.(?:[cm]?js|tsx?)$/u).test(path) && (includeEvidenceSource || !/\.(?:test|spec)\./u.test(path)) ? [path.replaceAll("\\", "/")] : [];
  });
}

/** Follow actual static runtime imports from client/native/shared entrypoints. Type imports are erased. */
export function scanBoundaries(root) {
  const files = ["src", "apps/mobile", "packages"].flatMap((path) => sourceFiles(root, path));
  const sources = new Map(files.map((file) => [resolve(root, file), readFileSync(join(root, file), "utf8")]));
  const asts = new Map([...sources].map(([path, source]) => [path, ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)]));
  const findings = [];
  // Expo configuration/plugins run during builds, but remain in the graph so runtime imports are checked.
  const entries = files.filter((file) => hasDirective(asts.get(resolve(root, file)), "use client")
    || (file.startsWith("apps/mobile/") && !/^apps\/mobile\/(?:app\.config\.[cm]?[jt]s|plugins\/)/u.test(file))
    || file.startsWith("packages/"));
  const checked = new Set();
  const visit = (path, entry) => {
    const visitKey = `${entry}:${path}`;
    if (checked.has(visitKey)) return;
    checked.add(visitKey);
    const source = sources.get(path);
    if (!source) return;
    // Next server actions are compiled RPC references; their server dependency graph stays server-owned.
    const ast = asts.get(path);
    if (hasDirective(ast, "use server") && !entry.startsWith("apps/") && !entry.startsWith("packages/")) return;
    const add = (classification) => findings.push({ entry, path: relative(root, path).replaceAll("\\", "/"), classification });
    const walk = (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly
        && !(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name && node.importClause.namedBindings.elements.every((item) => item.isTypeOnly))) specifier = node.moduleSpecifier.text;
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) specifier = node.moduleSpecifier?.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        if (/^(?:server-only|@prisma\/client|node:(?:fs|crypto|child_process|net|tls)|openai)(?:$|\/)/u.test(specifier)) add("SERVER_DEPENDENCY_IN_CLIENT");
        if (/^(?:posthog-js|@posthog\/react|@openreplay\/tracker|@formbricks\/js)(?:$|\/)/u.test(specifier)) add("UNAPPROVED_VENDOR_COLLECTION");
        const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(path), specifier) : null;
        if (base) {
          const target = [base, ...[".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"].map((extension) => base + extension)].find((candidate) => sources.has(candidate));
          if (target) visit(target, entry);
        }
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const text = node.getText(ast);
        const envName = /process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/u.exec(text);
        const name = envName?.[1] ?? envName?.[2];
        if (name && /(?:SECRET|PASSWORD|SERVICE_ROLE|PRIVATE_KEY|ACCESS_TOKEN)/u.test(name)) add("SECRET_ENV_IN_CLIENT");
        if (name?.startsWith("NEXT_PUBLIC_") && /(?:SECRET|PASSWORD|SERVICE_ROLE|PRIVATE_KEY|ACCESS_TOKEN)/u.test(name)) add("PUBLIC_SECRET_PREFIX");
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
  };
  for (const entry of entries) visit(resolve(root, entry), entry);
  const baselinePath = join(root, "scripts/awesome-optimization/boundary-baseline.json");
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : [];
  const baselineDebt = findings.filter((finding) => baseline.some((record) => record.entry === finding.entry && record.path === finding.path && record.classification === finding.classification
    && Object.entries(record.sourceHashes).every(([path, hash]) => existsSync(join(root, path)) && baselineContentHash(readFileSync(join(root, path), "utf8")) === hash)));
  return { scope: "new/changed static client/native/shared edges; exact hashed baseline debt remains open; server-action RPC references excluded; runtime auth remains separately tested", entries: entries.length, checkedVisits: checked.size,
    findings: findings.filter((finding) => !baselineDebt.includes(finding)), baselineDebt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanBoundaries(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length ? 1 : 0;
}
