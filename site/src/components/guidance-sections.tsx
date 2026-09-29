import { useState } from 'react'
import { Check, Copy, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { renderTokens } from '@/lib/data'
import type { PromptTemplate, Recommendation, SurvivalRow } from '@/types'

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : (label ?? 'Copy')}
    </Button>
  )
}

function VerbatimBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-card/50 p-3 font-mono text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

export function RecommendationSection({ recommendation }: { recommendation: Recommendation }) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-emerald-500 dark:text-emerald-400" />
          Current recommendation
          <Badge variant="outline" className="font-mono text-[10px]">
            {recommendation.updated}
          </Badge>
        </CardTitle>
        <CardDescription>{recommendation.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-emerald-500/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-emerald-500 dark:text-emerald-400">
              {recommendation.primary.model}
            </span>
            <Badge variant="secondary" className="font-mono text-[11px]">
              {recommendation.primary.provider}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[11px]">
              {recommendation.primary.prompt}
            </Badge>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-foreground/80">
            {recommendation.primary.why.map((line) => (
              <li key={line} className="flex gap-1.5">
                <Check className="mt-0.5 size-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {recommendation.alternatives.map((alt) => (
            <div key={alt.model} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-medium">{alt.model}</span>
                <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">
                  {alt.role}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{alt.why}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Disqualified <span className="font-semibold text-foreground">does not mean bad at translation</span> —
            several of these top the quality table. It means unusable for this production pipeline, which masks
            people&apos;s names into protection tokens before translating and restores them afterwards; the
            Token survival toggle shows exactly where each model drops them.
          </p>
          {recommendation.disqualified.map((entry) => (
            <div key={entry.reason} className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <ShieldX className="mt-0.5 size-3.5 shrink-0 text-red-500 dark:text-red-400" />
              <div>
                <span className="font-mono text-xs">{entry.models.join(', ')}</span>
                <p className="text-xs text-foreground/75">{entry.reason}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {recommendation.caveats.map((line) => (
            <p key={line}>• {line}</p>
          ))}
        </div>

        <div className="space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
          {recommendation.history.map((line, index) => (
            <p key={line}>
              {index + 1}. {line}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function PromptsSection({ prompts }: { prompts: Record<string, PromptTemplate> }) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="text-base">Prompts &amp; replication</CardTitle>
        <CardDescription>
          The verbatim prompt templates the harness sends, generated from{' '}
          <span className="font-mono text-foreground/80">eval/backends.py</span> — this page
          renders whatever the harness actually sent, never a hand-copied copy. Every run
          dialog carries a ready-to-run replication command.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {Object.entries(prompts).map(([style, template]) => (
          <div key={style} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[13px] font-semibold">{style}</span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </div>
            {template.system_message && (
              <VerbatimBlock label="system" text={template.system_message} />
            )}
            {template.user_message && (
              <VerbatimBlock label="user" text={template.user_message} />
            )}
            {template.request_body && (
              <VerbatimBlock
                label="request body"
                text={JSON.stringify(template.request_body, null, 2)}
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function AllFailuresSection({ survival }: { survival: SurvivalRow[] }) {
  const [open, setOpen] = useState(false)
  const failing = survival.filter((row) => row.failures.length > 0)
  if (failing.length === 0) return null
  const total = failing.reduce((n, row) => n + row.failures.length, 0)
  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-red-500 dark:text-red-400" />
          Masked-name survival failures
        </CardTitle>
        <CardDescription>
          Every failing segment across all masked runs — the full listing behind the survival
          verdicts ({total} segment{total === 1 ? '' : 's'} in {failing.length} run
          {failing.length === 1 ? '' : 's'}). A segment fails when a protection token is
          dropped, renumbered or left behind, or a name does not survive restoration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} all failures
        </Button>
        {open && (
          <div className="mt-4 space-y-5">
            {failing.map((row) => (
              <div key={row.label} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{row.model}</span>
                  <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">
                    {row.prompt_style}
                  </Badge>
                  <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">
                    {row.direction}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.passed}/{row.total} survived
                  </span>
                </div>
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
