import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, ShieldCheck, ShieldX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FailuresDialog } from '@/components/survival-section'
import { SamplesDialog } from '@/components/samples-dialog'
import { heatText } from '@/lib/data'
import type { RunRow, SurvivalRow } from '@/types'

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

  // survival runs are siblings of the plain runs; join them on the model id.
  // A model can carry several masked variants (e.g. glm-4.7-flash with and
  // without the preservation instruction).
  const survivalByModel = useMemo(() => {
    const map = new Map<string, SurvivalRow[]>()
    for (const row of survival) {
      const list = map.get(row.model) ?? []
      list.push(row)
      map.set(row.model, list)
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
        value: (r) => r.model,
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-mono text-[13px] font-medium">{r.model}</span>
            <span className="text-[11px] text-muted-foreground">{r.provider}</span>
          </div>
        ),
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
      value: (r) => r.model,
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-mono text-[13px] font-medium">{r.model}</span>
          <span className="text-[11px] text-muted-foreground">{r.provider}</span>
        </div>
      ),
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
      value: (r) => bestVariant(survivalByModel.get(r.model) ?? [])?.passed ?? -1,
      render: (r) => {
        const variants = survivalByModel.get(r.model) ?? []
        if (variants.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-col items-end gap-1">
            {variants.map((variant) => {
              const passed = variant.verdict === 'PASS'
              return (
                <span key={variant.label} className="inline-flex items-center gap-1.5">
                  {variants.length > 1 && (
                    <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">
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
      value: (r) => bestVariant(survivalByModel.get(r.model) ?? [])?.restored_chrf ?? -1,
      render: (r) => {
        const best = bestVariant(survivalByModel.get(r.model) ?? [])
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
      numeric: false,
      value: (r) => {
        const best = bestVariant(survivalByModel.get(r.model) ?? [])
        return best ? best.total - best.passed : -1
      },
      render: (r) => {
        const best = bestVariant(survivalByModel.get(r.model) ?? [])
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
  ]

  const columns = mode === 'survival' ? survivalColumns : qualityColumns
  const sortable = mode === 'quality'

  const sorted = useMemo(() => {
    if (!sortable) return runs
    const column = columns.find((c) => c.key === sortKey)
    if (!column) return runs
    const dir = sortDir === 'asc' ? 1 : -1
    return [...runs].sort((a, b) => {
      const av = column.value(a)
      const bv = column.value(b)
      if (av === bv) return a.label.localeCompare(b.label)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [runs, sortKey, sortDir, columns, sortable])

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
                const active = sortable && sortKey === column.key
                const head = (
                  <>
                    {column.label}
                    {active &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                    {sortable && !active && (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    )}
                  </>
                )
                return (
                  <TableHead key={column.key} className={column.numeric ? 'text-right' : ''}>
                    {sortable ? (
                      <button
                        type="button"
                        title={column.title ?? `Sort by ${column.label}`}
                        onClick={() => toggleSort(column)}
                        className={`inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors hover:text-foreground ${
                          active ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {head}
                      </button>
                    ) : (
                      <span
                        title={column.title}
                        className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                      >
                        {head}
                      </span>
                    )}
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
            backends. Click any row for its best/worst samples.
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
