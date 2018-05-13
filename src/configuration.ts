import { workspace, Event, EventEmitter } from 'vscode';
import { EXTENSION_NAMESPACE } from './constants';
import { GitStatMode } from './gitProvider';

let workspaceConfig, keys = [];

export class Configuration {
    @setting('history.statMode', 'short') statMode: GitStatMode;
    @setting('history.commitsCount', 200) commitsCount: number;
    @setting('history.graph', true) branchGraph: boolean;
    @setting('explorer.treeView', true) treeView: boolean;

    private _onDidChange = new EventEmitter<string[]>();
    readonly onDidChange = this._onDidChange.event;

    constructor() {
        workspaceConfig = workspace.getConfiguration(EXTENSION_NAMESPACE);
        workspace.onDidChangeConfiguration(e => {
            workspaceConfig = workspace.getConfiguration(EXTENSION_NAMESPACE);
            let changes = keys.filter(key => e.affectsConfiguration(EXTENSION_NAMESPACE + '.' + key));
            if (changes.length > 0) {
                this._onDidChange.fire(changes);
            }
        });
    }
}


function setting(key?, defaultValue?, validate?) {
    return (target: any, property: string) => {
        Object.defineProperty(target, property, {
            get: () => workspaceConfig.get(key, defaultValue), 
            set: value => {
                workspaceConfig.update(key, value, workspaceConfig.inspect(key).workspaceValue === undefined)
            },
        });
        keys.push(key);
    }
}
