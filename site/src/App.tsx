import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategorySection } from '@/components/category-section'
import { RunsTable } from '@/components/runs-table'
import { SurvivalSection } from '@/components/survival-section'
import { data, directionLabel, formatDateTime } from '@/lib/data'

const REPO_URL = 'https://github.com/bevry-vibes/translation-comparison-en-id'

function Header() {
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Indonesian {'<->'} English translation benchmark
        </h1>
        <Badge variant="outline" className="font-mono text-[11px]">
          {data.directions.length} directions ·{' '}
          {data.directions.reduce((n, d) => n + d.runs.length, 0)} runs
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          Generated <time dateTime={data.generated_at}>{formatDateTime(data.generated_at)}</time> by{' '}
          <span className="font-mono text-xs">eval/build_site_data.py</span>
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          GitHub
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="space-y-1 text-xs leading-relaxed text-muted-foreground">
      <Separator className="mb-4" />
      <p>
        chrF, chrF++ and BLEU are corpus-level scores on a 0-100 scale; higher is better. Metrics
        are computed with <span className="font-mono">sacrebleu</span> (the{' '}
        <span className="font-mono">metric backend</span> on each run says whether sacrebleu or the
        bundled fallback produced the numbers).
      </p>
      <p>
        Rows from hosted providers time the network round trip, so their seconds/sentence include
        latency and are not comparable to local (Ollama) rows.
      </p>
      <p>
        Masked-testset runs are excluded from the main tables and scored separately for name-token
        survival. Source data: <span className="font-mono">results/*.json</span>; rebuilt via{' '}
        <span className="font-mono">.venv/bin/python eval/build_site_data.py</span>.
      </p>
    </footer>
  )
}

export default function App() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Header />
      <Tabs defaultValue={data.directions[0]?.direction} className="gap-4">
        <TabsList className="h-9">
          {data.directions.map((direction) => (
            <TabsTrigger key={direction.direction} value={direction.direction} className="px-4">
              {directionLabel(direction)}
              <Badge variant="secondary" className="ms-1 h-4 px-1 font-mono text-[10px]">
                {direction.runs.length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {data.directions.map((direction) => (
          <TabsContent key={direction.direction} value={direction.direction} className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                {directionLabel(direction)} — all runs, sorted by chrF
              </h2>
              <RunsTable runs={direction.runs} />
            </section>
            <CategorySection direction={direction} />
            <SurvivalSection direction={direction} />
          </TabsContent>
        ))}
      </Tabs>
      <Footer />
    </div>
  )
}
