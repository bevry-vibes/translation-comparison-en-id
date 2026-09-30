import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, ShieldCheck, ShieldX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SamplesDialog } from '@/components/samples-dialog'
import { heatText, renderTokens } from '@/lib/data'
import { providerCode } from '../../tools/models.ts'
import type { Cost, RunRow, SurvivalRow } from '@/types'

export type TableMode = 'quality' | 'survival'

type SortDir = 'asc' | 'desc'

interface Column {
  key: string
  label: string
  numeric: boolean
  title?: string
  value: (run: RunRow) => string | number
  render?: (run: RunRow) => React.ReactNode
  defaultDir?: SortDir
}

function FailuresDialog({
  row,
  open,
  onOpenChange,
}: {
  row: SurvivalRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!row) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            {row.model} — {row.passed}/{row.total} segments survived
          </DialogTitle>
          <DialogDescription>
            {row.label}.json — every expected protection token must survive with the right index,
            full count, and round-trip through restoration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {row.failures.map((failure) => (
            <div key={failure.id} className="rounded-lg border bg-card/50 p-3">
              <div className="mb-1.5 font-mono text-xs font-semibold text-red-500 dark:text-red-400">
                {failure.id}
              </div>
              <ul className="mb-2 list-disc space-y-1 ps-5 text-xs text-foreground/80">
                {failure.failures.map((line, index) => (
                  <li key={index}>{renderTokens(line)}</li>
                ))}
              </ul>
              <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Raw hypothesis
              </div>
              <div className="font-mono text-xs">{renderTokens(failure.hypothesis)}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function metricCell(run: RunRow, key: 'chrf' | 'chrfpp' | 'bleu') {
  const isBest = run.best[key]
  return (
    <span
      className={
        isBest
          ? 'font-semibold tabular-nums text-emerald-500 dark:text-emerald-400'
          : 'tabular-nums text-foreground/80'
      }
    >
      {run.metrics[key].toFixed(2)}
    </span>
  )
}

function formatCost(value: number) {
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
}

/** collapsed rows bill at the cheapest provider listing; hover lists them all */
function cheapestCost(run: RunRow): Cost | null {
  if (run.canonical) {
    const priced = run.canonical.runs.filter((p) => p.cost)
    if (priced.length > 0) {
      return priced.reduce((a, b) =>
        a.cost!.input + (a.cost!.output ?? 0) <= b.cost!.input + (b.cost!.output ?? 0) ? a : b,
      ).cost!
    }
  }
  return run.cost
}

function costCell(run: RunRow) {
  const cost = cheapestCost(run)
  if (!cost) return <span className="text-muted-foreground">—</span>
  const text =
    cost.unit === 'M characters'
      ? `${formatCost(cost.input)} /M chars`
      : `${formatCost(cost.input)} / ${cost.output === null ? '—' : formatCost(cost.output)}`
  let title = `${cost.source} — per ${cost.unit}, input${cost.output === null ? '' : ' then output'}`
  if (run.canonical) {
    const listings = run.canonical.runs
      .map((p) => {
        if (!p.cost) return `${providerCode(p.provider)}: no listing`
        const value =
          p.cost.unit === 'M characters'
            ? `${formatCost(p.cost.input)}/M chars`
            : `${formatCost(p.cost.input)}/${p.cost.output === null ? '—' : formatCost(p.cost.output)}`
        return `${providerCode(p.provider)} ${value}${p.note ? ` (${p.note})` : ''}`
      })
      .join(' · ')
    title = `Cheapest of ${run.canonical.runs.length} providers — ${listings} · per ${cost.unit}`
  }
  return (
    <span className="font-mono text-[12px] tabular-nums text-foreground/80" title={title}>
      {text}
    </span>
  )
}

function modelCell(run: RunRow) {
  if (!run.canonical) {
    return (
      <div className="flex flex-col">
        <span className="font-mono text-[13px] font-medium">{run.model}</span>
        <span className="text-[11px] text-muted-foreground">{run.provider}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[13px] font-medium">{run.canonical.name}</span>
      <div className="flex flex-wrap gap-1">
        {run.canonical.runs.map((p) => (
          <Badge
            key={p.label}
            variant={p.provider === run.canonical!.primary_provider ? 'default' : 'outline'}
            className="px-1 py-0 font-mono text-[10px]"
            title={
              `${p.provider} — ${p.model_id} · chrF ${p.metrics.chrf.toFixed(2)}` +
              (p.note ? ` · ${p.note}` : '') +
              (p.provider === run.canonical!.primary_provider ? ' · scores shown' : '')
            }
          >
            {providerCode(p.provider)}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/** best masked variant of a model: most surviving segments, then higher restored chrF */
function bestVariant(rows: SurvivalRow[]): SurvivalRow | null {
  if (rows.length === 0) return null
  return [...rows].sort(
    (a, b) => b.passed - a.passed || b.restored_chrf - a.restored_chrf,
  )[0]
}

export function RunsTable({
  runs,
  survival,
  mode,
}: {
  runs: RunRow[]
  survival: SurvivalRow[]
  mode: TableMode
}) {
  const [sortKey, setSortKey] = useState('chrf')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<RunRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [failureRow, setFailureRow] = useState<SurvivalRow | null>(null)
  const [failureOpen, setFailureOpen] = useState(false)

  // survival runs are siblings of the plain runs; join them on the canonical
  // model id so collapsed multi-provider rows pick up every provider's matrix.
  // A model can carry several masked variants (e.g. glm-4.7-flash with and
  // without the preservation instruction).
  const survivalByModel = useMemo(() => {
    const map = new Map<string, SurvivalRow[]>()
    for (const row of survival) {
      const key = row.canonical_id ?? row.model
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return map
  }, [survival])

  const bestRestored = useMemo(
    () => Math.max(0, ...survival.map((s) => s.restored_chrf)),
    [survival],
  )

  const qualityColumns: Column[] = useMemo(
    () => [
      {
        key: 'model',
        label: 'Model',
        numeric: false,
        value: (r) => r.canonical?.name ?? r.model,
        render: modelCell,
      },
      {
        key: 'prompt_style',
        label: 'Prompt',
        numeric: false,
        value: (r) => r.prompt_style,
        render: (r) => (
          <Badge variant="secondary" className="font-mono text-[11px]">
            {r.prompt_style}
          </Badge>
        ),
      },
      {
        key: 'pairs',
        label: 'Pairs',
        numeric: true,
        value: (r) => r.pairs,
        render: (r) => <span className="tabular-nums text-foreground/80">{r.pairs}</span>,
      },
      {
        key: 'chrf',
        label: 'chrF',
        numeric: true,
        title: 'Corpus chrF, 0-100, higher is better',
        value: (r) => r.metrics.chrf,
        render: (r) => <>{metricCell(r, 'chrf')}</>,
      },
      {
        key: 'chrfpp',
        label: 'chrF++',
        numeric: true,
        title: 'Corpus chrF++ (word order), 0-100, higher is better',
        value: (r) => r.metrics.chrfpp,
        render: (r) => <>{metricCell(r, 'chrfpp')}</>,
      },
      {
        key: 'bleu',
        label: 'BLEU',
        numeric: true,
        title: 'Corpus BLEU, 0-100, higher is better',
        value: (r) => r.metrics.bleu,
        render: (r) => <>{metricCell(r, 'bleu')}</>,
      },
      {
        key: 'seconds_per_sentence',
        label: 's/sentence',
        numeric: true,
        title: 'Seconds per sentence; hosted rows time network round trips',
        value: (r) => r.seconds_per_sentence ?? Number.POSITIVE_INFINITY,
        render: (r) => (
          <span className="tabular-nums text-foreground/80">
            {r.seconds_per_sentence?.toFixed(3) ?? '—'}
          </span>
        ),
      },
      {
        key: 'cost',
        label: 'Cost $/M',
        numeric: true,
        title:
          'List price per million tokens, input then output (Kagi: characters). Sources: models.dev, provider catalogues. Collapsed rows show the cheapest provider',
        value: (r) => {
          const cost = cheapestCost(r)
          return cost ? cost.input + (cost.output ?? 0) : Number.POSITIVE_INFINITY
        },
        render: costCell,
      },
      {
        key: 'file',
        label: 'Result file',
        numeric: false,
        defaultDir: 'asc' as SortDir,
        value: (r) => r.file,
        render: (r) => (
          <span className="font-mono text-[11px] text-muted-foreground">{r.file}</span>
        ),
      },
    ],
    [],
  )

  const survivalColumns: Column[] = [
    {
      key: 'model',
      label: 'Model',
      numeric: false,
      value: (r) => r.canonical?.name ?? r.model,
      render: modelCell,
    },
    {
      key: 'prompt_style',
      label: 'Prompt',
      numeric: false,
      value: (r) => r.prompt_style,
      render: (r) => (
        <Badge variant="secondary" className="font-mono text-[11px]">
          {r.prompt_style}
        </Badge>
      ),
    },
    {
      key: 'survived',
      label: 'Survived',
      numeric: true,
      title: 'Masked segments whose protection tokens all survived, out of the masked set',
      value: (r) => bestVariant(survivalByModel.get(r.canonical?.id ?? r.model) ?? [])?.passed ?? -1,
      render: (r) => {
        const variants = survivalByModel.get(r.canonical?.id ?? r.model) ?? []
        if (variants.length === 0) return <span className="text-muted-foreground">—</span>
        const multiProvider = new Set(variants.map((v) => v.provider)).size > 1
        return (
          <div className="flex flex-col items-end gap-1">
            {variants.map((variant) => {
              const passed = variant.verdict === 'PASS'
              return (
                <span key={variant.label} className="inline-flex items-center gap-1.5">
                  {variants.length > 1 && (
                    <Badge
                      variant="outline"
                      className="px-1 py-0 font-mono text-[10px]"
                      title={`${variant.provider} — ${variant.label}`}
                    >
                      {multiProvider ? `${providerCode(variant.provider)}·` : ''}
                      {variant.prompt_style}
                    </Badge>
                  )}
                  <span className="font-mono text-[13px] tabular-nums">
                    {variant.passed}/{variant.total}
                  </span>
                  {passed ? (
                    <ShieldCheck className="size-3.5 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <ShieldX className="size-3.5 text-red-500 dark:text-red-400" />
                  )}
                </span>
              )
            })}
          </div>
        )
      },
    },
    {
      key: 'restored_chrf',
      label: 'Restored chrF',
      numeric: true,
      title: 'chrF of the restored hypothesis vs the masked-set reference; secondary quality hint',
      value: (r) => bestVariant(survivalByModel.get(r.canonical?.id ?? r.model) ?? [])?.restored_chrf ?? -1,
      render: (r) => {
        const best = bestVariant(survivalByModel.get(r.canonical?.id ?? r.model) ?? [])
        if (!best) return <span className="text-muted-foreground">—</span>
        return (
          <span
            className={`font-mono text-[13px] tabular-nums ${
              best.restored_chrf === bestRestored
                ? 'font-semibold text-emerald-500 dark:text-emerald-400'
                : ''
            }`}
            style={{ color: best.restored_chrf === bestRestored ? undefined : heatText(best.restored_chrf) }}
          >
            {best.restored_chrf.toFixed(2)}
          </span>
        )
      },
    },
    {
      key: 'failures',
      label: 'Failures',
      numeric: true,
      value: (r) => {
        const best = bestVariant(survivalByModel.get(r.canonical?.id ?? r.model) ?? [])
        return best ? best.total - best.passed : -1
      },
      render: (r) => {
        const best = bestVariant(survivalByModel.get(r.canonical?.id ?? r.model) ?? [])
        if (!best || best.failures.length === 0)
          return <span className="text-xs text-muted-foreground">—</span>
        return (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={(event) => {
              event.stopPropagation()
              setFailureRow(best)
              setFailureOpen(true)
            }}
          >
            {best.failures.length} segment{best.failures.length === 1 ? '' : 's'}
          </Button>
        )
      },
    },
    {
      key: 'cost',
      label: 'Cost $/M',
      numeric: true,
      title:
        'List price per million tokens, input then output (Kagi: characters). Sources: models.dev, provider catalogues. Collapsed rows show the cheapest provider',
      value: (r) => {
        const cost = cheapestCost(r)
        return cost ? cost.input + (cost.output ?? 0) : Number.POSITIVE_INFINITY
      },
      render: costCell,
    },
  ]

  const columns = mode === 'survival' ? survivalColumns : qualityColumns

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey)
    if (!column) return runs // e.g. a quality sort key while in survival mode: keep the chrF order
    const dir = sortDir === 'asc' ? 1 : -1
    return [...runs].sort((a, b) => {
      const av = column.value(a)
      const bv = column.value(b)
      if (av === bv) return a.label.localeCompare(b.label)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [runs, sortKey, sortDir, columns])

  function toggleSort(column: Column) {
    if (sortKey === column.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(column.key)
      setSortDir(column.defaultDir ?? (column.numeric ? 'desc' : 'asc'))
    }
  }

  function openRun(run: RunRow) {
    setSelected(run)
    setDialogOpen(true)
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => {
                const active = sortKey === column.key
                return (
                  <TableHead key={column.key} className={column.numeric ? 'text-right' : ''}>
                    <button
                      type="button"
                      title={column.title ?? `Sort by ${column.label}`}
                      onClick={() => toggleSort(column)}
                      className={`inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors hover:text-foreground ${
                        active ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {column.label}
                      {active ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((run) => (
              <TableRow
                key={run.label}
                onClick={() => openRun(run)}
                className="cursor-pointer"
                title="Click to inspect per-sentence samples"
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.numeric ? 'text-right' : ''}>
                    {column.render ? column.render(run) : String(column.value(run))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {mode === 'quality' ? (
          <>
            <span className="font-semibold text-emerald-500 dark:text-emerald-400">Green values</span>
            {` `}mark the best score per column. Latency is only comparable within hosted vs local
            backends. Cost is list price per million tokens, input then output — aggregated from{' '}
            <span className="font-mono">models.dev</span> and the provider catalogues (Kagi bills
            per million characters; local rows are free). Hover the cost for its source. Click any
            row for its best/worst samples. The same open-weight model measured at several
            providers collapses into one row: provider badges show where it ran (filled = the
            provider whose scores are shown), and the cost cell shows the cheapest listing.
          </>
        ) : (
          <>
            Survival is measured on the separate 10-segment masked-name set (names wrapped in
            protection tokens), usually with the{' '}
            <span className="font-mono">engine-preserve</span> instruction — not on the plain set,
            whose chrF order the rows keep. Where a model ran the masked set with several prompts,
            every variant is listed. Click a failure count for the per-segment detail, or a row for
            its plain-set samples.
          </>
        )}
      </p>
      <SamplesDialog run={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
      <FailuresDialog row={failureRow} open={failureOpen} onOpenChange={setFailureOpen} />
    </>
  )
}
