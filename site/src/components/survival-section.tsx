import { useState } from 'react'
import { ShieldCheck, ShieldX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { heatText, renderTokens } from '@/lib/data'
import type { DirectionData, SurvivalRow } from '@/types'

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

export function SurvivalSection({ direction }: { direction: DirectionData }) {
  const [selected, setSelected] = useState<SurvivalRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (direction.token_survival.length === 0) return null

  function openFailures(row: SurvivalRow) {
    setSelected(row)
    setDialogOpen(true)
  }

  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="text-base">Masked-name token survival</CardTitle>
        <CardDescription>
          Production-style segments with names wrapped in protection tokens ({`⟨n⟩`}). A segment
          passes only when every name survives translation and restoration; one dropped name fails
          the run. Restored chrF is a secondary quality hint. Scored by{' '}
          <span className="font-mono text-foreground/80">eval/token_survival.py</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Model
                </TableHead>
                <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Prompt
                </TableHead>
                <TableHead className="text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Survived
                </TableHead>
                <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Verdict
                </TableHead>
                <TableHead className="text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Restored chrF
                </TableHead>
                <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Failures
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {direction.token_survival.map((row) => {
                const passed = row.verdict === 'PASS'
                return (
                  <TableRow key={row.label} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-[13px] font-medium">{row.model}</span>
                        <span className="text-[11px] text-muted-foreground">{row.provider}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {row.prompt_style}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums">
                      {row.passed}/{row.total}
                    </TableCell>
                    <TableCell>
                      {passed ? (
                        <Badge className="bg-emerald-500/15 text-emerald-500 dark:text-emerald-400">
                          <ShieldCheck className="size-3" />
                          PASS
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/15 text-red-500 dark:text-red-400">
                          <ShieldX className="size-3" />
                          FAIL
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right font-mono text-[13px] tabular-nums"
                      style={{ color: heatText(row.restored_chrf) }}
                    >
                      {row.restored_chrf.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {row.failures.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => openFailures(row)}
                        >
                          {row.failures.length} segment{row.failures.length === 1 ? '' : 's'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <FailuresDialog row={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
