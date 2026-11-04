// @ts-nocheck
// Stub of noclip's SaveManager. We don't persist scene state or settings;
// the only callsites that matter to us read settings with a default fallback,
// so we always return the default and ignore writes.

export type SettingCallback = (saveManager: SaveManager, key: string) => void;

export enum SaveStateLocation {
    LocalStorage,
    SessionStorage,
    Defaults,
    None,
}

interface SettingListener {
    callback: SettingCallback;
    key: string;
}

export class SaveManager {
    private listeners: SettingListener[] = [];

    public loadSetting<T>(_key: string, defaultValue: T): T {
        return defaultValue;
    }
    public saveSetting<T>(_key: string, _value: T): void {}
    public addSettingListener(key: string, callback: SettingCallback, callImmediately = true): void {
        this.listeners.push({ key, callback });
        if (callImmediately) callback(this, key);
    }
    public callSettingsListener(key: string): void {
        for (const l of this.listeners) if (l.key === key) l.callback(this, key);
    }
    public getCurrentSceneDescId(): string | null { return null; }
    public saveTemporaryState(_key: string, _state: string): void {}
    public loadState(_key: string): string | null { return null; }
    public deleteState(_key: string): void {}
    public getSaveStateLocation(_key: string): SaveStateLocation { return SaveStateLocation.None; }
}

export const GlobalSaveManager = new SaveManager();
