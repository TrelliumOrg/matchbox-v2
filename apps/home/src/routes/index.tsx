import { publicMezoRpc } from "@matchbox/live/config"
import { LiveProvider } from "@matchbox/live/context"
import { createFileRoute } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { getFreshFigures, getSeed } from "../data/figures-fn"
import { ProCard, ScanCard } from "../page/cards"
import { createPollLink, FiguresProvider } from "../page/live"
import { Classic, Footer, Header, Hero, Pair, Support } from "../page/sections"

/**
 * The homepage (docs/design/home-final). The loader is the last snapshot
 * of the figures, so the first paint is complete and never waits for an
 * upstream read; the page then goes live (page/live.tsx).
 */
export const Route = createFileRoute("/")({
  loader: () => getSeed(),
  component: HomePage,
})

function readFigures(): ReturnType<typeof getFreshFigures> {
  return getFreshFigures()
}

function HomePage(): ReactNode {
  const seed = Route.useLoaderData()
  const head = seed.figures.scan.blocks?.[0]?.number ?? 0
  // With no socket, the head is polled through the figures read itself,
  // so one request serves both (page/live.tsx, createPollLink).
  const [polls] = useState(() => createPollLink(readFigures))
  return (
    <LiveProvider
      head={head}
      config={seed.live}
      rpc={publicMezoRpc}
      pollLatest={polls.pollLatest}
    >
      <FiguresProvider seed={seed.figures} read={readFigures} polls={polls}>
        <div className="home">
          <Header />
          <main>
            <Hero />
            <section className="b1" aria-label="Matchbox Pro and Matchscan">
              <ProCard renderedAt={seed.renderedAt} />
              <ScanCard renderedAt={seed.renderedAt} />
            </section>
            <Pair />
            <Support />
            <Classic />
          </main>
          <Footer />
        </div>
      </FiguresProvider>
    </LiveProvider>
  )
}
