import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FONT_SIZE = 13;
const FONT_FAMILY = "'DejaVu Sans Mono', ui-monospace, monospace";

/** ANSI colours (Ghostty zinc theme — matches command-centre's terminals) */
const DIM = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface RefreshStatus {
  task: string;
  status: 'running' | 'complete' | 'failed';
  started_at: string;
  updated_at: string;
  started_at_ms?: number;
  updated_at_ms?: number;
  done: number;
  total: number;
  current?: string;
  note?: string;
}

/** one ghostty-web terminal fed by polling the sweep scripts' progress file
 * (site/public/data/refresh-status.json, written by scripts/lib.sh
 * progress_emit). No PTY: the page only writes. Per the ghostty-web#141
 * memory-corruption note (see command-centre TermHost), a created terminal is
 * never freed — one component instance creates exactly one. */
export function RefreshTerminal() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const lastWritten = useRef<string>('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let closed = false;
    let term: import('ghostty-web').Terminal | null = null;
    let fitAddon: import('ghostty-web').FitAddon | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const write = (text: string) => term?.write(text);

    const render = (status: RefreshStatus) => {
      // timestamps render in the viewer's own timezone, from epoch millis
      const updatedMs = status.updated_at_ms ?? Date.parse(status.updated_at);
      const startedMs = status.started_at_ms ?? Date.parse(status.started_at);
      const stamp = new Date(updatedMs).toLocaleTimeString();
      const bar = (done: number, total: number) => {
        const width = 24;
        const filled = total > 0 ? Math.round((done / total) * width) : 0;
        return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
      };
      const eta = (done: number, total: number) => {
        if (status.status !== 'running' || done === 0 || done >= total) return null;
        const perLeg = (updatedMs - startedMs) / done;
        const remainingMs = (total - done) * perLeg;
        const minutes = Math.round(remainingMs / 60000);
        const completionClock = new Date(Date.now() + remainingMs).toLocaleTimeString();
        return `ETA ~${minutes}m · completes ~${completionClock}`;
      };
      const icon = status.status === 'complete' ? '✓' : status.status === 'failed' ? '✗' : '»';
      const colour = status.status === 'complete' ? GREEN : status.status === 'failed' ? RED : YELLOW;
      // dedupe on substance: the ETA completion clock shifts every poll and
      // must not spam the terminal — only genuine progress writes a line
      const dedupeKey = `${status.status}|${status.done}|${status.total}|${status.current ?? ''}`;
      if (dedupeKey === lastWritten.current) return;
      const first = lastWritten.current === '';
      lastWritten.current = dedupeKey;
      if (first) {
        write(
          `${DIM}translation-comparison — measurement refresh monitor${RESET}\r\n` +
            `${DIM}(fed by scripts/lib.sh progress_emit · polls every 4s)${RESET}\r\n\r\n`,
        );
      }
      write(
        `${DIM}[${stamp}]${RESET} ${colour}${icon}${RESET} ` +
          `${status.task}: ${status.done}/${status.total} ${bar(status.done, status.total)} ` +
          `${Math.round((status.done / Math.max(status.total, 1)) * 100)}%` +
          (status.current ? ` — ${status.current}` : '') +
          (eta(status.done, status.total) ? ` · ${YELLOW}${eta(status.done, status.total)}${RESET}` : '') +
          (status.note ? `\n  ${DIM}${status.note}${RESET}` : '') +
          '\r\n',
      );
    };

    const pollOnce = async () => {
      try {
        const response = await fetch('/data/refresh-status.json', { cache: 'no-store' });
        if (response.status === 404) {
          render({
            task: 'no refresh recorded yet',
            status: 'complete',
            started_at: '',
            updated_at: new Date().toISOString(),
            done: 0,
            total: 0,
            note: 'sweep scripts write public/data/refresh-status.json via scripts/lib.sh progress_emit',
          });
          if (poll) clearInterval(poll); // nothing will ever appear for a static deploy
          return;
        }
        render(await response.json());
      } catch {
        // fetch failures (dev server restart) — try again on the next tick
      }
    };

    const setup = async () => {
      const ghostty = await import('ghostty-web');
      await ghostty.init();
      try {
        await Promise.all([
          document.fonts.load(`${FONT_SIZE}px "DejaVu Sans Mono"`),
          document.fonts.load(`bold ${FONT_SIZE}px "DejaVu Sans Mono"`),
        ]);
      } catch {
        // font loading is best-effort; the stack falls back to system mono
      }
      if (closed) return;
      const terminal = new ghostty.Terminal({
        fontSize: FONT_SIZE,
        fontFamily: FONT_FAMILY,
        scrollback: 1000,
        theme: {
          background: '#09090b',
          foreground: '#fafafa',
          cursor: '#a1a1aa',
          selectionBackground: '#2653a8',
          selectionForeground: '#f4f4f5',
        },
      });
      terminal.open(container);
      fitAddon = new ghostty.FitAddon();
      terminal.loadAddon(fitAddon);
      fitAddon.fit();
      term = terminal;
      setReady(true);
      await pollOnce();
      poll = setInterval(pollOnce, 4000);
    };

    const scheduleFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAddon?.fit(), 200);
    };
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(container);

    setup().catch((e) => console.error('ghostty terminal failed to start', e));

    return () => {
      closed = true;
      if (poll) clearInterval(poll);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      // ghostty-web#141: WASM terminals are never freed — DOM only
      container.replaceChildren();
      term = null;
    };
  }, []);

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle className="text-base">Refresh monitor</CardTitle>
        <CardDescription>
          Live progress of the measurement sweeps — written by the sweep scripts, rendered in a
          ghostty-web terminal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className="h-40 w-full overflow-hidden rounded-lg border bg-[#09090b] p-2"
          data-ready={ready}
        />
      </CardContent>
    </Card>
  );
}
