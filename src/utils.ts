import { Uri } from 'vscode';
import { HashMap } from './constants';
import * as moment from '../lib/moment';


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

export function format(format: string, placeholders: HashMap<string|number|Function>) {
    return format.replace(/\$\{(\w+)(?::(.+?))?\}/g, (match, placeholder, argument) => {
        let value = placeholders[placeholder];
        if (typeof value === 'undefined') {
            return  placeholder;
        }
        if (typeof value === 'function') {
            return value(argument);
        }
        return value;
    });
}

export function strftime(date, format: string) {
    let replacements = { 
        a: 'ddd',  A: 'dddd',       b: 'MMM', B: 'MMMM', c: 'llll',  d: 'DD',   D: 'MM/DD/YY',
        e: 'D',    F: 'YYYY-MM-DD', H: 'HH',  I: 'hh',   j: 'DDDD',  k: 'H',    l: 'h',        
        m: 'MM',   M: 'mm',         p: 'p',   P: 'A',    R: 'HH:mm', S: 'ss',   T: 'HH:mm:ss', 
        u: 'E',    V: 'WW',         w: 'd',   W: 'WW',   x: 'll',    X: 'LTS',  y: 'YY',
        Y: 'YYYY', z: 'ZZ',         Z: 'z',  '+': 'ddd MMM D HH:mm:ss z YYYY', '%': '%', 

        N: 'this is fromNow',
    };

    let mjs = moment(date);

    if (!format) {
        return mjs.format();
    }

    let momentFormat = format.split(/(%.)/).map(token => {
        if (token === '%N') { //
            return '[' + mjs.fromNow() + ']';
        } else if (token[0] === '%' && replacements[token[1]]) {
            return replacements[token[1]];
        }
        return token.length > 0 ? '[' + token + ']' : token;
    }).join('');

    return mjs.format(momentFormat);
}

moment.relativeTimeThreshold('m', 50);
moment.relativeTimeThreshold('h', 22);
moment.relativeTimeThreshold('d', 28);
moment.relativeTimeThreshold('M', 10);
