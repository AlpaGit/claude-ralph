import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { List, useListRef } from "react-window";
import { RingBuffer } from "./RingBuffer";
import { toastService } from "../../services/toastService";
import styles from "./ULogViewer.module.css";

/* ── Constants ────────────────────────────────────────── */

const LINE_HEIGHT = 20; // px -- monospace line height
const DEFAULT_HEIGHT = 400;
const DEFAULT_CAPACITY = 5_000;

/* ── ANSI strip helper ────────────────────────────────── */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/* ── Helpers ──────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Public types ─────────────────────────────────────── */

export interface ULogViewerProps {
  /** Externally managed log lines. When provided, the internal RingBuffer is bypassed. */
  lines?: string[];
  /** Max lines held in the internal RingBuffer. Default 5 000. */
  capacity?: number;
  /** CSS height of the log viewport. Default 400. */
  height?: number;
  /** Show line numbers. Default true. */
  showLineNumbers?: boolean;
  /** Auto-scroll to bottom on new lines. Default true. */
  autoScroll?: boolean;
  /**
   * Number of log lines that have been dropped due to ring buffer overflow.
   * When > 0, a truncation indicator is shown in the footer.
   */
  truncatedCount?: number;
  /** Extra CSS class on the root element. */
  className?: string;
  /** Extra inline style on the root element. */
  style?: CSSProperties;
}

export interface ULogViewerHandle {
  /** Push a single line into the internal ring buffer. No-op when `lines` prop is used. */
  push(line: string): void;
  /** Push multiple lines. */
  pushMany(lines: string[]): void;
  /** Clear all lines in the internal buffer. No-op when `lines` prop is used. */
  clear(): void;
  /** Copy all visible lines to clipboard. */
  copyAll(): Promise<void>;
  /** Scroll to the bottom of the list. */
  scrollToBottom(): void;
}

/* ── Row renderer (react-window v2 API) ───────────────── */

interface RowProps {
  filteredLines: string[];
  filteredIndices: number[];
  showLineNumbers: boolean;
  searchTerm: string;
}

function RowComponent(
  props: {
    ariaAttributes: {
      "aria-posinset": number;
      "aria-setsize": number;
      role: "listitem";
    };
    index: number;
    style: CSSProperties;
  } & RowProps,
): ReactElement | null {
  const {
    index,
    style: rowStyle,
    filteredLines,
    filteredIndices,
    showLineNumbers,
    searchTerm,
  } = props;
  const text = stripAnsi(filteredLines[index]);
  const lineNum = filteredIndices[index] + 1; // 1-based
  const isMatch = searchTerm.length > 0;

  return (
    <div className={cn(styles.row, isMatch && styles.highlight)} style={rowStyle}>
      {showLineNumbers && <span className={styles.lineNumber}>{lineNum}</span>}
      <span className={styles.lineText}>{text}</span>
    </div>
  );
}

/* ── Component ────────────────────────────────────────── */

export function ULogViewer(props: ULogViewerProps): ReactNode {
  const {
    lines: externalLines,
    capacity = DEFAULT_CAPACITY,
    height = DEFAULT_HEIGHT,
    showLineNumbers = true,
    autoScroll: autoScrollProp = true,
    truncatedCount = 0,
    className,
    style,
  } = props;

  /* Internal ring buffer for imperative push() usage */
  const bufferRef = useRef<RingBuffer<string>>(new RingBuffer(capacity));
  const [bufVersion, setBufVersion] = useState(0);

  /* Resolve active lines -- external prop or internal buffer */
  const allLines = useMemo(() => {
    if (externalLines) return externalLines;
    // bufVersion ensures re-computation on push
    void bufVersion;
    return bufferRef.current.toArray();
  }, [externalLines, bufVersion]);

  /* Auto-scroll state */
  const [autoScroll, setAutoScroll] = useState(autoScrollProp);
  const listRef = useListRef(null);

  /* Fullscreen state */
  const [fullscreen, setFullscreen] = useState(false);

  /* Search / filter */
  const [searchTerm, setSearchTerm] = useState("");

  const { filteredLines, filteredIndices } = useMemo(() => {
    if (!searchTerm) {
      return {
        filteredLines: allLines,
        filteredIndices: allLines.map((_, i) => i),
      };
    }
    const lower = searchTerm.toLowerCase();
    const fl: string[] = [];
    const fi: number[] = [];
    for (let i = 0; i < allLines.length; i++) {
      if (stripAnsi(allLines[i]).toLowerCase().includes(lower)) {
        fl.push(allLines[i]);
        fi.push(i);
      }
    }
    return { filteredLines: fl, filteredIndices: fi };
  }, [allLines, searchTerm]);

  /* Auto-scroll to bottom when lines change */
  useEffect(() => {
    if (autoScroll && filteredLines.length > 0 && listRef.current) {
      listRef.current.scrollToRow({ index: filteredLines.length - 1, align: "end" });
    }
  }, [autoScroll, filteredLines.length, listRef]);

  /* Track visible rows to detect if user has scrolled away from bottom */
  const lastVisibleRowRef = useRef<number>(-1);

  const handleRowsRendered = useCallback(
    (
      _visibleRows: { startIndex: number; stopIndex: number },
      allRows: { startIndex: number; stopIndex: number },
    ) => {
      const atBottom = allRows.stopIndex >= filteredLines.length - 2;
      lastVisibleRowRef.current = allRows.stopIndex;
      if (!atBottom && autoScroll) {
        setAutoScroll(false);
      }
    },
    [autoScroll, filteredLines.length],
  );

  /* Scroll to bottom action */
  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    if (listRef.current && filteredLines.length > 0) {
      listRef.current.scrollToRow({ index: filteredLines.length - 1, align: "end" });
    }
  }, [filteredLines.length, listRef]);

  /* Copy all visible lines */
  const copyAll = useCallback(async () => {
    const text = filteredLines.map(stripAnsi).join("\n");
    await navigator.clipboard.writeText(text);
    toastService.success("Logs copied to clipboard.");
  }, [filteredLines]);

  /* Expose imperative handle via a stable ref object for advanced usage.
     The typical usage pattern is via the `lines` prop, not imperative push. */
  const handleRef = useRef<ULogViewerHandle>({
    push(line: string) {
      if (externalLines) return;
      bufferRef.current.push(line);
      setBufVersion((v) => v + 1);
    },
    pushMany(lines: string[]) {
      if (externalLines) return;
      for (const l of lines) bufferRef.current.push(l);
      setBufVersion((v) => v + 1);
    },
    clear() {
      if (externalLines) return;
      bufferRef.current.clear();
      setBufVersion((v) => v + 1);
    },
    copyAll,
    scrollToBottom,
  });

  // Keep handle methods fresh
  handleRef.current.copyAll = copyAll;
  handleRef.current.scrollToBottom = scrollToBottom;

  /* Compute viewport height */
  const viewportHeight = fullscreen ? window.innerHeight - 60 : height;

  /* Row props for the List renderer (memoised to avoid re-renders) */
  const rowProps: RowProps = useMemo(
    () => ({ filteredLines, filteredIndices, showLineNumbers, searchTerm }),
    [filteredLines, filteredIndices, showLineNumbers, searchTerm],
  );

  return (
    <div className={cn(styles.viewer, fullscreen && styles.fullscreen, className)} style={style}>
      {/* ── Toolbar ─────────────────────────── */}
      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Filter logs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Filter log lines"
        />
        {searchTerm && (
          <span className={styles.matchCount}>
            {filteredLines.length}/{allLines.length}
          </span>
        )}
        <button
          className={cn(styles.toolbarBtn, autoScroll && styles.active)}
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          aria-pressed={autoScroll}
        >
          {autoScroll ? "Auto" : "Manual"}
        </button>
        <button
          className={styles.toolbarBtn}
          onClick={() => void copyAll()}
          title="Copy all visible lines"
        >
          Copy
        </button>
        <button
          className={cn(styles.toolbarBtn, fullscreen && styles.active)}
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Exit fullscreen" : "Expand fullscreen"}
          aria-pressed={fullscreen}
        >
          {fullscreen ? "Exit" : "Full"}
        </button>
      </div>

      {/* ── Virtualized log list ────────────── */}
      <div className={styles.listContainer} style={{ height: viewportHeight }}>
        <List<RowProps>
          listRef={listRef}
          rowComponent={RowComponent}
          rowCount={filteredLines.length}
          rowHeight={LINE_HEIGHT}
          rowProps={rowProps}
          onRowsRendered={handleRowsRendered}
          overscanCount={20}
          style={{ height: viewportHeight }}
        />
      </div>

      {/* ── Scroll-to-bottom pill (when not auto-scrolling) */}
      {!autoScroll && filteredLines.length > 0 && (
        <button className={styles.scrollIndicator} onClick={scrollToBottom}>
          Scroll to bottom
        </button>
      )}

      {/* ── Footer ──────────────────────────── */}
      <div className={styles.footer}>
        <span>{filteredLines.length} lines</span>
        {truncatedCount > 0 && (
          <span className={styles.truncatedIndicator}>
            {truncatedCount.toLocaleString()} older lines truncated
          </span>
        )}
        <span>capacity {capacity}</span>
      </div>
    </div>
  );
}
