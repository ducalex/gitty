import * as path from 'path';
import * as fs from 'fs';

import { Disposable, EventEmitter, Uri, workspace } from 'vscode';
import { spawn } from 'child_process';
import { HashMap } from './constants';
import { randomString } from './utils';

const LINES = /\s*\r?\n\s*/g;

export enum GitStatMode {
    None = 'none',
    Short = 'short',
    Full = 'full'
}

export enum GitRefType {
    Head = 'head',
    RemoteHead = 'remote',
    Tag = 'tag'
}

export interface GitRef {
    type: GitRefType;
    name?: string;
    commit?: string;
}

export interface GitAuthor {
    name: string;
    email: string;
    commits?: number;
}

export interface GitLogEntry {
    subject: string;
    body?: string;
    hash: string;
    refs: GitRef[];
    author: string;
    email: string;
    date: string;
    info?: string;
    stat?: string;
    diff?: string;
    graph?: string;
    files?: GitCommittedFile[];
}

export interface GitCommittedFile {
    uri?: Uri;
    gitRelativePath: string;
    localRelativePath?: string;
    gitPrevRelativePath?: string;
    status?: string;
    leftRef?: string;
    rightRef?: string;
}


function normalize(file: Uri|string) {
    let fsPath = file instanceof Uri ? file.fsPath: file;
    return path.normalize(fsPath || '').replace(/\\/g, '/');
}

function exec(args: string[], cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let content: string = '';
        spawn('git', args, { cwd })
            .on('exit', code => {
                if (code == 0) resolve(content.replace(/\s+$/, ''));
                else resolve(''); // For now we ignore errors;
            })
            .stdout.on('data', data => content += data)
            .setEncoding('utf8');
    });
}

export class GitRepository {
    private _onDidChange = new EventEmitter<GitRepository>();
    readonly onDidChange =  this._onDidChange.event;
    private disposables = [];

    private cachedCommitDetails: HashMap<GitLogEntry> = {};
    private cachedFileHistories: HashMap<GitLogEntry[]> = {};
    private cachedAuthors: GitAuthor[];
    private cachedRefs: GitRef[];


    constructor(readonly root: string) {
        root = normalize(root);

        let logWatcher = workspace.createFileSystemWatcher(path.join(root, '.git', 'logs'));
        let refWatcher = workspace.createFileSystemWatcher(path.join(root, '.git', 'packed-refs'));
        
        logWatcher.onDidChange(e => { this.clearCache(); this._onDidChange.fire(this) });
        refWatcher.onDidChange(e => { this.cachedRefs = undefined; this._onDidChange.fire(this) });

        this.disposables = [logWatcher, refWatcher];
    }
    

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }


    public async exec(args: string[]): Promise<string> {
        return await exec(args, this.root);
    }


    public clearCache() {
        this.cachedCommitDetails = {};
        this.cachedFileHistories = {};
        this.cachedAuthors = undefined;
        this.cachedRefs = undefined;
    }


    private parseCommit(content: string, infoType: 'info'|'stat'|'diff'|'files' = 'info'): GitLogEntry {
        let [subject, body, hash, refstr, author, email, date, info] = content.split('\x1f');
        let refs = [], files = [];
        
        if (hash === undefined)
            return;
        
        let match, regex = /refs\/(head|remote|tag)s\/([^\s,]+)/;

        for (let ref of refstr.split(', ')) {
            if (match = regex.exec(ref)) {
                refs.push({ name: match[2], type: match[1] });
            }
        }

        info = info.replace(/\s*\n\s*/g, '\n').trim();

        if (infoType === 'files') {
            files = this.parseNameStatus(info, null, hash);
        } else if (infoType === 'stat') {
            files = this.parseStat(info, null, hash);
        }
        
        return { subject, body, hash, refs, author, email, date, [infoType]: info, files };
    }


    private parseNameStatus(content: string, leftRef?: string, rightRef?: string): GitCommittedFile[] {
        let match, regex1 = /^([MAD]).*\t([^\t]+)/, regex2 = /^([RC]).*\t(.*)\t([^\t]+)/;
        let files = [], file = undefined;

        for (let line of content.split(LINES)) {
            if (match = regex1.exec(line)) {
                file = {
                    gitRelativePath: match[2],
                    status: match[1],
                }
            } else if (match = regex2.exec(line)) {
                file = {
                    gitRelativePath: match[3],
                    gitPrevRelativePath: match[2],
                    status: match[1],
                }
            } else {
                continue;
            }

            files.push({ ...file, uri: Uri.file(path.join(this.root, file.gitRelativePath)), leftRef, rightRef});
        }

        return files;
    }

    private parseStat(content: string, leftRef?: string, rightRef?: string): GitCommittedFile[] {
        let match, regex1 = /^(.+?)\s+\|\s+(.+)$/;
        let files = [];

        for (let line of content.split(LINES)) {
            if (match = regex1.exec(line)) {
                files.push({ 
                    gitRelativePath: match[1],
                    status: match[2],
                    uri: Uri.file(path.join(this.root, match[1])),
                    leftRef, rightRef
                });
            }
        }

        return files;
    }


    public getRelativePath(file: Uri|string) {
        return path.relative(this.root, normalize(file)) || '.';
    }


    public async getCurrentBranch() {
        return this.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
    }


    public async getCommitsCount(file?: Uri, author?: string): Promise<number> {
        let args: string[] = ['rev-list', '--simplify-merges', '--count', 'HEAD'];
        
        if (author) args.push(`--author=${author}`);
        if (file) args.push(await this.getRelativePath(file));

        return parseInt(await this.exec(args));
    }


    public async getFileHistory(file?: Uri, start: number = 0, limit: number = 50): Promise<GitLogEntry[]> {
        let fsPath = normalize(file instanceof Uri ? file.fsPath: file);

        if (!this.cachedFileHistories[fsPath])  {
            let entries = await this.getLogEntries(GitStatMode.None, start, limit, null, fsPath);
            this.cachedFileHistories[fsPath] = entries;
        }
        
        return Promise.resolve(this.cachedFileHistories[fsPath]);
    }


    public async getGraph(start: number, count: number, ref?: string, file?: Uri, line?: number, author?: string): Promise<any> {

        let args = ['log', '--format=%h%n%h%n%h%n%h', '--graph', '--simplify-merges'];

        if (start)  args.push(`--skip=${start}`);
        if (count)  args.push(`--max-count=${count}`);
        if (author) args.push(`--author=${author}`)
        if (ref)    args.push(ref);
        if (file) {
            let filePath: string = await this.getRelativePath(file);
            args.push('--follow', filePath);
            if (line) {
                args.push(`-L ${line},${line}:${filePath}`);
            }
        }

        let nodes: HashMap<string[]> = {};

        for (let line of (await this.exec(args)).split('\n')) {
            let [graph, hash] = line.split(/ ([a-f0-9]+)$/);
            nodes[hash] = nodes[hash] || [];
            nodes[hash].push(graph);
        }

        return nodes;
    }


    public async getLogEntries(statMode: GitStatMode, start: number, count: number, ref?: string,
        file?: Uri|string, line?: number, author?: string): Promise<GitLogEntry[]> {

        let separator = randomString();
        let args = ['log', `--format=${separator}%s%x1f%B%x1f%h%x1f%D%x1f%aN%x1f%ae%x1f%cD%x1f`, 
                    '--decorate=full', '--simplify-merges'];

        if (line) {}
        else if (statMode === 'short') args.push('--shortstat');
        else if (statMode === 'full')  args.push('--stat');

        if (start)  args.push(`--skip=${start}`);
        if (count)  args.push(`--max-count=${count}`);
        if (author) args.push(`--author=${author}`)
        if (ref)    args.push(ref);
        
        if (file) {
            let filePath: string = await this.getRelativePath(file);
            args.push('--follow', filePath);
            if (line) {
                args.push(`-L ${line},${line}:${filePath}`);
            }
        }

        return (await this.exec(args))
            .split(separator)
            .map(e => this.parseCommit(e, line ? 'diff' : 'stat'))
            .filter(v => !!v);
    }


    public async getCommitDetails(ref: string): Promise<GitLogEntry> {
        if (this.cachedCommitDetails[ref]) return this.cachedCommitDetails[ref];

        let args = ['show', '--format=%s%x1f%B%x1f%h%x1f%D%x1f%aN%x1f%ae%x1f%cD%x1f', '--name-status', ref];
        let commit = this.parseCommit(await this.exec(args), 'files');

        this.cachedCommitDetails[ref] = commit;
        return this.cachedCommitDetails[ref];
    }


    public async getCommittedFiles(leftRef: string, rightRef: string): Promise<GitCommittedFile[]> {
        let args = ['show', '--format=%h', '--name-status', rightRef];
        if (leftRef) {
            args = ['diff', '--name-status', `${leftRef}..${rightRef}`];
        }

        return this.parseNameStatus(await this.exec(args), leftRef, rightRef);
    }


    public async getRefs(): Promise<GitRef[]> {
        if (this.cachedRefs) return this.cachedRefs;

        let result = await this.exec(['for-each-ref', '--format', '%(refname) %(objectname:short)']);
        let refs = [], match, regex = /^refs\/(head|remote|tag)s\/([^\s,]+) ([0-9a-f]+)$/;

        for (let line of result.split(LINES)) {
            if (match = regex.exec(line)) {
                refs.push({ name: match[2], type: match[1], commit: match[3] });
            }
        }

        this.cachedRefs = refs;
        return refs;
    }


    public async getAuthors(): Promise<GitAuthor[]> {
        if (this.cachedAuthors) return this.cachedAuthors;

        let result = await this.exec(['shortlog', '-se', 'HEAD']);
        let match, regex = /(\d+)\s(.+)<(.+)>/;
        let authors = [];

        for (let line of result.split(LINES)) {
            if (match = regex.exec(line)) {
                authors.push({ commits: parseInt(match[1]), name: match[2], email: match[3] });
            }
        }

        this.cachedAuthors = authors;
        return authors;
    }
}


export class GitProvider {
    private _onDidChangeGitRepository = new EventEmitter<GitRepository>();
    readonly onDidChangeGitRepository =  this._onDidChangeGitRepository.event;
    private disposables: Disposable[] = [this._onDidChangeGitRepository];
    
    private gitRepositories: HashMap<GitRepository> = {};
    private knownRoots: string[] = [];

    constructor(private container) {
        let fsWatcher = workspace.createFileSystemWatcher('**/.git/', false, true, false);

        this.container.putEnv('projectHasGitRepo', false);
        this.disposables.push(workspace.onDidChangeWorkspaceFolders(() => this.scanWorkspace()));
        this.disposables.push(fsWatcher.onDidCreate(() => this.scanWorkspace()));
        this.scanWorkspace();
    }


    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }


    public async scanWorkspace() {
        let folders = (await workspace.findFiles('**/.git/index', null)).map(uri => path.dirname(path.dirname(uri.fsPath)));
        
        if (workspace.workspaceFolders) {
            folders.push(...workspace.workspaceFolders.map(folder => folder.uri.fsPath));
        }

        //this.container.putEnv('projectHasGitRepo', false);
        this.gitRepositories = {};
        
        for (let fsPath of folders) {
            await this.getRepository(fsPath, false);
        }
        
        if (this.knownRoots.length > 0) {
            this._onDidChangeGitRepository.fire();
        }

        this.container.putEnv('projectHasGitRepo', this.knownRoots.length > 0);
    }


    public getRepositories() {
        return this.knownRoots.map(key => this.gitRepositories[key]);
    }


    public async getRepository(uri: Uri|string, useKnownRoots: boolean = true): Promise<GitRepository> {
        let fsPath = normalize(uri);
        
        if (useKnownRoots) {
            for (let root of this.knownRoots) {
                if (fsPath.startsWith(root)) {
                    return this.gitRepositories[root];
                }
            }
        }

        if (!fs.existsSync(fsPath)) {
            return undefined;
        }
        
        if (fs.statSync(fsPath).isFile()) {
            fsPath = path.dirname(fsPath);
        }

        let root = await exec(['rev-parse', '--show-toplevel'], fsPath);
        if (!root) return undefined;

        let repo = new GitRepository(root);

        this.gitRepositories[repo.root] = repo;
        this.knownRoots = Object.keys(this.gitRepositories).sort((a, b) => b.length - a.length);
        this.disposables.push(repo, repo.onDidChange(repo => this._onDidChangeGitRepository.fire(repo)));

        return repo;
    }
}
