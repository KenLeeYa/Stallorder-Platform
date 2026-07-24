import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const sourceRoot = path.join(process.cwd(), "src");
const files = [];
const issues = [];

function collectTsxFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectTsxFiles(fullPath);
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
}

function getAttribute(node, name) {
  return node.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function getLiteralAttribute(node, name) {
  const attribute = getAttribute(node, name);
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function report(sourceFile, node, code, message) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const relativePath = path.relative(process.cwd(), sourceFile.fileName);
  issues.push(`${relativePath}:${line + 1} [${code}] ${message}`);
}

function inspectElement(sourceFile, node) {
  if (!ts.isIdentifier(node.tagName)) {
    return;
  }

  const tagName = node.tagName.text;

  if (tagName === "input") {
    const inputType = getLiteralAttribute(node, "type");

    if (!getAttribute(node, "type")) {
      report(sourceFile, node, "input-type", "Input requires an explicit type.");
      return;
    }

    if (
      ["text", "search", "email", "tel", "url", "password"].includes(
        inputType ?? "",
      ) &&
      !getAttribute(node, "readOnly") &&
      !getAttribute(node, "maxLength")
    ) {
      report(
        sourceFile,
        node,
        "input-length",
        `${inputType} input requires maxLength.`,
      );
    }

    if (
      inputType === "number" &&
      (!getAttribute(node, "min") || !getAttribute(node, "max"))
    ) {
      report(
        sourceFile,
        node,
        "input-range",
        "Number input requires both min and max.",
      );
    }
  }

  if (
    tagName === "textarea" &&
    !getAttribute(node, "readOnly") &&
    !getAttribute(node, "maxLength")
  ) {
    report(
      sourceFile,
      node,
      "textarea-length",
      "Textarea requires maxLength.",
    );
  }

  if (tagName === "button" && !getAttribute(node, "type")) {
    report(
      sourceFile,
      node,
      "button-type",
      "Button requires an explicit type.",
    );
  }
}

collectTsxFiles(sourceRoot);

for (const file of files) {
  const sourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      inspectElement(sourceFile, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (issues.length > 0) {
  console.error(issues.join("\n"));
  console.error(`UI control audit failed with ${issues.length} issue(s).`);
  process.exit(1);
}

console.log(`UI control audit passed for ${files.length} TSX files.`);
