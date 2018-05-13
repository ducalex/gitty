import * as path from 'path';
import { ThemeColor, OverviewRulerLane, DecorationRenderOptions } from 'vscode';

export const EXTENSION_ROOT = path.normalize(path.join(__dirname, '..', '..'));
export const EXTENSION_NAMESPACE = 'gitty';

export type HashMap<T> = {[key: string] : T};

let getIconUris = (name: string) => ({
    light: path.join(EXTENSION_ROOT, 'res', 'light', name + '.svg'),
    dark: path.join(EXTENSION_ROOT, 'res', 'dark', name + '.svg'),
});

export module Icons {
    export const Modified = getIconUris('status-modified');
    export const Added = getIconUris('status-added');
    export const Deleted = getIconUris('status-deleted');
    export const Renamed = getIconUris('status-renamed');
    export const Copied = getIconUris('status-copied');
    export const RootFolder = getIconUris('structure');
    export const Loading = getIconUris('loading');
    export const History = getIconUris('history');

    export const GitFileStatusMap = { M: Modified, A: Added, D: Deleted, R: Renamed, C: Copied };
}

export module Styles {
    //:DecorationRenderOptions
    export const info = {color: new ThemeColor('editorCodeLens.foreground')};
    export const oldLine = {color: 'red'};
    export const newLine = {color: 'green'};
    export const title = {light: { color: '#267f99' }, dark: { color: '#4EC9B0' }};
    export const branch = {light: { color: '#AF00DB' }, dark: { color: '#C586C0' }};
    export const subject = {light: { color: '#0000ff' }, dark: { color: '#569cd6' }};
    export const body = {light: {color: 'black'}, dark: {color: 'white'}, fontWeight: 'bold', backgroundColor: new ThemeColor('editor.wordHighlightBackground')};
    export const hash = {light: { color: '#a31515' }, dark: { color: '#ce9178' }};
    export const ref = {light: { color: '#008000' }, dark: { backgroundColor: '#1c7801', color: '#dddddd' }};
    export const author = {light: { color: '#001080' }, dark: { color: '#9CDCFE' }};
    export const email = {light: { color: '#795E26' }, dark: { color: '#DCDCAA' }};
    export const date = {};
    export const file = {light: { color: '#811f3f' }, dark: { color: '#d16969' }};
    export const more = {light: { color: '#001080' }, dark: { color: '#9cdcfe' }};
    export const clickable = { cursor: 'pointer', textDecoration: 'underline' };
    export const selected = {
        backgroundColor: new ThemeColor('merge.currentContentBackground'),
        isWholeLine: true,
        overviewRulerColor: 'darkgreen',
        overviewRulerLane: OverviewRulerLane.Full
    };
    
    export const loading = {
        light: { after: { contentIconPath: Icons.Loading.light } },
        dark: { after: { contentIconPath: Icons.Loading.dark } },
    };
}