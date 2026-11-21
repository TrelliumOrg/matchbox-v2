// What a Worker entry module may export. The Workers runtime treats every
// export of the module named in a wrangler config's `main` as a handler or
// a class (Durable Object, Workflow, named entrypoint), and refuses to start
// on anything else: `wrangler dev` stops with "Incorrect type for map entry
// 'x': the provided value is not of type 'function or ExportedHandler'".
// The default export is the handler; every named export must be a class or
// a function. Constants, objects and enums belong in a sibling module.
//
// A static reading, not a parser: it relies on Biome's formatting (top-level
// statements start in column 0) and follows re-exports through relative
// paths and workspace packages. A re-export it cannot follow is reported, so
// a gap fails loudly instead of passing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/** JSONC to JSON: drops line and block comments outside strings. */
export function stripJsonComments(text) {
  let out = ""
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char
      if (char === "\\") {
        out += next ?? ""
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
    } else if (char === '"') {
      inString = true
      out += char
      index += 1
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

/** Every `main` in a wrangler config, top level and per environment. */
export function configMains(text) {
  const config = JSON.parse(stripJsonComments(text))
  const mains = []
  if (typeof config.main === "string") {
    mains.push({ where: "default", main: config.main })
  }
  for (const [name, section] of Object.entries(config.env ?? {})) {
    if (typeof section?.main === "string") {
      mains.push({ where: `env.${name}`, main: section.main })
    }
  }
  return mains
}

/**
 * Top-level statements that start with `export` or `import`, each with the
 * indented lines that continue it. Lines inside a block comment are skipped.
 */
export function topLevelStatements(source) {
  const lines = source.split(/\r?\n/)
  const statements = []
  let inComment = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (inComment) {
      if (trimmed.includes("*/")) inComment = false
      continue
    }
    if (trimmed.startsWith("/*")) {
      inComment = !trimmed.includes("*/")
      continue
    }
    if (!/^(export|import)\b/.test(line)) continue
    let text = line
    while (
      index + 1 < lines.length &&
      /^(\s|[}\])])/.test(lines[index + 1]) &&
      !/^(export|import)\b/.test(lines[index + 1])
    ) {
      index += 1
      text += `\n${lines[index]}`
    }
    statements.push(text)
  }
  return statements
}

const identifier = "[A-Za-z_$][\\w$]*"

/** Whether a variable initializer is a function or arrow function. */
export function isFunctionInitializer(initializer) {
  const text = initializer.trim()
  if (/^(async\s+)?function\b/.test(text)) return true
  if (new RegExp(`^(async\\s+)?${identifier}\\s*=>`).test(text)) return true
  const arrow = /^(async\s*)?(<[^>]*>\s*)?\(/.exec(text)
  if (arrow === null) return false
  // Find the parenthesis that closes the parameter list, then `=>`.
  let depth = 0
  for (let index = arrow[0].length - 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth === 0) {
        const rest = text.slice(index + 1)
        return /^\s*(:[^=]*?(=>[^=]*?)?)?\s*=>/.test(rest)
      }
    }
  }
  return false
}

/** `a, b as c, type D, default as E` to `{ local, exported }` pairs. */
function specifiers(list) {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("type "))
    .map((part) => {
      const [local, exported] = part.split(/\s+as\s+/)
      return { local: local.trim(), exported: (exported ?? local).trim() }
    })
}

function fromClause(text) {
  return /\bfrom\s+["']([^"']+)["']/.exec(text)?.[1] ?? null
}

/**
 * Reads a module's own declarations and its export statements.
 * `exports`: exported name to how to find its kind. `locals`: declared
 * names to their kind. `imports`: imported local names to their source.
 */
export function readModule(source) {
  const exports = new Map()
  const locals = new Map()
  const imports = new Map()
  const stars = []
  for (const statement of topLevelStatements(source)) {
    const flat = statement.replace(/\s+/g, " ").trim()
    if (flat.startsWith("import ")) {
      if (/^import type\b/.test(flat)) continue
      const from = fromClause(flat)
      if (from === null) continue
      const named = /\{([^}]*)\}/.exec(flat)
      for (const { local, exported } of specifiers(named?.[1] ?? "")) {
        imports.set(exported, { from, name: local })
      }
      const head = new RegExp(`^import (${identifier})\\s*(,|from)`).exec(flat)
      if (head !== null) imports.set(head[1], { from, name: "default" })
      continue
    }
    const body = flat.slice("export ".length)
    if (/^(type|interface|declare)\b/.test(body)) continue
    if (body.startsWith("default ")) {
      exports.set("default", { kind: "handler" })
      continue
    }
    const declared = new RegExp(
      `^(?:(abstract)\\s+)?(class|(?:async\\s+)?function\\*?|const\\s+enum|enum|const|let|var)\\s+(${identifier})`,
    ).exec(body)
    if (declared !== null) {
      const [, , keyword, name] = declared
      let kind = "value"
      if (keyword === "class") kind = "class"
      else if (keyword.includes("function")) kind = "function"
      else if (/^(const|let|var)$/.test(keyword)) {
        const initializer = /=(?!>)([\s\S]*)$/.exec(
          body.slice(declared[0].length),
        )
        if (initializer !== null && isFunctionInitializer(initializer[1])) {
          kind = "function"
        }
      }
      exports.set(name, { kind })
      continue
    }
    if (body.startsWith("* as ")) {
      const name = new RegExp(`^\\* as (${identifier})`).exec(body)?.[1]
      exports.set(name ?? "*", { kind: "value", detail: "namespace object" })
      continue
    }
    if (body.startsWith("* ")) {
      const from = fromClause(body)
      if (from !== null) stars.push(from)
      continue
    }
    const list = /^\{([^}]*)\}/.exec(body)
    if (list !== null) {
      const from = fromClause(body)
      for (const { local, exported } of specifiers(list[1])) {
        exports.set(exported, from === null ? { local } : { from, name: local })
      }
      continue
    }
    exports.set(body.split(/\s/)[0] ?? body, {
      kind: "unknown",
      detail: "unrecognised export statement",
    })
  }
  // Declarations that are not exported, for `export { name }`.
  const declaration = new RegExp(
    `^(?:(?:export|declare)\\s+)?(?:abstract\\s+)?(class|(?:async\\s+)?function\\*?|const|let|var|enum)\\s+(${identifier})([\\s\\S]*)$`,
  )
  for (const statement of source.split(/\r?\n(?=\S)/)) {
    const found = declaration.exec(statement.trim())
    if (found === null) continue
    const [, keyword, name, rest] = found
    let kind = "value"
    if (keyword === "class") kind = "class"
    else if (keyword.includes("function")) kind = "function"
    else if (keyword !== "enum") {
      const initializer = /=(?!>)([\s\S]*)$/.exec(rest)
      if (initializer !== null && isFunctionInitializer(initializer[1])) {
        kind = "function"
      }
    }
    if (!locals.has(name)) locals.set(name, kind)
  }
  return { exports, locals, imports, stars }
}

function readPackage(directory) {
  const file = path.join(directory, "package.json")
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8"))
}

/** Workspace package names to their directories. */
export function workspacePackages(repoRoot) {
  const packages = new Map()
  for (const group of ["apps", "packages"]) {
    const root = path.join(repoRoot, group)
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = path.join(root, entry.name)
      const manifest = readPackage(directory)
      if (typeof manifest?.name === "string") {
        packages.set(manifest.name, { directory, manifest })
      }
    }
  }
  return packages
}

function exportTarget(target) {
  if (typeof target === "string") return target
  if (target === null || typeof target !== "object") return null
  for (const condition of ["workerd", "worker", "import", "default"]) {
    const found = exportTarget(target[condition])
    if (found !== null) return found
  }
  return null
}

function asFile(candidate) {
  const stem = candidate.replace(/\.(m?js|jsx)$/, "")
  for (const option of [
    candidate,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
  ]) {
    if (existsSync(option) && statSync(option).isFile()) return option
  }
  return null
}

/** A module specifier to a source file, or null when it cannot follow it. */
export function resolveSpecifier(specifier, fromFile, packages) {
  if (specifier.startsWith(".")) {
    return asFile(path.resolve(path.dirname(fromFile), specifier))
  }
  const parts = specifier.split("/")
  const nameLength = specifier.startsWith("@") ? 2 : 1
  const name = parts.slice(0, nameLength).join("/")
  const workspace = packages.get(name)
  if (workspace === undefined) return null
  const subpath = [".", ...parts.slice(nameLength)].join("/")
  const map = workspace.manifest.exports
  const target =
    typeof map === "string" && subpath === "."
      ? map
      : exportTarget(map?.[subpath] ?? null)
  if (target === null) return null
  return asFile(path.resolve(workspace.directory, target))
}

/** Resolves every export of a module to a kind, following re-exports. */
export function moduleExports(file, packages, cache = new Map()) {
  const cached = cache.get(file)
  if (cached !== undefined) return cached
  const resolved = new Map()
  cache.set(file, resolved)
  const module = readModule(readFileSync(file, "utf8"))

  function follow(from, name) {
    const target = resolveSpecifier(from, file, packages)
    if (target === null) {
      return { kind: "unknown", detail: `cannot follow "${from}"` }
    }
    const found = moduleExports(target, packages, cache).get(name)
    if (found === undefined) {
      return { kind: "unknown", detail: `"${name}" not found in "${from}"` }
    }
    return found
  }

  for (const from of module.stars) {
    const target = resolveSpecifier(from, file, packages)
    if (target === null) {
      resolved.set(`* from ${from}`, {
        kind: "unknown",
        detail: `cannot follow "${from}"`,
      })
      continue
    }
    for (const [name, kind] of moduleExports(target, packages, cache)) {
      if (name !== "default") resolved.set(name, kind)
    }
  }
  for (const [name, entry] of module.exports) {
    if ("kind" in entry) {
      resolved.set(name, entry)
    } else if ("from" in entry) {
      resolved.set(name, follow(entry.from, entry.name))
    } else {
      const imported = module.imports.get(entry.local)
      const local = module.locals.get(entry.local)
      if (imported !== undefined) {
        resolved.set(name, follow(imported.from, imported.name))
      } else if (local !== undefined) {
        resolved.set(name, { kind: local })
      } else {
        resolved.set(name, {
          kind: "unknown",
          detail: `no declaration of "${entry.local}"`,
        })
      }
    }
  }
  return resolved
}

/** Named exports the Workers runtime would refuse, with the reason. */
export function entryProblems(file, packages, cache = new Map()) {
  const problems = []
  for (const [name, entry] of moduleExports(file, packages, cache)) {
    if (name === "default") continue
    if (entry.kind === "class" || entry.kind === "function") continue
    problems.push({
      name,
      kind: entry.kind,
      detail: entry.detail ?? null,
    })
  }
  return problems
}

/** `@scope/pkg/entry` or `pkg/entry`, as opposed to a path to a file. */
export function isPackageSpecifier(main) {
  if (main.startsWith(".") || main.startsWith("/")) return false
  return main.startsWith("@") || !/\.[cm]?[jt]sx?$/.test(main)
}

/** Every Worker entry module named by a wrangler config under apps/. */
export function workerEntries(repoRoot) {
  const entries = []
  const appsRoot = path.join(repoRoot, "apps")
  for (const app of readdirSync(appsRoot, { withFileTypes: true })) {
    if (!app.isDirectory()) continue
    const directory = path.join(appsRoot, app.name)
    for (const config of readdirSync(directory)) {
      if (!/^wrangler.*\.jsonc?$/.test(config)) continue
      const text = readFileSync(path.join(directory, config), "utf8")
      for (const { where, main } of configMains(text)) {
        const configPath = path.posix.join("apps", app.name, config)
        // A package specifier (a framework's server entry) is not ours.
        if (isPackageSpecifier(main)) continue
        const file = asFile(path.resolve(directory, main))
        entries.push({ config: configPath, where, main, file })
      }
    }
  }
  return entries
}

/** Problems across the repository, one line each. */
export function checkRepository(repoRoot) {
  const packages = workspacePackages(repoRoot)
  const cache = new Map()
  const lines = []
  const checked = new Set()
  for (const entry of workerEntries(repoRoot)) {
    if (entry.file === null) {
      lines.push(
        `${entry.config} (${entry.where}): main "${entry.main}" not found`,
      )
      continue
    }
    if (checked.has(entry.file)) continue
    checked.add(entry.file)
    const relative = path
      .relative(repoRoot, entry.file)
      .split(path.sep)
      .join("/")
    for (const problem of entryProblems(entry.file, packages, cache)) {
      const why = problem.detail === null ? problem.kind : problem.detail
      lines.push(
        `${relative}: export "${problem.name}" is not a class or function (${why}); move it to a sibling module (named by ${entry.config})`,
      )
    }
  }
  return { lines, checked: [...checked] }
}
