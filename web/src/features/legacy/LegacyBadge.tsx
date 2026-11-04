// Marks a run from before SourceJump 2.0. Legacy runs show in a board's or profile's pre-2.0 views, but never
// count toward 2.0 records or placements.
import { Badge } from "@/ui/Badge";
import { Tooltip } from "@/ui/Tooltip";

export function LegacyBadge() {
  return (
    <Tooltip content="Set on the old site, before SourceJump 2.0. It doesn't count toward 2.0 records.">
      <Badge tone="warning" tabIndex={0}>
        Pre-2.0
      </Badge>
    </Tooltip>
  );
}
