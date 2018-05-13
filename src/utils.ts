import { Uri } from 'vscode';
import { HashMap } from './constants';

export function format(format: string, placeholders: HashMap<string>) {
    return format.split(/(\$\w+)/g).map(value => {
        if (value[0] === '$' && placeholders[value.substr(1)] !== undefined) {
            return placeholders[value.substr(1)];
        }
        return value;
    }).join('');
}

export function randomString(length: number = 64) {
    let value = '';

    while (value.length < length) {
        value += Math.random().toString(36).substr(2);
    }

    return value.substr(0, length);
}

export function toGitUri(uri: Uri, ref?: string): Uri {
    return uri.with({scheme: 'git', query: JSON.stringify({path: uri.fsPath, ref})});
}
