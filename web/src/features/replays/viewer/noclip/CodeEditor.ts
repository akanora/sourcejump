// @ts-nocheck
// Stub for noclip's in-browser shader code editor. We never invoke this UI
// path, so the class is reduced to a typed placeholder that satisfies imports
// (UberShader.ts type-only references it).

export default class CodeEditor {
    public elem: HTMLElement = document.createElement('div');
    public onvaluechanged: (() => void) | null = null;
    public setLanguage(_lang: string): void {}
    public setText(_text: string): void {}
    public getText(): string { return ''; }
}
