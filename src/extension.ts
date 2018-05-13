import { ExtensionContext, commands } from 'vscode';
import { Commands } from './commands';
import { Configuration } from './configuration';
import { EXTENSION_NAMESPACE } from './constants';
import { GitProvider } from './gitProvider';
import { ExplorerViewContext, ExplorerViewProvider } from './explorerViewProvider';
import { HistoryViewContext, HistoryViewProvider } from './historyViewProvider';

export var container: ExtensionInstance;

export class ExtensionInstance {
    readonly configuration: Configuration;
    readonly git: GitProvider;
    readonly historyView: HistoryViewProvider;
    readonly explorerView: ExplorerViewProvider;
    readonly commands: Commands;

    constructor(readonly context: ExtensionContext) {
        this.configuration = new Configuration();
        this.git = new GitProvider(this);
        this.commands = new Commands(this);
        this.historyView = new HistoryViewProvider(this);
        this.explorerView = new ExplorerViewProvider(this);
        context.subscriptions.push(this.git, this.historyView, this.explorerView, this.commands);
    }

    public openHistoryView(newContext: HistoryViewContext) {
        this.historyView.open(newContext);
    }

    public setExplorerContext(newContext: ExplorerViewContext) {
        this.explorerView.context = newContext;
    }

    public putEnv(key, value) {
        commands.executeCommand('setContext', EXTENSION_NAMESPACE + '.' + key, value);
    }
}

export function activate(context: ExtensionContext) {
    container = new ExtensionInstance(context);
}
