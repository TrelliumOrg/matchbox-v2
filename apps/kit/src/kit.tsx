import { useHaptics } from "@matchbox/motion"
import { TokenIcon, tokenIcons } from "@matchbox/token-icons"
import { presets, type ThemePreset } from "@matchbox/tokens"
import * as AllocationMark from "@matchbox/ui/allocation-mark"
import * as Banner from "@matchbox/ui/banner"
import * as BlockTicker from "@matchbox/ui/block-ticker"
import * as Card from "@matchbox/ui/card"
import { BarChart, LineChart } from "@matchbox/ui/chart"
import * as CoinStack from "@matchbox/ui/coin-stack"
import * as Field from "@matchbox/ui/field"
import { Icon } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import * as ListRow from "@matchbox/ui/list-row"
import * as LockCard from "@matchbox/ui/lock-card"
import * as Lockup from "@matchbox/ui/lockup"
import * as PillButton from "@matchbox/ui/pill-button"
import * as PriceSlot from "@matchbox/ui/price-slot"
import * as PropertyIcon from "@matchbox/ui/property-icon"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import * as Sheet from "@matchbox/ui/sheet"
import * as SplitBar from "@matchbox/ui/split-bar"
import * as Stepper from "@matchbox/ui/stepper"
import * as Switch from "@matchbox/ui/switch"
import * as Theme from "@matchbox/ui/theme"
import * as Tooltip from "@matchbox/ui/tooltip"
import { type ReactNode, useEffect, useState } from "react"
import { Explorer } from "./explorer"
import {
  gaugeColors,
  InitialsPicture,
  KilnPicture,
  NorthfieldPicture,
} from "./gauges"

const allPresets: ThemePreset[] = [
  "paper",
  "linen",
  "concrete",
  "porcelain",
  "graphite",
  "walnut",
  "slate",
  "onyx",
]

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section aria-labelledby={id} className="mt-24 first:mt-0">
      <h2 id={id} className="text-2xl font-[650] tracking-[-0.015em]">
        {title}
      </h2>
      <div className="mt-8 flex flex-wrap items-start gap-x-14 gap-y-10">
        {children}
      </div>
    </section>
  )
}

function Spec({
  caption,
  children,
  wide = false,
}: {
  caption: string
  children: ReactNode
  wide?: boolean
}): ReactNode {
  return (
    <figure
      className={`flex flex-col items-start gap-3.5 ${wide ? "w-full" : ""}`}
    >
      {children}
      <figcaption className="text-sm text-sec">{caption}</figcaption>
    </figure>
  )
}

function useBlocks(): { block: number; receivedAt: number } {
  const [state, setState] = useState({
    block: 13078795,
    receivedAt: Date.now(),
  })
  useEffect(() => {
    const timer = setInterval(() => {
      setState((current) => ({
        block: current.block + 1,
        receivedAt: Date.now(),
      }))
    }, 3800)
    return () => clearInterval(timer)
  }, [])
  return state
}

function Header({ onAppearance }: { onAppearance: () => void }): ReactNode {
  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center gap-4 bg-bg px-10 max-sm:px-5">
      <Lockup.Root product="pro" className="max-sm:hidden" />
      <Lockup.Root product="pro" form="short" className="sm:hidden" />
      <span className="flex-1" />
      <PriceSlot.Root
        mezo={{ price: "$0.184", change: "-2.4%", trend: "down" }}
        btc={{ price: "$105,710", change: "+1.8%", trend: "up" }}
        epoch={{ label: "Epoch 47", remaining: "3d 12h" }}
      />
      <span aria-hidden="true" className="h-6 w-px bg-line max-sm:hidden" />
      <Theme.QuickSwitch className="max-sm:hidden" />
      <PillButton.Root
        intent="neutral"
        className="bg-soft"
        onClick={onAppearance}
      >
        Appearance
      </PillButton.Root>
    </header>
  )
}

function AppearanceSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content>
        <Sheet.Header accessory={<Theme.SyncIcon />}>Appearance</Sheet.Header>
        <Sheet.Body>
          <Theme.Picker />
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  )
}

function Lockups(): ReactNode {
  const products: Lockup.LockupProduct[] = [
    "matchbox",
    "pro",
    "scan",
    "id",
    "developer",
    "classic",
  ]
  return (
    <Section id="lockups" title="Lockups">
      <Spec caption="Full lockup, 22px" wide>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          {products.map((product) => (
            <Lockup.Root key={product} product={product} />
          ))}
        </div>
      </Spec>
      <Spec caption="Short form, 22px" wide>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          {products.slice(1).map((product) => (
            <Lockup.Root key={product} product={product} form="short" />
          ))}
        </div>
      </Spec>
      <Spec caption="Marketing, 32px">
        <Lockup.Root product="scan" height={32} />
      </Spec>
    </Section>
  )
}

function Buttons(): ReactNode {
  const [pending, setPending] = useState(false)
  return (
    <Section id="buttons" title="Pill buttons">
      <Spec caption="Primary">
        <PillButton.Root>Claim all</PillButton.Root>
      </Spec>
      <Spec caption="Secondary">
        <PillButton.Root intent="secondary">Claim and relock</PillButton.Root>
      </Spec>
      <Spec caption="Neutral on a card, and the 34px card action">
        <Card.Root className="flex items-center gap-2.5">
          <PillButton.Root intent="neutral">Add MEZO</PillButton.Root>
          <PillButton.Root intent="neutral" size="sm">
            Manage
          </PillButton.Root>
        </Card.Root>
      </Spec>
      <Spec caption="Disabled">
        <PillButton.Root disabled>Review and sign</PillButton.Root>
      </Spec>
      <Spec caption="Waiting, with spinner. Tap to toggle">
        <PillButton.Root
          pending={pending}
          onClick={() => setPending(true)}
          onBlur={() => setPending(false)}
        >
          {pending ? "Waiting for wallet" : "Review and sign"}
        </PillButton.Root>
      </Spec>
      <Spec caption="Destructive confirm">
        <PillButton.Root intent="destructive">Withdraw</PillButton.Root>
      </Spec>
    </Section>
  )
}

function Controls(): ReactNode {
  const haptics = useHaptics()
  const [token, setToken] = useState("mezo")
  const [duration, setDuration] = useState("max")
  const [share, setShare] = useState(55)
  return (
    <Section id="controls" title="Controls">
      <Spec caption="Segmented control">
        <SegmentedControl.Root
          aria-label="Token"
          value={token}
          onValueChange={(value) => {
            setToken(value)
            haptics.pick()
          }}
          className="w-[300px]"
        >
          <SegmentedControl.Item value="mezo">MEZO</SegmentedControl.Item>
          <SegmentedControl.Item value="btc">BTC</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Spec>
      <Spec caption="Segmented control, five options">
        <SegmentedControl.Root
          aria-label="Lock duration"
          size="sm"
          value={duration}
          onValueChange={setDuration}
        >
          <SegmentedControl.Item value="1m">1 month</SegmentedControl.Item>
          <SegmentedControl.Item value="6m">6 months</SegmentedControl.Item>
          <SegmentedControl.Item value="1y">1 year</SegmentedControl.Item>
          <SegmentedControl.Item value="4y">4 years</SegmentedControl.Item>
          <SegmentedControl.Item value="max">Auto max</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Spec>
      <Spec caption="Stepper, 5% steps">
        <Stepper.Root
          label="Kiln Labs share"
          value={share}
          onValueChange={setShare}
        />
      </Spec>
      <Spec caption="Switch, on and off">
        <div className="flex h-11 items-center gap-4">
          <Switch.Root aria-label="On example" defaultChecked />
          <Switch.Root aria-label="Off example" />
        </div>
      </Spec>
      <Spec caption="Round icon buttons, 40 soft and 44 white">
        <div className="flex h-11 items-center gap-4">
          {(["x", "chevron-right", "plus"] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              className="grid size-10 place-items-center rounded-full bg-soft text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              <Icon name={name} size={18} />
            </button>
          ))}
          <button
            type="button"
            aria-label="Withdraw"
            className="grid size-11 place-items-center rounded-full border border-soft2 bg-raised text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            <Icon name="chevron-down" size={18} />
          </button>
        </div>
      </Spec>
    </Section>
  )
}

function Fields(): ReactNode {
  const [amount, setAmount] = useState("5000.00")
  const balance = "12480.00"
  const over =
    amount !== "" && amount.length > 0 && compareDecimal(amount, balance) > 0
  return (
    <Section id="fields" title="Fields and banner">
      <Spec caption="Amount field with currency pill and Max">
        <Field.Root invalid={over} className="w-[440px] max-w-full">
          <Field.Box>
            <div className="min-w-0 flex-1">
              <Field.Label>You lock</Field.Label>
              <Field.Input
                value={amount}
                onValueChange={setAmount}
                decimals={2}
              />
            </div>
            <Field.Currency ticker="MEZO" />
          </Field.Box>
          <Field.Balance>
            Balance 12,480.00 MEZO
            <Field.Max onClick={() => setAmount(balance)} />
          </Field.Balance>
          <Field.Error>Exceeds balance</Field.Error>
        </Field.Root>
      </Spec>
      <Spec
        caption="Banner, one line and one underlined action, closes with X"
        wide
      >
        <Banner.Root aria-label="Kiln Labs">
          <Banner.Icon>
            <KilnPicture size={26} />
          </Banner.Icon>
          <Banner.Content>
            <p>1.09M votes to 5× on Kiln Labs</p>
            <Banner.Action>Add votes</Banner.Action>
          </Banner.Content>
          <Banner.Close />
        </Banner.Root>
      </Spec>
    </Section>
  )
}

/** Compares two non-negative decimal strings without floats. */
function compareDecimal(a: string, b: string): number {
  const [aw = "0", af = ""] = a.split(".")
  const [bw = "0", bf = ""] = b.split(".")
  const width = Math.max(af.length, bf.length)
  const left = BigInt(aw + af.padEnd(width, "0"))
  const right = BigInt(bw + bf.padEnd(width, "0"))
  return left === right ? 0 : left > right ? 1 : -1
}

function Lists(): ReactNode {
  const allocations: AllocationMark.Allocation[] = [
    {
      id: "kiln",
      name: "Kiln Labs",
      share: 70,
      color: gaugeColors.kiln,
      picture: <KilnPicture />,
    },
    {
      id: "604",
      name: "veBTC #604",
      share: 30,
      color: gaugeColors.vebtc604,
      picture: <InitialsPicture initials="44" hue={96} />,
    },
  ]
  return (
    <Section id="lists" title="Lists">
      <Spec
        caption="List rows with value and sub value. Green only for money in."
        wide
      >
        <ListRow.List className="w-full max-w-[640px]">
          <ListRow.Root>
            <ListRow.Icon>
              <Icon name="check" size={20} strokeWidth={1.8} />
            </ListRow.Icon>
            <ListRow.Text>
              <ListRow.Title>Voted with #2207</ListRow.Title>
              <ListRow.Subline>Epoch 47, Thursday</ListRow.Subline>
            </ListRow.Text>
            <ListRow.Value>
              <ListRow.Main>41.26k votes</ListRow.Main>
              <ListRow.Sub>
                <AllocationMark.Root allocations={allocations} />
              </ListRow.Sub>
            </ListRow.Value>
          </ListRow.Root>
          <ListRow.Root>
            <ListRow.Icon>
              <Icon name="plus" size={20} strokeWidth={1.8} />
            </ListRow.Icon>
            <ListRow.Text>
              <ListRow.Title>Claimed rewards</ListRow.Title>
              <ListRow.Subline>Epoch 45, Fri 30 Oct</ListRow.Subline>
            </ListRow.Text>
            <ListRow.Value>
              <ListRow.Main tone="positive">+$654.60</ListRow.Main>
              <ListRow.Sub>
                <CoinStack.Root
                  coins={[
                    { ticker: "BTC" },
                    { ticker: "MEZO" },
                    { ticker: "MUSD" },
                  ]}
                  label="Claimed breakdown"
                  breakdown={[
                    { ticker: "BTC", amount: "0.005912 BTC", usd: "$624.96" },
                    { ticker: "MEZO", amount: "145.20 MEZO", usd: "$26.72" },
                    { ticker: "MUSD", amount: "2.92 MUSD", usd: "$2.92" },
                  ]}
                />
              </ListRow.Sub>
            </ListRow.Value>
          </ListRow.Root>
          <ListRow.Root>
            <ListRow.Icon tone="pending">
              <Icon name="clock" size={20} strokeWidth={1.8} />
            </ListRow.Icon>
            <ListRow.Text>
              <ListRow.Title>Vote with #2207</ListRow.Title>
              <ListRow.Subline tone="attention">Confirming</ListRow.Subline>
            </ListRow.Text>
            <ListRow.Value>
              <ListRow.Main>1.95k votes</ListRow.Main>
            </ListRow.Value>
          </ListRow.Root>
          <ListRow.Root asChild>
            <a href="#lists">
              <ListRow.Icon>
                <InitialsPicture initials="HC" hue={28} size={48} />
              </ListRow.Icon>
              <ListRow.Text>
                <ListRow.Title>Hearth Capital</ListRow.Title>
                <ListRow.Subline>
                  No incentives, 6.40M of 6.95M votes
                </ListRow.Subline>
              </ListRow.Text>
              <ListRow.Chevron />
            </a>
          </ListRow.Root>
        </ListRow.List>
      </Spec>
    </Section>
  )
}

function VeBtcCard(): ReactNode {
  return (
    <LockCard.Root kind="vebtc" className="w-[272px]">
      <LockCard.Front>
        <LockCard.Tab href="#locks">veBTC #4120</LockCard.Tab>
        <LockCard.Body>
          <LockCard.Amount>0.8000 BTC</LockCard.Amount>
          <LockCard.Usd>$84,568</LockCard.Usd>
          <LockCard.Rows>
            <LockCard.Row label="Voting power">0.6110 veBTC</LockCard.Row>
            <LockCard.Row label="Gauge">Northfield Nodes</LockCard.Row>
            <LockCard.Row label="To claim">$203.78</LockCard.Row>
          </LockCard.Rows>
          <LockCard.Manage />
        </LockCard.Body>
      </LockCard.Front>
      <LockCard.Back>
        <LockCard.Tab>veBTC #4120</LockCard.Tab>
        <LockCard.Menu>
          <LockCard.MenuItem
            icon={<Icon name="cloud-download" size={16} strokeWidth={1.8} />}
          >
            Refresh boost
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="plus" size={16} strokeWidth={1.8} />}
          >
            Add incentives
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="plus" size={16} strokeWidth={1.8} />}
          >
            Add BTC
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="chevron-right" size={16} strokeWidth={1.8} />}
          >
            Transfer
          </LockCard.MenuItem>
        </LockCard.Menu>
      </LockCard.Back>
    </LockCard.Root>
  )
}

function VeMezoCard(): ReactNode {
  return (
    <LockCard.Root kind="vemezo" className="w-[272px]">
      <LockCard.Front>
        <LockCard.Tab href="#locks">veMEZO #2207</LockCard.Tab>
        <LockCard.Body>
          <LockCard.Amount>48,000.00 MEZO</LockCard.Amount>
          <LockCard.Usd>$8,832</LockCard.Usd>
          <LockCard.Rows>
            <LockCard.Row label="Voting power">41.26k</LockCard.Row>
            <LockCard.Row label="Epoch 47" tone="attention">
              Not voted
            </LockCard.Row>
            <LockCard.Row label="To claim">$8.70</LockCard.Row>
          </LockCard.Rows>
          <LockCard.Manage />
        </LockCard.Body>
      </LockCard.Front>
      <LockCard.Back>
        <LockCard.Tab>veMEZO #2207</LockCard.Tab>
        <LockCard.Menu>
          <LockCard.MenuItem
            icon={<Icon name="check" size={16} strokeWidth={1.8} />}
          >
            Vote
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="plus" size={16} strokeWidth={1.8} />}
            value="$8.70"
          >
            Claim
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="plus" size={16} strokeWidth={1.8} />}
          >
            Add MEZO
          </LockCard.MenuItem>
          <LockCard.MenuItem
            icon={<Icon name="clock" size={16} strokeWidth={1.8} />}
            value="3y 2mo"
          >
            Extend
          </LockCard.MenuItem>
        </LockCard.Menu>
      </LockCard.Back>
    </LockCard.Root>
  )
}

function ExpiredCard(): ReactNode {
  return (
    <LockCard.Root kind="expired" className="w-[272px]">
      <LockCard.Front>
        <LockCard.Tab>veMEZO #977</LockCard.Tab>
        <LockCard.Body>
          <LockCard.Amount>3,200.00 MEZO</LockCard.Amount>
          <LockCard.Usd>$588.80</LockCard.Usd>
          <LockCard.Rows>
            <LockCard.Row label="Expired">14 Oct</LockCard.Row>
            <LockCard.Row label="Voting power">None</LockCard.Row>
          </LockCard.Rows>
          <LockCard.Action>Withdraw</LockCard.Action>
        </LockCard.Body>
      </LockCard.Front>
    </LockCard.Root>
  )
}

function Locks(): ReactNode {
  return (
    <Section id="locks" title="Lock cards">
      <Spec caption="veBTC, orange tab. Manage flips">
        <VeBtcCard />
      </Spec>
      <Spec caption="veMEZO, pink tab">
        <VeMezoCard />
      </Spec>
      <Spec caption="Expired, grey tab">
        <ExpiredCard />
      </Spec>
      <Spec caption="New lock, dashed outline">
        <div className="w-[272px]">
          <LockCard.NewTile />
        </div>
      </Spec>
    </Section>
  )
}

function Coins(): ReactNode {
  const [optimized, setOptimized] = useState(false)
  const haptics = useHaptics()
  return (
    <Section id="coins" title="Token coins">
      <Spec caption="Official icons from Mezo's token assets" wide>
        <div className="flex flex-wrap gap-12">
          {Object.values(tokenIcons).map((token) => (
            <div
              key={token.ticker}
              className="flex w-24 flex-col items-center gap-2.5 text-center"
            >
              <TokenIcon ticker={token.ticker} size={48} />
              <span className="text-[15px] font-semibold">{token.ticker}</span>
              <span className="text-[13.5px] text-sec">{token.name}</span>
            </div>
          ))}
          <div className="flex w-24 flex-col items-center gap-2.5 text-center">
            <TokenIcon ticker="tBTC" size={48} />
            <span className="text-[15px] font-semibold">tBTC</span>
            <span className="text-[13.5px] text-sec">No official art</span>
          </div>
        </div>
      </Spec>
      <Spec caption="Coin stack, 28 and 18, 5px overlap, hover fans and opens the breakdown">
        <Card.Root className="flex h-[76px] items-center gap-8">
          <CoinStack.Root
            coins={[{ ticker: "BTC" }, { ticker: "MEZO" }, { ticker: "MUSD" }]}
            size={28}
            surface="var(--soft)"
            chevron
            label="Claimable breakdown"
            breakdown={[
              { ticker: "BTC", amount: "0.001928 BTC", usd: "$203.78" },
              { ticker: "MEZO", amount: "41.20 MEZO", usd: "$7.58" },
              { ticker: "MUSD", amount: "1.12 MUSD", usd: "$1.12" },
            ]}
          />
          <CoinStack.Root
            coins={[{ ticker: "BTC" }, { ticker: "MEZO" }, { ticker: "MUSD" }]}
            surface="var(--soft)"
          />
        </Card.Root>
      </Spec>
      <Spec caption="LP tokens, two-coin stack of the constituents">
        <Card.Root className="flex h-[76px] items-center gap-7 text-[15px] font-semibold">
          <span className="flex items-center gap-2.5">
            <CoinStack.Root
              coins={[{ ticker: "BTC" }, { ticker: "MUSD" }]}
              size={28}
              surface="var(--soft)"
              decorative
            />
            BTC/MUSD
          </span>
          <span className="flex items-center gap-2.5">
            <CoinStack.Root
              coins={[{ ticker: "mUSDC" }, { ticker: "MUSD" }]}
              size={28}
              surface="var(--soft)"
              decorative
            />
            mUSDC/MUSD
          </span>
        </Card.Root>
      </Spec>
      <Spec caption="Allocation mark and split bar. Optimize reflows the segments">
        <div className="flex items-center gap-6">
          <AllocationMark.Root
            allocations={
              optimized
                ? [
                    {
                      id: "kiln",
                      name: "Kiln Labs",
                      share: 45,
                      color: gaugeColors.kiln,
                      picture: <KilnPicture />,
                    },
                    {
                      id: "604",
                      name: "veBTC #604",
                      share: 30,
                      color: gaugeColors.vebtc604,
                      picture: <InitialsPicture initials="44" hue={96} />,
                    },
                    {
                      id: "nf",
                      name: "Northfield Nodes",
                      share: 25,
                      color: gaugeColors.northfield,
                      picture: <NorthfieldPicture />,
                    },
                  ]
                : [
                    {
                      id: "kiln",
                      name: "Kiln Labs",
                      share: 70,
                      color: gaugeColors.kiln,
                      picture: <KilnPicture />,
                    },
                    {
                      id: "604",
                      name: "veBTC #604",
                      share: 30,
                      color: gaugeColors.vebtc604,
                      picture: <InitialsPicture initials="44" hue={96} />,
                    },
                    {
                      id: "nf",
                      name: "Northfield Nodes",
                      share: 0,
                      color: gaugeColors.northfield,
                      picture: <NorthfieldPicture />,
                    },
                  ].filter((allocation) => allocation.share > 0)
            }
          />
          <PillButton.Root
            intent="neutral"
            className="bg-soft"
            onClick={() => {
              setOptimized((value) => !value)
              haptics.nudge()
            }}
          >
            {optimized ? "Reset" : "Optimize"}
          </PillButton.Root>
        </div>
        <SplitBar.Root
          width={320}
          height={10}
          segments={[
            {
              id: "kiln",
              value: optimized ? 45 : 70,
              color: gaugeColors.kiln,
              label: "Kiln Labs",
            },
            {
              id: "604",
              value: 30,
              color: gaugeColors.vebtc604,
              label: "veBTC #604",
            },
            {
              id: "nf",
              value: optimized ? 25 : 0,
              color: gaugeColors.northfield,
              label: "Northfield Nodes",
            },
          ]}
        />
      </Spec>
    </Section>
  )
}

function Tickers({
  block,
  receivedAt,
}: {
  block: number
  receivedAt: number
}): ReactNode {
  return (
    <Section id="tickers" title="Live tickers">
      <Spec caption="Price slot, cycles every 4s, hover pauses and opens all three">
        <PriceSlot.Root
          mezo={{ price: "$0.184", change: "-2.4%", trend: "down" }}
          btc={{ price: "$105,710", change: "+1.8%", trend: "up" }}
          epoch={{ label: "Epoch 47", remaining: "3d 12h" }}
          block={
            <>
              <BlockTicker.Root block={block} receivedAt={receivedAt} />
              <span className="text-[13px] text-sec">24h</span>
            </>
          }
        />
      </Spec>
      <Spec caption="Block ticker, ring fills over 3.8s, changed digits roll">
        <Card.Root className="flex h-[76px] items-center">
          <BlockTicker.Root
            block={block}
            receivedAt={receivedAt}
            href={`https://scan.matchbox.markets/block/${block}`}
          />
        </Card.Root>
      </Spec>
      <Spec caption="Stale after 30s, dashed ring">
        <Card.Root className="flex h-[76px] items-center">
          <BlockTicker.Root block={13078790} receivedAt={Date.now() - 60_000} />
        </Card.Root>
      </Spec>
    </Section>
  )
}

function Properties(): ReactNode {
  return (
    <Section id="properties" title="Property icons and tooltips">
      <Spec caption="Icons only, tooltip on hover and focus">
        <PropertyIcon.Group>
          <PropertyIcon.Root name="sign-in-id" />
          <PropertyIcon.Root name="wallet" />
          <PropertyIcon.Root name="discord" />
          <PropertyIcon.Root name="gauge-data" />
          <PropertyIcon.Divider />
          <PropertyIcon.Root name="mainnet" />
        </PropertyIcon.Group>
      </Spec>
      <Spec caption="Gauge type, created date, block time, epoch">
        <PropertyIcon.Group>
          <PropertyIcon.Root name="pool-gauge" />
          <PropertyIcon.Root name="vebtc-gauge" />
          <PropertyIcon.Root name="validator-gauge" />
          <PropertyIcon.Root name="created" label="Created 5 Nov 2026" />
          <PropertyIcon.Root name="block-time" label="Block time 3.8s" />
          <PropertyIcon.Root name="epoch" />
          <PropertyIcon.Root name="testnet" />
        </PropertyIcon.Group>
      </Spec>
      <Spec caption="Tooltip">
        <Tooltip.Simple label="Synced with Matchbox ID">
          <PillButton.Root intent="neutral" className="bg-soft">
            Hover me
          </PillButton.Root>
        </Tooltip.Simple>
      </Spec>
    </Section>
  )
}

const apy = [1.2, 1.5, 1.35, 1.9, 2.3, 2.1, 2.55, 3.15, 3.05]

function Charts(): ReactNode {
  const [epoch, setEpoch] = useState(8)
  return (
    <Section id="charts" title="Charts">
      <Spec
        caption="Line chart, no grid, two axis labels; hover reads into the figure"
        wide
      >
        <div className="max-w-[680px]" {...Inspect.scope}>
          <p className="text-base text-sec">0x449b…3d1E APY</p>
          <p className="mt-0.5 text-[23px] font-[650] tracking-[-0.015em] tabular-nums">
            <Inspect.Value reserve="3.05%">3.05%</Inspect.Value>
            <span className="ml-2 text-[15px] font-medium tracking-normal text-sec">
              <Inspect.Note>Epoch 9</Inspect.Note>
            </span>
          </p>
          <LineChart
            className="mt-4"
            label="APY from epoch 1 to 9, now 3.05%"
            points={apy}
            inspect={apy.map((value, index) => ({
              label: `Epoch ${index + 1}`,
              value: `${value.toFixed(2)}%`,
            }))}
            readout="figure"
            reference={{ value: 1.8, label: "Median 1.80%" }}
            startLabel="Epoch 1"
            endLabel="Epoch 9"
          />
        </div>
      </Spec>
      <Spec
        caption="Epoch bars, selected one orange, arrow keys move, hover shows a tooltip"
        wide
      >
        <BarChart
          className="max-w-[680px]"
          label="Votes per epoch"
          bars={[38, 41, 44, 40, 47, 52, 49, 55, 58].map((value, index) => ({
            label: `Epoch ${39 + index}`,
            value,
            text: `${value}k veBTC`,
          }))}
          selected={epoch}
          onSelect={setEpoch}
        />
      </Spec>
    </Section>
  )
}

function SheetDemo(): ReactNode {
  return (
    <Section id="sheet" title="Sheet">
      <Spec caption="Right sheet, 480. Bottom sheet on phones">
        <Sheet.Root>
          <Sheet.Trigger asChild>
            <PillButton.Root>Review and sign</PillButton.Root>
          </Sheet.Trigger>
          <Sheet.Content>
            <Sheet.Header>Review vote</Sheet.Header>
            <Sheet.Body>
              <p className="text-[15px] text-sec">Projected</p>
              <p className="text-[44px] font-[650] tracking-[-0.025em] tabular-nums">
                $8.75
              </p>
              <p className="text-[15px] text-sec tabular-nums">41,260 votes</p>
              <ListRow.List className="mt-6">
                <ListRow.Root>
                  <ListRow.Icon className="overflow-hidden">
                    <KilnPicture size={48} />
                  </ListRow.Icon>
                  <ListRow.Text>
                    <ListRow.Title>Kiln Labs</ListRow.Title>
                    <ListRow.Subline>$5.80</ListRow.Subline>
                  </ListRow.Text>
                  <ListRow.Value>
                    <ListRow.Main>70%</ListRow.Main>
                    <ListRow.Sub>28,882 votes</ListRow.Sub>
                  </ListRow.Value>
                </ListRow.Root>
                <ListRow.Root>
                  <ListRow.Icon className="overflow-hidden">
                    <InitialsPicture initials="44" hue={96} size={48} />
                  </ListRow.Icon>
                  <ListRow.Text>
                    <ListRow.Title>veBTC #604</ListRow.Title>
                    <ListRow.Subline>$2.95</ListRow.Subline>
                  </ListRow.Text>
                  <ListRow.Value>
                    <ListRow.Main>30%</ListRow.Main>
                    <ListRow.Sub>12,378 votes</ListRow.Sub>
                  </ListRow.Value>
                </ListRow.Root>
              </ListRow.List>
            </Sheet.Body>
            <Sheet.Footer>
              <PillButton.Root size="lg">Sign and vote</PillButton.Root>
            </Sheet.Footer>
          </Sheet.Content>
        </Sheet.Root>
      </Spec>
    </Section>
  )
}

function PresetPanel({ preset }: { preset: ThemePreset }): ReactNode {
  const info = presets[preset]
  return (
    <section
      data-theme={preset}
      aria-label={`${info.name} preset`}
      className="flex flex-col gap-5 rounded-[28px] bg-bg p-6 text-ink shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-[17px] font-[650]">{info.name}</h3>
        <span className="text-sm text-sec">
          {info.note ?? (info.mode === "light" ? "Light" : "Dark")}
        </span>
      </header>
      <div className="flex gap-2">
        <PillButton.Root>Claim all</PillButton.Root>
        <PillButton.Root intent="secondary">Vote</PillButton.Root>
      </div>
      <VeMezoCard />
      <div className="flex items-center justify-between">
        <SegmentedControl.Root
          aria-label={`${info.name} token`}
          defaultValue="mezo"
          className="w-[180px]"
        >
          <SegmentedControl.Item value="mezo">MEZO</SegmentedControl.Item>
          <SegmentedControl.Item value="btc">BTC</SegmentedControl.Item>
        </SegmentedControl.Root>
        <Switch.Root aria-label={`${info.name} switch`} defaultChecked />
      </div>
      <ListRow.List>
        <ListRow.Root>
          <ListRow.Icon>
            <Icon name="plus" size={20} strokeWidth={1.8} />
          </ListRow.Icon>
          <ListRow.Text>
            <ListRow.Title>Claimed rewards</ListRow.Title>
            <ListRow.Subline>Epoch 45</ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <ListRow.Main tone="positive">+$654.60</ListRow.Main>
          </ListRow.Value>
        </ListRow.Root>
      </ListRow.List>
    </section>
  )
}

function Presets(): ReactNode {
  return (
    <Section id="presets" title="Every preset">
      <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
        {allPresets.map((preset) => (
          <PresetPanel key={preset} preset={preset} />
        ))}
      </div>
    </Section>
  )
}

export default function Kit(): ReactNode {
  const [appearance, setAppearance] = useState(false)
  const { block, receivedAt } = useBlocks()
  return (
    <div className="min-h-dvh bg-bg font-sans text-ink">
      <Header onAppearance={() => setAppearance(true)} />
      <AppearanceSheet open={appearance} onOpenChange={setAppearance} />
      <main className="mx-auto max-w-[1180px] px-10 pt-12 pb-32 max-sm:px-5">
        <h1 className="text-[44px] font-[650] tracking-[-0.025em]">
          Components
        </h1>
        <div className="mt-16">
          <Section id="appearance" title="Appearance">
            <Card.Root padding="lg" className="w-[480px] max-w-full bg-sheet">
              <div className="mb-8 flex h-11 items-center gap-2.5">
                <h3 className="text-[26px] font-[650] tracking-[-0.02em]">
                  Appearance
                </h3>
                <Theme.SyncIcon />
              </div>
              <Theme.Picker />
            </Card.Root>
          </Section>
          <Lockups />
          <Buttons />
          <Controls />
          <Fields />
          <Lists />
          <Locks />
          <Coins />
          <Tickers block={block} receivedAt={receivedAt} />
          <Properties />
          <Charts />
          <SheetDemo />
          <Explorer />
          <Presets />
        </div>
      </main>
      <BlockTicker.Root
        block={block}
        receivedAt={receivedAt}
        href={`https://scan.matchbox.markets/block/${block}`}
        placement="corner"
        className="max-sm:hidden"
      />
    </div>
  )
}
