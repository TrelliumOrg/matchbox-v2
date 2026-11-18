// Brotli in front of `vite preview`, for Lighthouse. Usage:
// node scripts/compressing-proxy.mjs [listenPort] [targetPort] [--with-preview]
import { compressingProxyCli } from "@matchbox/perf/compressing-proxy"

await compressingProxyCli(process.argv.slice(2))
