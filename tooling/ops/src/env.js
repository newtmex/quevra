import { readFile } from "node:fs/promises";

export function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === "'" || quote === '"') && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\(n|r|t|\\|\")/g, (_, escaped) => ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' })[escaped]);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export async function loadEnvFile(path, target = process.env) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const [key, value] of Object.entries(parseEnv(source))) {
    if (target[key] === undefined) target[key] = value;
  }
}
