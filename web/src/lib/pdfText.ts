interface TextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

/** Preserve PDF word boundaries, including fragments split across text objects. */
export function textLines(items: TextItem[]): string[] {
  const lines: string[] = [];
  let line = '';
  let previous: TextItem | undefined;
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
    previous = undefined;
  };
  for (const item of items) {
    if (previous && Math.abs(item.transform[5] - previous.transform[5]) > 2) flush();
    if (previous && line && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      const fontSize = Math.abs(item.transform[0]) || 10;
      if (gap > fontSize * 0.12) line += ' ';
    }
    line += item.str;
    previous = item;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}
