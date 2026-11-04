"use client";
// Switches between panels on one page, e.g. a profile's styles. Follows the WAI-ARIA tabs pattern.
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { classNames } from "./classNames";
import { tabStyles, type TabVariant as Variant } from "./tabStyles";

export interface Tab {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export function Tabs({
  tabs,
  defaultTab,
  variant = "underline",
  label,
}: {
  tabs: Tab[];
  defaultTab?: string;
  variant?: Variant;
  /** Names the tab list for screen readers. */
  label: string;
}) {
  const [selected, setSelected] = useState(defaultTab ?? tabs[0]?.id);
  const baseId = useId();
  const styles = tabStyles[variant];

  // Arrow keys move between tabs and select them; Tab moves on into the panel.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === selected);
    const next = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    if (!tab) return;
    setSelected(tab.id);
    document.getElementById(`${baseId}-tab-${tab.id}`)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        className={styles.list}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              className={classNames(
                "transition-colors duration-(--duration-fast)",
                styles.tab,
                isSelected ? styles.active : styles.idle,
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== selected}
          className="motion-enter"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
