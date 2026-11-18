// A brotli proxy in front of `vite preview`, so Lighthouse sees the encoded
// sizes Cloudflare serves (preview sends everything uncompressed, which skews
// simulated LCP). Streams HTML chunk by chunk, so SSR streaming survives.
// Usage: node scripts/compressing-proxy.mjs [listenPort] [targetPort]
//        [--with-preview] starts `vite preview` on the target port too.
import { spawn } from "node:child_process"
import http from "node:http"
import { constants, createBrotliCompress } from "node:zlib"

const ports = process.argv.slice(2).filter((arg) => /^\d+$/.test(arg))
const listen = Number(ports[0] ?? 4174)
const target = Number(ports[1] ?? 4173)
const compressible = /^(text\/|application\/(javascript|json|xml)|image\/svg)/

const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      host: "localhost",
      port: target,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: `localhost:${target}`,
        "accept-encoding": "identity",
      },
    },
    (reply) => {
      const type = String(reply.headers["content-type"] ?? "")
      const accepts = String(request.headers["accept-encoding"] ?? "").includes(
        "br",
      )
      if (
        !accepts ||
        !compressible.test(type) ||
        reply.headers["content-encoding"]
      ) {
        response.writeHead(reply.statusCode ?? 502, reply.headers)
        reply.pipe(response)
        return
      }
      const headers = {
        ...reply.headers,
        "content-encoding": "br",
        vary: "accept-encoding",
      }
      delete headers["content-length"]
      response.writeHead(reply.statusCode ?? 502, headers)
      const brotli = createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: type.startsWith("text/html")
            ? 5
            : 11,
        },
        flush: constants.BROTLI_OPERATION_FLUSH,
      })
      reply.pipe(brotli).pipe(response)
    },
  )
  upstream.on("error", () => {
    response.writeHead(502)
    response.end()
  })
  request.pipe(upstream)
})

function targetUp() {
  return new Promise((resolve) => {
    http
      .get(
        { host: "localhost", port: target, path: "/favicon.svg" },
        (reply) => {
          reply.resume()
          resolve(true)
        },
      )
      .on("error", () => resolve(false))
  })
}

if (process.argv.includes("--with-preview")) {
  const preview = spawn(
    `pnpm exec vite preview --port ${target} --strictPort`,
    {
      shell: true,
      stdio: "inherit",
    },
  )
  process.on("exit", () => preview.kill())
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => process.exit(0))
  }
}
while (!(await targetUp())) await new Promise((wait) => setTimeout(wait, 250))
server.listen(listen, () => {
  console.log(
    `compressing proxy on localhost:${listen} for localhost:${target}`,
  )
})
