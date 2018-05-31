import { Disposable, Uri, EventEmitter, workspace } from "vscode";
import { ExtensionInstance } from "./extension";
import { GitRepository } from "./gitProvider";
import { EXTENSION_NAMESPACE } from "./constants";

export interface ViewContext {
    repo: GitRepository;
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
    branch?: string;
    line?: number;
    author?: string;
}

export class BaseViewProvider {
    protected disposables: Disposable[] = [];
    protected currentContext: ViewContext;
    protected configuration: any;
    
    protected readonly _onDidChange = new EventEmitter<any>();
    public readonly onDidChange = this._onDidChange.event;

    public get context(): ViewContext {
        return this.currentContext || { repo: undefined };
    }
    
    public setContext(context: ViewContext) {
        this.currentContext = context;
        this.onContextChanged();
    }

    public constructor(
        protected container: ExtensionInstance, 
        protected configKey: string
    ) {
        this.configuration = new Configuration(configKey);
        this.disposables.push(
            this.configuration.onDidChange(() => this.onConfigurationChanged()),
            this._onDidChange,
        );
    }
    
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    public onContextChanged(): void {}

    public onConfigurationChanged(): void {}
}

export class Configuration {
    protected readonly _onDidChange = new EventEmitter<string[]>();
    public readonly onDidChange = this._onDidChange.event;
    protected config = workspace.getConfiguration(this.section);
    
    public constructor(protected section: string = EXTENSION_NAMESPACE) {
        for (let key in this.config) {
            if (typeof this.config[key] === 'object') {
                this[key] = new Configuration(this.section + '.' + key);
            } else if (typeof this.config[key] !== 'function') {
                Object.defineProperty(this, key, {
                    get: () => this.config.get(key),
                    set: (value) => this.config.update(key, value, this.config.inspect(key).workspaceValue === undefined)
                });
            }
        }
        workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.section)) {
                this.config = workspace.getConfiguration(this.section);
                this._onDidChange.fire([]);
            }
        });
    }
}
