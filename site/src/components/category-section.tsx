import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { heatText } from '@/lib/data'
import type { DirectionData } from '@/types'

export function CategorySection({ direction }: { direction: DirectionData }) {
  const entries = Object.entries(direction.best_run.chrf_by_category).sort(
    ([, a], [, b]) => a - b,
  )

  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="text-base">Category chrF</CardTitle>
        <CardDescription>
          Average per-sentence chrF by category for the best {direction.direction} run{' '}
          <span className="font-mono text-foreground/80">{direction.best_run.file}</span> — weakest
          categories first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Category
              </TableHead>
              <TableHead className="w-[40%] text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Avg chrF
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([category, value]) => (
              <TableRow key={category} className="hover:bg-transparent">
                <TableCell className="py-2 font-mono text-[13px]">{category}</TableCell>
                <TableCell className="py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${value}%`, backgroundColor: heatText(value) }}
                      />
                    </div>
                    <span
                      className="w-14 text-right font-mono text-xs tabular-nums"
                      style={{ color: heatText(value) }}
                    >
                      {value.toFixed(2)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
