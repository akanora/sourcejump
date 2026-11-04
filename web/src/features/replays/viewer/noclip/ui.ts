// @ts-nocheck
// Stub for noclip's UI module — replaces the 3000-line DOM panel system.
// The vendored Source engine code references a few symbols (Panel, Checkbox,
// COOL_BLUE_COLOR, RENDER_HACKS_ICON, TextureListHolder, createDOMFromString)
// for its createPanels() debug UI. We expose no-op stand-ins so the imports
// resolve; createPanels() output is never rendered in the replay viewer.

export const COOL_BLUE_COLOR = '#22a3d6';
export const RENDER_HACKS_ICON = '';

export class Panel {
    customHeaderBackgroundColor: string = '';
    setTitle(_icon: string, _title: string): void {}
    contents = document.createElement('div');
    elem = document.createElement('div');
}

export class Checkbox {
    declare checked: boolean;
    elem = document.createElement('div');
    onchanged: (() => void) | null = null;
    constructor(_label: string, defaultValue: boolean = false) {
        this.checked = defaultValue;
    }
    setLabel(_: string): void {}
}

export class TextureListHolder {
    viewerTextures: unknown[] = [];
    onnewtextures: (() => void) | null = null;
}

export function createDOMFromString(_s: string): DocumentFragment {
    return document.createDocumentFragment();
}

// Additional symbols imported by other vendored modules (DebugJunk,
// DebugFloaters). Stubbed because we never instantiate the floating UI.
export class Slider {
    elem = document.createElement('div');
    onvalue: ((v: number) => void) | null = null;
    setLabel(_: string): void {}
    setRange(_min: number, _max: number, _step?: number): void {}
    setValue(_v: number): void {}
    getValue(): number { return 0; }
}

export class Widget {
    elem = document.createElement('div');
}

export const HIGHLIGHT_COLOR = '#22a3d6';

export function setElementHighlighted(_el: HTMLElement, _highlighted: boolean): void {}
