#!/bin/sh
# Lists instruction and doc files over their size budget. Exits 1 if any are over.
status=0
over() {
  limit=$1; shift
  for file in "$@"; do
    [ -f "$file" ] || continue
    size=$(wc -c < "$file" | tr -d ' ')
    if [ "$size" -gt "$limit" ]; then
      echo "$file: $size bytes (budget $limit)"
      status=1
    fi
  done
}
over 6000 CLAUDE.md
over 2000 $(find . -mindepth 2 -name CLAUDE.md -not -path '*/node_modules/*' -not -path './.git/*')
over 10000 docs/*.md
over 2000 docs/decisions/*.md
over 6000 docs/plans/*.md
exit $status
