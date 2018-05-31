import { ExtensionContext } from 'vscode';
import { Commands } from './commands';
import { ExplorerViewProvider } from './explorerViewProvider';
import { GitProvider } from './gitProvider';
import { HistoryViewProvider } from './historyViewProvider';

let container: ExtensionInstance;

export class ExtensionInstance {
    readonly git: GitProvider;
    readonly historyView: HistoryViewProvider;
    readonly explorerView: ExplorerViewProvider;
    readonly commands: Commands;

    constructor(readonly context: ExtensionContext) {
        context.subscriptions.push(
            this.git = new GitProvider(this),
            this.commands = new Commands(this),
            this.historyView = new HistoryViewProvider(this),
            this.explorerView = new ExplorerViewProvider(this),
        );
    }
}

export function activate(context: ExtensionContext) {
    container = new ExtensionInstance(context);
}
