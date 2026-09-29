import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { CopyButton } from '@/components/guidance-sections'
import { formatDateTime, heatText, renderTokens } from '@/lib/data'
import type { RunRow, Sample } from '@/types'

function SampleBlock({ sample }: { sample: Sample }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {sample.category}
        </Badge>
        <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: heatText(sample.chrf) }}>
          chrF {sample.chrf.toFixed(2)}
        </span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="pt-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Source
          </dt>
          <dd className="text-foreground/90">{renderTokens(sample.source)}</dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="pt-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Reference
          </dt>
          <dd className="text-foreground/90">{renderTokens(sample.reference)}</dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="pt-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Hypothesis
          </dt>
          <dd className="text-foreground">{renderTokens(sample.hypothesis)}</dd>
        </div>
      </dl>
    </div>
  )
}

function CategoryBars({ categories }: { categories: Record<string, number> }) {
  const entries = Object.entries(categories).sort(([, a], [, b]) => a - b)
  if (entries.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">
        Category chrF <span className="font-normal text-muted-foreground">— weakest categories first</span>
      </h3>
      <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
        {entries.map(([category, value]) => (
          <div key={category} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate font-mono text-xs text-foreground/80" title={category}>
              {category}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${value}%`, backgroundColor: heatText(value) }}
              />
            </div>
            <span
              className="w-12 text-right font-mono text-xs tabular-nums"
              style={{ color: heatText(value) }}
            >
              {value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Replicate({ run }: { run: RunRow }) {
  const r = run.replication
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">
        Replicate this run{' '}
        <span className="font-normal text-muted-foreground">— exact prompt, gateway flags included</span>
      </h3>
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <pre className="flex-1 overflow-x-auto rounded-lg border bg-card/50 p-3 font-mono text-xs whitespace-pre-wrap">
            {r.command}
          </pre>
          <CopyButton text={r.command} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.base_url && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {r.base_url}
            </Badge>
          )}
          {r.key_env && (
            <Badge variant="outline" className="font-mono text-[10px]">
              ${r.key_env}
            </Badge>
          )}
          {r.max_tokens != null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              max_tokens {r.max_tokens}
            </Badge>
          )}
          {r.chat_kwargs && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {JSON.stringify(r.chat_kwargs)}
            </Badge>
          )}
        </div>
        {r.request_body && (
          <pre className="overflow-x-auto rounded-lg border bg-card/50 p-3 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(r.request_body, null, 2)}
          </pre>
        )}
        {r.notes?.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">
            • {note}
          </p>
        ))}
      </div>
    </section>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  )
}

export function SamplesDialog({
  run,
  open,
  onOpenChange,
}: {
  run: RunRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!run) return null
  const ranked = [...run.samples].sort((a, b) => b.chrf - a.chrf)
  const best = ranked.slice(0, 5)
  const worst = ranked.slice(-5).reverse()
  const split = run.samples_capped && run.samples.length >= 10

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[95vw] max-w-5xl sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{run.model}</DialogTitle>
          <DialogDescription>
            {run.label}.json — click outside or press escape to close
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Meta label="Provider" value={run.provider} />
          <Meta label="Prompt style" value={run.prompt_style} />
          <Meta label="Pairs" value={String(run.pairs)} />
          <Meta label="chrF / ++ / BLEU" value={`${run.metrics.chrf} / ${run.metrics.chrfpp} / ${run.metrics.bleu}`} />
          <Meta label="Metric backend" value={run.metric_backend} />
          <Meta label="Exact match" value={`${run.exact_match_rate ?? '—'}%`} />
          <Meta label="s/sentence" value={run.seconds_per_sentence?.toFixed(3) ?? '—'} />
          <Meta label="Timestamp" value={run.timestamp ? formatDateTime(run.timestamp) : '—'} />
        </dl>

        <Separator />

        <Replicate run={run} />

        <Separator />

        <CategoryBars categories={run.chrf_by_category} />

        <Separator />

        {split ? (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-emerald-500 dark:text-emerald-400">
                Best 5 samples (highest per-sentence chrF)
              </h3>
              <div className="space-y-3">
                {best.map((sample) => (
                  <SampleBlock key={sample.id} sample={sample} />
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-red-500 dark:text-red-400">
                Worst 5 samples (lowest per-sentence chrF)
              </h3>
              <div className="space-y-3">
                {worst.map((sample) => (
                  <SampleBlock key={sample.id} sample={sample} />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              All {run.samples.length} samples (sorted by per-sentence chrF)
            </h3>
            <div className="space-y-3">
              {ranked.map((sample) => (
                <SampleBlock key={sample.id} sample={sample} />
              ))}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
