// Secret shapes shared by scripts/check-secrets.mjs and the Trellium
// boundary check. A match means "a secret scanner would flag this line",
// not "this is a live key": publishable keys are included on purpose so
// GitHub's and partners' scanners stay quiet on the public repository.
const secretPatterns = [
  ["Supabase key", /sb_(?:publishable|secret)_[A-Za-z0-9_-]{16,}/],
  ["JWT", /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  [
    "Cloudflare token",
    /\bCLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{40}/,
  ],
  [
    "Postgres URL with password",
    /postgres(?:ql)?:\/\/[^:\s/]+:(?![$<])[^@\s]{8,}@/,
  ],
]

export default secretPatterns
