// A brotli proxy in front of `vite preview`, so Lighthouse sees the encoded
// sizes Cloudflare serves (preview sends everything uncompressed, which skews
// simulated LCP). Streams HTML chunk by chunk, so SSR streaming survives.
// Copied from apps/pro/scripts/compressing-proxy.mjs.
// An app script calls compressingProxyCli(process.argv.slice(2)) with
//   [listenPort] [targetPort] [--with-preview] (starts `vite preview` on the
//   target port too) [--warm=/a,/b] (requests each path from the preview
//   before announcing the proxy, so the measured runs see a warm Worker, as
//   visitors do, not each route's first module evaluation).
import { spawn } from "node:child_process"
import http from "node:http"
import { constants, createBrotliCompress } from "node:zlib"

const compressible = /^(text\/|application\/(javascript|json|xml)|image\/svg)/

export function createCompressingProxy(target) {
  return http.createServer((request, response) => {
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
        const accepts = String(
          request.headers["accept-encoding"] ?? "",
        ).includes("br")
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
}

function targetUp(target, readyPath) {
  return new Promise((resolve) => {
    http
      .get({ host: "localhost", port: target, path: readyPath }, (reply) => {
        reply.resume()
        resolve(true)
      })
      .on("error", () => resolve(false))
  })
}

/** GETs `path` from the target and drains the body; false on an error. */
function fetchPath(target, path) {
  return new Promise((resolve) => {
    http
      .get(
        {
          host: "localhost",
          port: target,
          path,
          headers: { accept: "text/html", "user-agent": "matchbox-warm" },
        },
        (reply) => {
          reply.resume()
          reply.on("end", () => resolve(true))
        },
      )
      .on("error", () => resolve(false))
  })
}

/**
 * Requests each path twice, one after another, so every route's server
 * modules are evaluated and its first render is done before measuring.
 * Returns how many requests answered.
 */
export async function warmPaths(target, paths, rounds = 2) {
  let answered = 0
  for (let round = 0; round < rounds; round += 1) {
    for (const path of paths) {
      if (await fetchPath(target, path)) answered += 1
    }
  }
  return answered
}

/** `readyPath` is a static file the preview serves once it is up. */
export async function compressingProxyCli(args, readyPath = "/favicon.svg") {
  const ports = args.filter((arg) => /^\d+$/.test(arg))
  const listen = Number(ports[0] ?? 4174)
  const target = Number(ports[1] ?? 4173)
  if (args.includes("--with-preview")) {
    const preview = spawn(
      `pnpm exec vite preview --port ${target} --strictPort`,
      { shell: true, stdio: "inherit" },
    )
    process.on("exit", () => preview.kill())
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => process.exit(0))
    }
  }
  while (!(await targetUp(target, readyPath))) {
    await new Promise((wait) => setTimeout(wait, 250))
  }
  const warm = args.find((arg) => arg.startsWith("--warm="))
  if (warm !== undefined) {
    const paths = warm.slice("--warm=".length).split(",").filter(Boolean)
    const answered = await warmPaths(target, paths)
    console.log(`warmed ${paths.length} paths (${answered} requests answered)`)
  }
  const server = createCompressingProxy(target)
  server.listen(listen, () => {
    console.log(
      `compressing proxy on localhost:${listen} for localhost:${target}`,
    )
  })
  return server
}
