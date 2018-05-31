import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace } from 'vscode';
import { BaseViewProvider } from './baseViewProvider';
import { EXTENSION_NAMESPACE, Icons } from './constants';
import { GitCommittedFile } from './gitProvider';
import { format, putEnv, strftime } from './utils';
import * as path from 'path';
import * as fs from 'fs';

export class ExplorerViewProvider extends BaseViewProvider implements TreeDataProvider<TreeItem> {
    public readonly onDidChangeTreeData: Event<TreeItem> = this._onDidChange.event;

    protected configuration: {
        treeView: boolean;               // gitty.explorer.treeView
        formats: {                       // gitty.explorer.formats
            fileHistoryLabel: string,    // gitty.explorer.formats.fileHistoryLabel
            fileHistoryTooltip: string,  // gitty.explorer.formats.fileHistoryTooltip
            fileLabel: string            // gitty.explorer.formats.fileLabel
        };
    };

    protected openCommits: CommittedTreeItem[] = [];
    protected fileHistory: CommittedTreeFolder;
    protected clearFileHistoryTimeout;
    
    constructor(container) {
        super(container, EXTENSION_NAMESPACE + '.explorer');
        this.disposables.push(
            container.git.onDidChangeGitRepository(repo => {
                this.refresh();
            }),
            workspace.onDidSaveTextDocument(e => {
                this.buildFileHistory();
            }),
            window.onDidChangeActiveTextEditor(editor => {
                clearTimeout(this.clearFileHistoryTimeout);
                if (!editor) { // This is to reduce flicker when switching editors
                    this.clearFileHistoryTimeout = setTimeout(() => this.buildFileHistory(), 300);
                } else {
                    this.buildFileHistory();
                }
            }),
            window.registerTreeDataProvider('explorerCommitViewer', this),
        );
        
        container.commands.register('explorerShowTreeView', () => this.configuration.treeView = true);
        container.commands.register('explorerShowListView', () => this.configuration.treeView = false);
        container.commands.register('_rememberCollapsed', folder => {
            folder.collapsibleState = folder.collapsibleState == 1 ? 2 : 1
        });

        this.fileHistory = new CommittedTreeFolder(null, 'No current file history', null, Icons.History);
    }

    public onContextChanged(): void {
        this.buildCommitViewer();
    }

    public onConfigurationChanged() {
        this.refresh();
    }

    public async refresh() {
        await this.buildFileHistory();
        await this.buildCommitViewer();
    }

    public getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
        return element;
    }

    public getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
        if (!element) {
            return [this.fileHistory, ...this.openCommits];    
        }
        return element.getChildren();
    }

    private async buildCommitViewer(): Promise<void> {
        let { repo, leftRef, rightRef, specifiedPath } = this.context;
        this.openCommits = [];
        
        if (repo) {
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
            this.openCommits.push(folder);
            
            this.fileHistory.collapsibleState = TreeItemCollapsibleState.Collapsed;
        }
        
        putEnv('isExploringCommit', !!repo);
        this._onDidChange.fire();
    }

    private async buildFileHistory(file?: Uri) {
        this.fileHistory.label = 'No current file history';
        this.fileHistory.files = [];

        if (!file && window.activeTextEditor && window.activeTextEditor.document) {
            file = window.activeTextEditor.document.uri;
        }
        
        if (!file) {
            this._onDidChange.fire();
            return;
        }
        
        file = Uri.file(file.fsPath); // if scheme == git

        let label = this.configuration.formats.fileHistoryLabel;
        let tooltip = this.configuration.formats.fileHistoryTooltip;

        let repository = await this.container.git.getRepository(file);
        let limit = 25;

        if (repository) {
            let entries = await repository.getFileHistory(file, 0, limit);
            let gitRelativePath = await repository.getRelativePath(file);
            let workingDiff = await repository.exec(['diff', '--shortstat', gitRelativePath]);

            if (workingDiff) {
                let tooltip = workingDiff.replace('1 file changed, ', '') 
                            + '\n' + strftime(fs.statSync(file.fsPath).ctime, '%c (%N)');
                let gitfile = {uri: file, leftRef: entries[0].hash, rightRef: undefined, gitRelativePath};

                this.fileHistory.files.push(new CommittedTreeItem(gitfile, '(Uncommitted changes)', tooltip));
            }

            for (let i = 0; i < entries.length; i++) {
                let previous = entries[i + 1] || {hash: undefined};
                let gitfile = { uri: file, leftRef: previous.hash, rightRef: entries[i].hash, gitRelativePath };
                let date = entries[i].date;
                
                let placeholders = { ...entries[i], date: format => strftime(date, format) };

                this.fileHistory.files.push(new CommittedTreeItem(gitfile, 
                    format(label, <any>placeholders), format(tooltip, <any>placeholders)));
            }
            
            if (entries.length > limit) {
                this.fileHistory.files.push(new CommittedTreeItem(null, 'Load more...'));
            }

            let placeholders = {
                path: gitRelativePath,
                basename: path.basename(gitRelativePath),
                dirname: path.dirname(gitRelativePath),
            };

            if (this.fileHistory.files.length) {
                this.fileHistory.label = format(this.configuration.formats.fileLabel, placeholders);
            }
        }

        this._onDidChange.fire(this.fileHistory);
    }

    private _buildFileTree(rootFolder: CommittedTreeFolder, files: GitCommittedFile[], showTreeView = this.configuration.treeView) {
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
            rootFolder.files.push(...files.map(file => {
                let placeholders = {
                    path: file.gitRelativePath,
                    basename: path.basename(file.gitRelativePath),
                    dirname: path.dirname(file.gitRelativePath),
                };
    
                return new CommittedTreeItem(file, format(this.configuration.formats.fileLabel, placeholders));
            }));
        }
    }
}


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
