import * as path from 'path';
import { Disposable, QuickPickItem, Uri, commands, window } from 'vscode';
import { EXTENSION_NAMESPACE, HashMap } from './constants';
import { ExtensionInstance } from './extension';
import { GitCommittedFile, GitRefType, GitRepository, GitStatMode } from './gitProvider';
import { HistoryViewContext } from './historyViewProvider';
import { toGitUri } from './utils';

export class Commands {
    private disposables: Disposable[] = [];

    constructor(readonly container: ExtensionInstance) {
        this.register('clear', this.clear),
        this.register('explorerRefresh', this.explorerRefresh),
        this.register('viewFolderHistory', this.viewFileHistory);
        this.register('viewFileHistory', this.viewFileHistory);
        this.register('viewLineHistory', this.viewLineHistory);
        this.register('viewHistory', this.viewHistory);
        this.register('viewAuthorHistory', this.viewAuthorHistory);
        this.register('viewRefHistory', this.viewRefHistory);
        this.register('compareRefs', this.compareRefs);
        this.register('openCommittedFileDiff', this.openCommittedFileDiff);
        this.register('diffLocalFile', this.diffLocalFile);
        this.register('diffFolder', this.diffFolder);

        // Configuration toggles
        this.register('explorerShowTreeView', () => container.configuration.treeView = true);
        this.register('explorerShowListView', () => container.configuration.treeView = false);
        this.register('historyToggleStatMode', () => {
            let map = {none: GitStatMode.Short, short: GitStatMode.Full, full: GitStatMode.None};
            container.configuration.statMode = map[container.configuration.statMode] || GitStatMode.Short;
        });
    }

    public register(id: string, callback: (...args) => any, thisArg: any = this) {
        if (thisArg) {
            callback = callback.bind(this);
        }
        this.disposables.push(commands.registerCommand(EXTENSION_NAMESPACE + '.' + id, callback));
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    public async clear(): Promise<void> {
        this.container.setExplorerContext({ leftRef: null, rightRef: null, specifiedPath: null, repo: null });
    }

    public async explorerRefresh(): Promise<void> {
        this.container.git.scanWorkspace();
        this.container.explorerView.refresh();
    }

    public async viewFileHistory(specifiedPath: Uri|GitCommittedFile): Promise<void> {
        if (!(specifiedPath instanceof Uri)) {
            specifiedPath = specifiedPath.uri;
        }

        let repo = await this.container.git.getRepository(specifiedPath);
        if (!repo) return;

        this.container.openHistoryView({ specifiedPath, repo });
    }

    public async viewLineHistory(): Promise<void> {
        let editor = window.activeTextEditor;
        if (!editor) return;

        let repo = await this.container.git.getRepository(editor.document.uri);
        if (!repo) return;

        let line = window.activeTextEditor.selection.active.line + 1;
        this.container.openHistoryView({ specifiedPath: editor.document.uri, line, repo });
    }

    public async viewHistory(context?: HistoryViewContext): Promise<void> {
        if (context && context.repo) {
            this.container.openHistoryView(context);
        } else {
            let repo: GitRepository;
            if (window.activeTextEditor && window.activeTextEditor.document) {
                repo = await this.container.git.getRepository(window.activeTextEditor.document.uri);
            }
            if (!repo) repo = await this.selectGitRepo();
            if (!repo) return;

            this.container.openHistoryView({ repo });
        }
    }

    public async viewAuthorHistory(): Promise<void> {
        let repo = await this.selectGitRepo(this.container.historyView.context);
        if (!repo) return;

        let authors = [{ name: 'All', email: '' }, ...await repo.getAuthors()];
        let pickItems = authors.map(author => ({ label: author.name, description: author.email }));

        let item = await window.showQuickPick(pickItems, { placeHolder: 'Select an author to see their commits' });
        if (!item) return;
        
        this.container.openHistoryView({...this.container.historyView.context, author: item.description});
    }

    public async viewRefHistory(context?: HistoryViewContext): Promise<void> {
        let repo = await this.selectGitRepo(context);
        if (!repo) return;

        let ref = await this.selectRef(repo);
        if (!ref) return;

        this.container.openHistoryView({ branch: ref, specifiedPath: null, repo });
        this.container.setExplorerContext({ repo, rightRef: ref });
    }

    public async compareRefs(): Promise<void> {
        let repo = await this.selectGitRepo();
        if (!repo) return;

        let leftRef = await this.selectRef(repo, 'Select the first ref');
        if (!leftRef) return;

        let rightRef = await this.selectRef(repo, 'Select a ref to compare against ' + leftRef);
        if (!rightRef) return;

        this.container.openHistoryView({ repo, branch: leftRef + '..' + rightRef });
        this.container.setExplorerContext({ repo, leftRef, rightRef });
    }

    public async openCommittedFileDiff({uri, leftRef, rightRef}: GitCommittedFile): Promise<void> {
        let title = (leftRef ? `${leftRef} .. ${rightRef || '(uncommitted)'}` : rightRef) + ' | ' + path.basename(uri.path);
        let leftFile = toGitUri(uri, leftRef || rightRef + '~');
        let rightFile = rightRef ? toGitUri(uri, rightRef) : uri;

        commands.executeCommand('vscode.diff', leftFile, rightFile, title, { preview: true });
    }

    public async diffLocalFile(specifiedPath: Uri|GitCommittedFile): Promise<void> {
        if (!(specifiedPath instanceof Uri)) {
            specifiedPath = specifiedPath.uri;
        }
        
        let repo = await this.container.git.getRepository(specifiedPath);
        if (!repo) return;
        
        let leftRef = await this.selectRef(repo, `View ${path.basename(specifiedPath.path)} at ref:`);
        if (!leftRef) return;
        
        this.openCommittedFileDiff({uri: specifiedPath, leftRef, gitRelativePath: ''})
    }
    
    public async diffFolder(specifiedPath: Uri|GitCommittedFile): Promise<void> {
        if (!(specifiedPath instanceof Uri)) {
            specifiedPath = specifiedPath.uri;
        }

        let repo = await this.container.git.getRepository(specifiedPath);
        if (!repo) return;

        let leftRef = await this.selectRef(repo, `View ${path.basename(specifiedPath.path)} at ref:`);
        if (!leftRef) return;
        
        let rightRef = await repo.getCurrentBranch();
        
        this.container.setExplorerContext({ repo, specifiedPath, leftRef, rightRef });
    }
    
    private async selectGitRepo(context?: HistoryViewContext): Promise<GitRepository> {
        if (context && context.repo) {
            return Promise.resolve(context.repo);
        }

        let repositories: GitRepository[] = this.container.git.getRepositories();

        if (repositories.length === 0) return null;
        if (repositories.length === 1) return Promise.resolve(repositories[0]);

        let pickItems = repositories.map(repo => ({ label: path.basename(repo.root), description: repo.root, repo }));
        let item = await window.showQuickPick(pickItems, { placeHolder: 'Select the git repository' });
        
        return item ? item.repo : null;
    }

    private async selectRef(repo: GitRepository, placeHolder = 'Select or type branch/hash/tag'): Promise<string> {
        let labels =  {[GitRefType.Head]: 'HEAD ', [GitRefType.Tag]: 'Tag at ', [GitRefType.RemoteHead]: 'Remote at '};
        let branches = (await repo.getRefs()).map(ref => ({label: ref.name || ref.commit, description: labels[ref.type] + ref.commit}));
        let commitPick = {description: 'Open a list of commits', label: 'Pick a commit'};
        
        let item = await window.showQuickPick([commitPick, ...branches], {placeHolder, matchOnDescription: true});
        
        if (item == commitPick) {
            let commits = (await repo.getLogEntries(null, 0, 1000)).map(entry => ({label: entry.hash, description: entry.subject}));
            item = await window.showQuickPick(commits, {placeHolder, matchOnDescription: true});
        }
        
        if (!item) return undefined;
        
        return item.label;
    }
}
