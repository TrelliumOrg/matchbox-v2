// node --test "scripts/lib/*.test.mjs"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  checkPublicWorkflow,
  findingId,
  globToRegExp,
  isAllowed,
  matchesAny,
  parseDenyList,
  scanLine,
  scanText,
} from "./public-tree.mjs"

function rules(line) {
  return scanLine(line).map((hit) => hit.rule)
}

describe("globs", () => {
  it("matches a directory and everything under it", () => {
    assert.ok(matchesAny("internal/plans/plan.md", ["internal/**"]))
    assert.ok(!matchesAny("docs/internal.md", ["internal/**"]))
  })

  it("matches a bare name at any depth", () => {
    assert.ok(matchesAny("apps/x/team-notes.md", ["team-notes*"]))
    assert.ok(matchesAny("a.pen", ["*.pen"]))
    assert.ok(matchesAny("docs/x/a.pen", ["**/*.pen"]))
  })

  it("keeps a single star inside one segment", () => {
    assert.ok(
      globToRegExp(".github/workflows/*.yml").test(".github/workflows/ci.yml"),
    )
    assert.ok(!globToRegExp(".github/*.yml").test(".github/workflows/ci.yml"))
  })
})

describe("private IPv4", () => {
  it("flags the three private ranges", () => {
    assert.deepEqual(rules("ssh into 10.1.2.3 now"), ["private-ipv4"])
    assert.deepEqual(rules("host 172.16.0.5"), ["private-ipv4"])
    assert.deepEqual(rules("host 172.31.255.255"), ["private-ipv4"])
    assert.deepEqual(rules("http://192.168.0.12:8080/"), ["private-ipv4"])
  })

  it("leaves public addresses, versions and longer numbers alone", () => {
    assert.deepEqual(rules("8.8.8.8 and 172.32.0.1 and 172.15.0.1"), [])
    assert.deepEqual(rules("version 110.0.0.1"), [])
    assert.deepEqual(rules("1.10.0.0.1"), [])
    assert.deepEqual(rules("10.0.0.256"), [])
  })
})

describe("ssh user@host", () => {
  it("flags ssh with a user and host, with options in between", () => {
    assert.deepEqual(rules("ssh alice@box.lan"), ["ssh-user-host"])
    assert.deepEqual(rules("`ssh -p 2222 deploy@203.0.113.9`"), [
      "ssh-user-host",
    ])
    assert.deepEqual(rules("ssh -o BatchMode=yes ops@build-host"), [
      "ssh-user-host",
    ])
  })

  it("leaves git over ssh and prose alone", () => {
    assert.deepEqual(rules("ssh git@github.com"), [])
    assert.deepEqual(rules("use ssh keys for this"), [])
    assert.deepEqual(rules("never write `ssh user@host` commands"), [])
  })
})

describe("home paths", () => {
  it("flags Windows and Unix home directories with a user name", () => {
    assert.deepEqual(rules("C:\\Users\\alice\\repo"), ["home-path"])
    assert.deepEqual(rules('"C:\\\\Users\\\\alice\\\\repo"'), ["home-path"])
    assert.deepEqual(rules("c:/Users/alice/repo"), ["home-path"])
    assert.deepEqual(rules("cd /home/alice/src"), ["home-path"])
    assert.deepEqual(rules("open /Users/alice/Desktop"), ["home-path"])
  })

  it("leaves placeholders, variables and URL paths alone", () => {
    assert.deepEqual(rules("/home/runner/work"), [])
    assert.deepEqual(rules("C:\\Users\\<name>\\x"), [])
    assert.deepEqual(rules("/home/$USER/x"), [])
    assert.deepEqual(rules("https://mezo.org/docs/users/borrow/"), [])
    assert.deepEqual(rules("https://example.com/home/alice"), [])
    assert.deepEqual(rules("~/home/alice"), [])
  })
})

describe("personal email", () => {
  it("flags addresses on other domains", () => {
    assert.deepEqual(rules("mail alice@gmail.com"), ["personal-email"])
    assert.deepEqual(rules("<bob@company.co.uk>"), ["personal-email"])
  })

  it("allows noreply, project domains and reserved test domains", () => {
    assert.deepEqual(rules("noreply@anthropic.com"), [])
    assert.deepEqual(rules("no-reply@matchbox.markets"), [])
    assert.deepEqual(rules("ops@id.matchbox.markets"), [])
    assert.deepEqual(rules("contact@trellium.org"), [])
    assert.deepEqual(rules("dev@example.com a@app.example.com"), [])
    assert.deepEqual(rules("u@id.test x@matchbox.local y@z.invalid"), [])
    assert.deepEqual(rules("1+me@users.noreply.github.com"), [])
  })

  it("does not read URL credentials as an address", () => {
    assert.deepEqual(
      rules("postgres://owner@ep-x-1.eu-central-1.aws.neon.tech/db"),
      [],
    )
    assert.deepEqual(rules("DATABASE_URL=postgres://u@host.example/db"), [])
  })
})

describe("secret shapes", () => {
  it("reuses the patterns from check-secrets", () => {
    const fake = `sk-ant-${"a".repeat(24)}`
    assert.deepEqual(rules(`KEY=${fake}`), ["secret: Anthropic key"])
    // Assembled at run time so this file itself passes check-secrets.
    const pem = ["-----BEGIN", "RSA PRIVATE", "KEY-----"].join(" ")
    assert.deepEqual(rules(pem), ["secret: private key"])
    const url = ["postgres://user:", "hunter2hunter2", "@db.example/x"].join("")
    assert.deepEqual(rules(url), ["secret: Postgres URL with password"])
  })
})

describe("deny list", () => {
  const list = parseDenyList(
    [
      "# comment",
      "SecretProject",
      "re:\\bjane\\b",
      "path:**/runbook*",
      "a.b?c*",
    ].join("\n"),
  )

  it("parses terms, regexps and paths", () => {
    assert.equal(list.terms.length, 3)
    assert.deepEqual(list.paths, ["**/runbook*"])
  })

  it("matches terms case-insensitively and literally", () => {
    const found = scanText(
      "x.md",
      "about secretproject\nJane said\njanet\naXb",
      list,
    )
    assert.deepEqual(
      found.map((f) => [f.line, f.rule]),
      [
        [1, "deny-list term 1"],
        [2, "deny-list term 2"],
      ],
    )
    assert.equal(scanText("y.md", "a.b?c* here", list).length, 1)
  })

  it("reports line numbers", () => {
    const found = scanText("z.md", "ok\nok\nhost 192.168.1.1\n")
    assert.deepEqual(
      found.map((f) => [f.path, f.line, f.rule]),
      [["z.md", 3, "private-ipv4"]],
    )
  })
})

describe("public workflows", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567"
  const good = [
    "name: CI",
    "on: [push, pull_request]",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: actions/checkout@${sha} # v4`,
    "      - uses: ./.github/actions/local",
    "      - run: pnpm test",
    "        env:",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  ].join("\n")

  function workflowRules(text) {
    return checkPublicWorkflow("ci.yml", text).map((f) => f.rule)
  }

  it("accepts a pinned, read-only, hosted workflow", () => {
    assert.deepEqual(workflowRules(good), [])
  })

  it("rejects self-hosted runners", () => {
    const text = good.replace(
      "runs-on: ubuntu-latest",
      "runs-on: [self-hosted, linux]",
    )
    assert.deepEqual(workflowRules(text), [
      "workflow: self-hosted runner",
      "workflow: runner other than ubuntu-latest",
    ])
  })

  it("rejects pull_request_target and workflow_run", () => {
    assert.ok(
      workflowRules(
        good.replace("on: [push, pull_request]", "on: pull_request_target"),
      ).includes("workflow: pull_request_target"),
    )
    assert.ok(
      workflowRules(
        good.replace("on: [push, pull_request]", "on: workflow_run"),
      ).includes("workflow: workflow_run"),
    )
  })

  it("rejects tags and branches instead of SHAs", () => {
    assert.deepEqual(workflowRules(good.replace(`@${sha}`, "@v4")), [
      "workflow: action not pinned to a SHA",
    ])
    assert.deepEqual(workflowRules(good.replace(`@${sha}`, "@main")), [
      "workflow: action not pinned to a SHA",
    ])
  })

  it("rejects missing permissions, secrets and deploys", () => {
    assert.deepEqual(
      workflowRules(good.replace("permissions:\n  contents: read\n", "")),
      ["workflow: no top-level permissions"],
    )
    assert.deepEqual(
      workflowRules(
        good.replace("secrets.GITHUB_TOKEN", "secrets.CLOUDFLARE_API_TOKEN"),
      ),
      ["workflow: uses a secret"],
    )
    assert.deepEqual(
      workflowRules(good.replace("pnpm test", "pnpm exec wrangler deploy")),
      ["workflow: deploys"],
    )
  })

  it("does not read a script name as a secret", () => {
    assert.deepEqual(
      workflowRules(
        good.replace("pnpm test", "node scripts/check-secrets.mjs"),
      ),
      [],
    )
  })

  it("ignores comments", () => {
    assert.deepEqual(
      workflowRules(`${good}\n# never use self-hosted runners here`),
      [],
    )
  })
})

describe("allowlist and baseline", () => {
  const finding = {
    path: "a/ip.test.ts",
    line: 3,
    rule: "private-ipv4",
    value: "10.0.0.1",
  }

  it("allows a listed value in a listed path only", () => {
    const entry = {
      rule: "private-ipv4",
      paths: ["a/*.test.ts"],
      values: ["10.0.0.1"],
    }
    assert.ok(isAllowed(finding, [entry]))
    assert.ok(!isAllowed({ ...finding, value: "10.0.0.2" }, [entry]))
    assert.ok(!isAllowed({ ...finding, path: "b/ip.ts" }, [entry]))
  })

  it("hashes the value out of a finding id", () => {
    const id = findingId(finding)
    assert.ok(!id.includes("10.0.0.1"))
    assert.equal(id, findingId({ ...finding, line: 99 }))
    assert.notEqual(id, findingId({ ...finding, value: "10.0.0.2" }))
  })
})
