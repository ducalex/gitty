import { 
    DecorationRenderOptions, Disposable, EventEmitter, Hover, HoverProvider, OverviewRulerLane, 
    Position, Range, StatusBarItem, TextDocument, TextDocumentContentProvider, TextEditor, 
    TextEditorSelectionChangeKind, ThemeColor, Uri, commands, languages, window, workspace 
} from 'vscode';
import { EXTENSION_NAMESPACE, Icons, Styles } from './constants';
import { ExtensionInstance } from './extension';
import { GitLogEntry, GitRepository, GitRefType, GitStatMode } from './gitProvider';


export interface HistoryViewContext {
    repo: GitRepository;
    branch?: string;
    specifiedPath?: Uri;
    line?: number;
    author?: string;
}

export class HistoryViewProvider implements TextDocumentContentProvider {
    readonly documentUri: Uri = Uri.parse(EXTENSION_NAMESPACE + '://authority/Git History');

    private _onDidChange = new EventEmitter<Uri>();
    readonly onDidChange = this._onDidChange.event;

    private logCount: number = 0;
    private lines: string[] = [''];
    private disposables: Disposable[] = [];
    private clickables = new ClickableProvider(this);
    private currentContext: HistoryViewContext;

    private decorate = new class Decorations {
        readonly info = new Decoration(Styles.info);
        readonly oldLine = new Decoration(Styles.oldLine);
        readonly newLine = new Decoration(Styles.newLine);
        readonly title = new Decoration(Styles.title);
        readonly branch = new Decoration(Styles.branch);
        readonly subject = new Decoration(Styles.subject);
        readonly hash = new Decoration(Styles.hash);
        readonly ref = new Decoration(Styles.ref);
        readonly author = new Decoration(Styles.author);
        readonly email = new Decoration(Styles.email);
        readonly date = new Decoration({});
        readonly file = new Decoration(Styles.file);
        readonly more = new Decoration(Styles.more);
        readonly clickable = new Decoration(Styles.clickable);
        readonly selected = new Decoration(Styles.selected);
        readonly loading = new Decoration(Styles.loading);
        readonly body = new Decoration(Styles.body);
    }

    public get focused() {
        return window.activeTextEditor && window.activeTextEditor.document 
               && window.activeTextEditor.document.uri.scheme === this.documentUri.scheme;
    }

    get context(): HistoryViewContext {
        return this.currentContext || { repo: null };
    }

    constructor(private container: ExtensionInstance) {
        this.disposables.push(
            this._onDidChange,
            workspace.registerTextDocumentContentProvider(this.documentUri.scheme, this),
            window.onDidChangeActiveTextEditor(editor => {
                if (editor && editor.document.uri.scheme === this.documentUri.scheme) {
                    this.setDecorations(editor);
                }
            }),
            container.configuration.onDidChange(changes => {
                if (this.focused && changes.find(key => key.startsWith('history.'))) {
                    commands.executeCommand(EXTENSION_NAMESPACE + '.viewHistory', this.context)
                }
            })
        );

        for (let key in this.decorate) {
            this.disposables.push(this.decorate[key].decorator);
        }
    }

    public open(context: HistoryViewContext) {
        this.currentContext = context;
        if (context.repo && !context.branch) {
            context.repo.getCurrentBranch().then(branch => context.branch = branch);
        }
        this.clear();
        this._onDidChange.fire(this.documentUri);
        workspace.openTextDocument(this.documentUri)
            .then(doc => window.showTextDocument(doc, { preview: false, preserveFocus: true })
            .then(() => this.setDecorations(window.activeTextEditor)));
    }
    
    public provideTextDocumentContent(uri: Uri): string {
        let content = this.lines.join('\n');
        if (content.length > 1) {
            return content;
        }
        this.updateContent();
        return ' ';
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    private append(text: string, decoration?: any, skipWhitespaces?: boolean, clickable?: Clickable): Range {
        let current = this.lines.length - 1;
        let newlines = text.split("\n");
        let start = this.lines[current].length;
        let end = newlines.length > 1 ? newlines[newlines.length - 1].length : start + text.length;
        let range = new Range(current, start, current + (newlines.length - 1), end);
        
        if (skipWhitespaces) {
            for (let segment of text.split(/(\s+)/g)) {
                this.append(segment, segment.trim().length ? decoration : null, false, clickable);
            }
        } else {
            this.lines[current] += newlines.shift();
            this.lines.push(...newlines);
            if (decoration instanceof Decoration) {
                decoration.ranges.push(range);
            }

            if (clickable) {
                clickable.range = range;
                this.clickables.add(clickable);
            }
        }
        return range;
    };

    private async updateContent(printHeader: boolean = true, loadAll: boolean = !!this.context.line): Promise<void> {
        this.decorate.loading.ranges = [new Range(this.lines.length, 0, this.lines.length, 1)];
        this.setDecorations(window.activeTextEditor);

        let context = this.context;
        let statMode = this.container.configuration.statMode;
        let loadCount = loadAll ? 0 : this.container.configuration.commitsCount;
        let entries: GitLogEntry[] = await context.repo.getLogEntries(statMode, this.logCount, loadCount, 
            context.branch, context.specifiedPath, context.line, context.author);

        let commitsCount: number = entries.length;
        let hasMore: boolean = false;
        let branchGraph = this.container.configuration.branchGraph;

        if (loadCount !== 0 && entries.length >= loadCount) {
            commitsCount = await context.repo.getCommitsCount(context.specifiedPath, context.author);
            hasMore = commitsCount > entries.length + this.logCount;
        }

        if (printHeader) {
            this.clear();
            this.append('Git History', this.decorate.title);

            this.append(' (');
            this.append(this.context.repo.root, this.decorate.info, false, {
                onClick: () => this.container.commands.viewHistory(),
            });
            this.append(')\n');

            if (context.specifiedPath) {
                this.append('File: ', this.decorate.title);
                this.append(await context.repo.getRelativePath(context.specifiedPath), this.decorate.file);
                this.append('  ');
            }

            if (context.line) {
                this.append('at line ' + context.line);
                this.append('  ');
            }

            this.append('Branch: ', this.decorate.title);
            this.append(context.branch, this.decorate.branch, false, {
                onClick: () => this.container.commands.viewRefHistory(context),
                onHover: () => 'Select a branch to see its history',
            })
            this.append('  ');

            this.append('Author: ', this.decorate.title);
            this.append(context.author || 'all authors', this.decorate.email, false, {
                onClick: () => this.container.commands.viewAuthorHistory(),
                onHover: () => 'Select an author to see the commits',
            });
            this.append('  ');

            
            this.append('Graph: ', this.decorate.info);
            this.append(branchGraph ? 'enabled' : 'disabled', this.decorate.info, false, {
                onClick: () => this.container.configuration.branchGraph = !branchGraph,
                onHover: () => 'Graph is a work in progress, it may break or be slow'
            });
            this.append('  ');

            this.append('Stat: ', this.decorate.info);
            this.append(statMode, this.decorate.info, false, {
                onClick: () => commands.executeCommand(EXTENSION_NAMESPACE + '.historyToggleStatMode'),
                onHover: () => 'Stat changes the level of details displayed. None is the fastest.'
            });
            this.append('  ');


            this.append('\n\n');
        }

        if (entries.length === 0) {
            this.append('No History');
        }
        
        let hover = async entry => {
            if (statMode !== GitStatMode.Full) {
                entry = await context.repo.getCommitDetails(entry.hash);
            }
            return `Commit:    ${entry.hash}\n`
                 + `Author:    ${entry.author} <${entry.email}>\n`
                 + `Date:      ${entry.date}\n`
                 + `---\n`
                 + `${entry.body}\n`
                 + `---\n`
                 + `${entry.stat}`;
        }
        

        let graph = {};

        if (!context.specifiedPath && branchGraph) {
            graph = await context.repo.getGraph(this.logCount, loadCount, context.branch, 
                    context.specifiedPath, context.line, context.author);
        }

        for (let entry of entries) {
            let prefix = (graph[entry.hash] || ['●', ' ', ' ', ' ']).map(node => node.replace('*', '●').replace('|', '│') + ' ');
            let repeat = prefix.pop();

            this.append(prefix.shift());
            //this.append('● ');

            this.append(entry.subject, this.decorate.subject);
            this.append('  ');

            if (entry.subject.trim() != entry.body.trim()) {
                this.append('...', this.decorate.body, false, {
                    onHover: () => entry.body,
                });    
            }
            this.append('\n')
            

            this.append(prefix.shift());
            //this.append('│ ');

            this.append(entry.hash, this.decorate.hash, false, {
                onClick: () => {
                    this.container.setExplorerContext({
                        repo: context.repo,
                        rightRef: entry.hash,
                        specifiedPath: context.specifiedPath,
                    });
                },
                onHover: () => hover(entry),
            });
            
            let iconmap =  { [GitRefType.Head]: '▶', [GitRefType.Tag]: '☖', [GitRefType.RemoteHead]: ''};

            for (let ref of entry.refs) {
                this.append(' ');
                this.append(iconmap[ref.type] + ref.name, this.decorate.ref, true, {
                    onClick: () => {
                        commands.executeCommand(EXTENSION_NAMESPACE + '.viewHistory', {...context, branch: ref.name});
                        this.container.setExplorerContext({repo: context.repo, rightRef: ref.name })
                    }
                });
            }
            
            if (entry.author) {
                this.append(' by ');
                this.append(entry.author, this.decorate.author);
            }
            
            if (entry.email) {
                this.append(' <');
                this.append(entry.email, this.decorate.email);
                this.append('>');
            }
            
            if (entry.date) {
                this.append(', ');
                this.append(entry.date, this.decorate.date);
            }

            this.append('\n');

            if (entry.stat) {
                for (let line of entry.stat.split(/\n\s*/)) {
                    this.append(prefix.shift() || repeat);
                    //this.append('│ ');

                    let [file, separator, changes] = line.split(/(\|\s*\d+)/);
                    if (changes != undefined) {
                        this.append(' ' + file + separator, this.decorate.info);
                        let minus1 = changes.indexOf('-');

                        if (minus1 > 0) {
                            this.append(changes.substr(0, minus1 - 1), this.decorate.newLine);
                            this.append(changes.substr(minus1), this.decorate.oldLine);
                        } else {
                            this.append(changes, this.decorate.newLine);
                        }
                    } else {
                        this.append(line);
                    }
                    this.append('\n');
                }
            } else if (entry.diff) {
                let diffStarted = false;
                let map = {'-': this.decorate.oldLine, '+': this.decorate.newLine, '@': this.decorate.info};
                for (let line of entry.diff.split('\n')) {
                    diffStarted = diffStarted || line[0] === '@';
                    if (diffStarted && map[line[0]]) {
                        this.append(prefix.shift() || repeat);
                        //this.append('│ ');
                        this.append(line, map[line[0]]);
                        this.append('\n');
                    }
                }
            } else {
                this.append((prefix.shift() || repeat) + '\n');
            }

            this.logCount++;
        
            for (let i = 0; i < prefix.length; i++) {
                this.append(prefix[i] + '\n');
            }

            this.append(repeat + '\n');

            /*
            if (this.logCount != commitsCount) {
                this.append('│ ');
            }
            this.append('\n');
            */
        }

        if (hasMore) {
            let all, more;

            more = {
                onClick: (link) => {
                    this.clickables.remove(more);
                    this.clickables.remove(all);
                    this.lines.splice(link.range.start.line, 1, '-'.repeat(60), ' ');
                    this.updateContent(false);
                },
                onHover: () => 'Load more commits'
            };

            all = {
                onClick: (link) => {
                    this.clickables.remove(more);
                    this.clickables.remove(all);
                    this.lines.splice(link.range.start.line, 1, '-'.repeat(60), ' ');
                    this.updateContent(false, true);
                },
                onHover: () => 'Load all remaining commits'
            };
            
            this.append('\n');
            this.append('\u00b7\u00b7\u00b7', this.decorate.more, false, more);
            this.append(' / ');
            this.append('Load all', this.decorate.more, false, all);
            this.append('\n');
        }
        
        this.decorate.loading.ranges = [];
        this._onDidChange.fire(this.documentUri);
        this.setDecorations(window.activeTextEditor);
    }

    private setDecorations(editor: TextEditor): void {
        this.decorate.clickable.ranges = this.clickables.ranges;

        for (let key in this.decorate) {
            editor.setDecorations(this.decorate[key].decorator, this.decorate[key].ranges);
        }
    }

    private clear(): void {
        this.logCount = 0;
        this.lines = [''];
        this.clickables.clear();

        for (let key in this.decorate) {
            this.decorate[key].ranges = [];
        }
    }
}



class Decoration {
    constructor(
        readonly style: DecorationRenderOptions, 
        public ranges: Range[] = [], 
        readonly decorator = window.createTextEditorDecorationType(style)
    ) {}
}

export interface Clickable {
    onClick?: (self?: Clickable) => any;
    onHover?: (self?: Clickable) => string | Promise<string>;
    range?: Range;
}

class ClickableProvider implements HoverProvider {
    private clickables: Clickable[] = [];
    public get ranges() { return this.clickables.map(clickable => clickable.range) }
    
    constructor(private daddy: HistoryViewProvider) {
        languages.registerHoverProvider({scheme: EXTENSION_NAMESPACE}, this);
        window.onDidChangeTextEditorSelection(event => {
            if (daddy.focused && event.kind === TextEditorSelectionChangeKind.Mouse) {
                let link = this.getClickableAt(event.selections[0].anchor);
                if (link && link.onClick) link.onClick(link);
            }
        });
    }

    public clear() {
        this.clickables = []; 
    }

    public add(link: Clickable) {
        this.clickables.push(link);
    }

    public remove(link: Clickable) {
        this.clickables = this.clickables.filter(item => item != link)
    }

    public getClickableAt(position: Position) {
        return this.clickables.find((e: Clickable) => e.range.contains(position));
    }

    public async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        let link = this.getClickableAt(position);
        if (link && link.onHover) {
            return new Hover('````\r\n' + (await link.onHover()) + '\r\n````', link.range);
        }
    }
}
