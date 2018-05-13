import * as fs from 'fs';
import * as path from 'path';
import { Disposable, Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace } from 'vscode';
import { EXTENSION_NAMESPACE, Icons } from './constants';
import { ExtensionInstance } from './extension';
import { GitCommittedFile, GitRepository } from './gitProvider';
import { format } from './utils';

class CommittedTreeItem extends TreeItem implements GitCommittedFile {
    readonly uri: Uri;
    readonly status: string;
    readonly gitRelativePath: string;
    readonly leftRef: string;
    readonly rightRef: string;

    public command = {command: EXTENSION_NAMESPACE + '.openCommittedFileDiff', arguments: [this], title: ''};
    public children: CommittedTreeItem[] = [];
    public getChildren = () => this.children;

    constructor(file: GitCommittedFile, public label?: string, public tooltip?, public iconPath?) {
        super(label);
        if (file) {
            Object.assign(this, file);
            if (file.status) this.iconPath = Icons.GitFileStatusMap[file.status[0].toUpperCase()];
            //this.resourceUri = file.uri;
        }
    }
}

class CommittedTreeFolder extends CommittedTreeItem {
    public command = {command: EXTENSION_NAMESPACE + '._rememberCollapsed', arguments: [this], title: ''};
    public collapsibleState = TreeItemCollapsibleState.Expanded;
    public contextValue = 'folder';
    public subFolders: CommittedTreeFolder[] = [];
    public files: CommittedTreeItem[] = [];
    public getChildren = () => [...this.subFolders, ...this.files];
}

let label = (gitRelativePath) => `${path.basename(gitRelativePath)} \u00a0\u2022\u00a0 ${path.dirname(gitRelativePath)}`;

export interface ExplorerViewContext {
    repo: GitRepository;
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
}

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem> {
    private _onDidChangeTreeData: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChangeTreeData.event;

    private currentContext: ExplorerViewContext;

    private disposables: Disposable[] = [];
    private rootFolder: CommittedTreeItem[] = [];
    private fileHistory: CommittedTreeFolder;

    get context(): ExplorerViewContext {
        return this.currentContext || { repo: null };
    }
    set context(context: ExplorerViewContext) {
        this.currentContext = context;
        this.buildCommitViewer();
    }

    constructor(private container: ExtensionInstance) {
        this.refresh();

        this.disposables.push(
            container.configuration.onDidChange(changes => changes.find(key => key.startsWith('explorer.')) && this.refresh()),
            //container.git.onDidChangeGitRepositories(e => this.buildFileHistoryTree()),
            workspace.onDidSaveTextDocument(e => this.buildFileHistoryTree()),
            window.onDidChangeActiveTextEditor(e => e && this.buildFileHistoryTree(e.document.uri)),
            window.registerTreeDataProvider('explorerCommitViewer', this),
            this._onDidChangeTreeData
        );
        container.commands.register('_rememberCollapsed', folder => folder.collapsibleState = folder.collapsibleState == 1 ? 2 : 1);
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    refresh() {
        this.fileHistory = new CommittedTreeFolder(null, 'No current file history', null, Icons.History);

        this.buildFileHistoryTree();
        this.buildCommitViewer();
    }

    getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
        return element;
    }

    getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
        return element ? element.getChildren() : this.rootFolder;
    }

    private async buildCommitViewer(): Promise<void> {
        this.rootFolder = [this.fileHistory];

        if (this.context.repo) {
            let { repo, leftRef, rightRef, specifiedPath } = this.context;
            let files = await repo.getCommittedFiles(leftRef, rightRef);
            let folder = new CommittedTreeFolder(null, `Commit ${rightRef}  (${files.length} files changed)`, null, Icons.RootFolder);

            if (specifiedPath) {
                let relativePath = await repo.getRelativePath(specifiedPath);
                let selection = new CommittedTreeFolder(null, '(Selection)', null, Icons.RootFolder);

                this._buildFileTree(selection, files.filter(file => file.gitRelativePath.startsWith(relativePath)));
                
                selection.collapsibleState = TreeItemCollapsibleState.Collapsed;
                folder.subFolders.unshift(selection);
            }

            if (leftRef) {
                folder.label = `Comparing ${leftRef} and ${rightRef}  (${files.length} files)`;
            }
            
            this._buildFileTree(folder, files);
            this.rootFolder.push(folder);
            
            this.fileHistory.collapsibleState = TreeItemCollapsibleState.Collapsed;
        }

        this.container.putEnv('isExploringCommit', !!this.context.repo);
        this._onDidChangeTreeData.fire();
    }

    async buildFileHistoryTree(file?: Uri) {
        this.fileHistory.files = [];

        if (!file && window.activeTextEditor && window.activeTextEditor.document) {
            file = window.activeTextEditor.document.uri;
        }
        
        if (file) file = Uri.file(file.fsPath); // if scheme == git

        let repository = await this.container.git.getRepository(file);
        let limit = 25;
        
        if (repository) {
            let entries = await repository.getFileHistory(file, 0, limit);
            let gitRelativePath = await repository.getRelativePath(file);
            let workingDiff = await repository.exec(['diff', '--shortstat', gitRelativePath]);

            if (workingDiff) {
                let tooltip = workingDiff.replace('1 file changed, ', '') + '\n' + fs.statSync(file.fsPath).ctime.toLocaleString();
                let gitfile = {uri: file, leftRef: entries[0].hash, rightRef: undefined, gitRelativePath};
                this.fileHistory.files.push(new CommittedTreeItem(gitfile, '(Uncommitted changes)', tooltip));
            }

            for (let i = 0; i < entries.length; i++) {
                let commit = entries[i];
                let previous = entries[i + 1] || {hash: undefined};
                let gitfile = { uri: file, leftRef: previous.hash, rightRef: commit.hash, gitRelativePath };
                let label = format('$hash \u2022 $subject', commit as any);
                this.fileHistory.files.push(new CommittedTreeItem(gitfile, label, label + '\n' + commit.date));
            }
            
            if (entries.length > limit) {
                this.fileHistory.files.push(new CommittedTreeItem(null, 'Load more...'));
            }

            this.fileHistory.label = label(gitRelativePath);
        }

        if (this.fileHistory.files.length == 0) {
            this.fileHistory.label = 'No current file history';
        }

        this.container.putEnv('hasGitRepo', !!repository);
        this._onDidChangeTreeData.fire(this.fileHistory);
    }

    private _buildFileTree(rootFolder: CommittedTreeFolder, files: GitCommittedFile[], showTreeView = this.container.configuration.treeView) {
        if (showTreeView) {
            for (let file of files) {
                let gitRelativePath: string = '';
                let parent: CommittedTreeFolder = rootFolder;
                for (var segment of file.gitRelativePath.split('/')) {
                    gitRelativePath += segment + '/';
                    let folder = parent.subFolders.find(item => item.label === segment);
                    if (!folder) {
                        folder = new CommittedTreeFolder({ gitRelativePath }, segment);
                        folder.collapsibleState = TreeItemCollapsibleState.Collapsed;
                        parent.subFolders.push(folder);
                    }
                    parent = folder;
                }
                parent.files.push(new CommittedTreeItem(file, segment));
            }
        } else {
            rootFolder.files.push(...files.map(file => new CommittedTreeItem(file, label(file.gitRelativePath))));
        }
    }
}
