import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SamplesDialog } from '@/components/samples-dialog'
import type { RunRow } from '@/types'

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

export function RunsTable({ runs }: { runs: RunRow[] }) {
  const [sortKey, setSortKey] = useState('chrf')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<RunRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const columns: Column[] = useMemo(
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

  const sorted = useMemo(() => {
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
        <span className="font-semibold text-emerald-500 dark:text-emerald-400">Green values</span>
        {` `}mark the best score per column. Latency is only comparable within hosted vs local
        backends. Click any row for its best/worst samples.
      </p>
      <SamplesDialog run={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
