const types = require('../Types');
const { format } = require('util');
const { Position, Range, TextEdit, workspace } = require('vscode');

const DEFAULT_INDENT = 3;

module.exports.Formatter = class {
    constructor(doc, opts, tokens) {
        this.original = tokens;
        this.tokens = this.copyTokens(tokens);
        this.token = undefined;
        this.curLine = undefined;
        this.curLineEmpty = undefined;
        this.sexprs = [];
        this.states = undefined;
        this.edits = undefined;
    }

    setConfiguration() {
        const cfg = workspace.getConfiguration('common_lisp');
        const haveCfg = (cfg !== undefined && cfg.format !== undefined);

        if (!haveCfg) {
            return;
        }

        this.setConfigOption(cfg, 'indentWidth', DEFAULT_INDENT);
        this.setConfigOption(cfg, 'alignExpressions', false);

        this.setConfigOption(cfg, 'allowOpenOnOwnLine', undefined);

        this.setConfigOption(cfg, 'indentCloseParenStack', true);
        this.setConfigOption(cfg, 'closeParenStacked', undefined);
        this.setConfigOption(cfg, 'closeParenOwnLine', undefined);

        this.setConfigOption(cfg, 'removeBlankLines', undefined);
        this.setConfigOption(cfg, 'fixWhitespace', undefined);
    }

    setConfigOption(cfg, opt, value = undefined) {
        this[opt] = cfg.format[opt] !== undefined ? cfg.format[opt] : value;
    }

    copyTokens(tokens) {
        const newTokens = [];

        for (let ndx = 0; ndx < tokens.length; ndx += 1) {
            const token = tokens[ndx];
            const copy = JSON.parse(JSON.stringify(token));

            copy.ndx = ndx;
            newTokens.push(copy);
        }

        return newTokens;
    }

    format() {
        this.setConfiguration();

        this.edits = [];
        this.curLine = 0;
        this.curLineEmpty = true;
        this.token = this.tokens[0];

        while (this.token !== undefined) {
            this.processToken();
        }

        this.debugDump();
        return this.edits;
    }

    debugDump() {
        let str = '';
        let line = 0;

        for (let ndx = 0; ndx < this.tokens.length; ndx += 1) {
            const token = this.tokens[ndx];

            if (token.start.line !== line) {
                console.log(str);
                str = `[${token.start.line},${token.start.character}:${token.end.line},${token.end.character}]`;
                line = token.start.line;
            } else {
                str += `[${token.start.line},${token.start.character}:${token.end.line},${token.end.character}]`;
            }
        }
    }

    processToken() {
        if (this.token.start.line !== this.curLine) {
            this.curLine = this.token.start.line;
            this.curLineEmpty = true;
        }

        switch (this.token.type) {
            case types.OPEN_PARENS:
                this.curLineEmpty = false;
                this.checkMultiline();
                return this.openParens();
            case types.CLOSE_PARENS:
                return this.closeParens();
            case types.WHITE_SPACE:
                return this.whitespace();
            case types.CONTROL:
            case types.ID:
            case types.KEYWORD:
            case types.MACRO:
            case types.SPECIAL:
            case types.SYMBOL:
                this.curLineEmpty = false;
                this.checkMultiline();
                return this.funcCall();
            default:
                this.unhandledToken('processtToken', this.token);
                this.consume();
        }
    }

    checkMultiline() {
        if (this.sexprs.length === 0) {
            return;
        }

        const sexpr = this.sexprs[this.sexprs.length - 1];

        if (sexpr.open.start.line !== this.token.start.line) {
            for (let ndx = 0; ndx < this.sexprs.length; ndx += 1) {
                this.sexprs[ndx].multiline = true;
            }
        }
    }

    funcCall() {
        if (this.sexprs.length === 0) {
            return;
        }

        const sexpr = this.sexprs[this.sexprs.length - 1];

        if (sexpr.indent === undefined) {
            sexpr.alignNext = true;
            sexpr.indent = this.alignIndent(sexpr, this.token);
        } else if (sexpr.alignNext) {
            sexpr.indent = this.alignIndent(sexpr, this.token);
            sexpr.alignNext = false;
        }

        this.consume();
    }

    alignIndent(sexpr, token) {
        return this.alignExpressions ? token.start.character : sexpr.open.start.character + this.indentWidth;
    }

    whitespace() {
        if (this.token.ndx >= this.tokens.length - 1) {
            return this.fixEOF();
        }

        if (this.sexprs.length === 0) {
            // console.log(`Whitespace outside expr ${format(this.token)}`);
        } else if (this.tokens[this.token.ndx + 1].type === types.CLOSE_PARENS) {
            // Close parens code handles this
        } else {
            const sexpr = this.sexprs[this.sexprs.length - 1];
            if (sexpr.indent === undefined && this.fixWhitespace) {
                this.deleteToken(this.token);
            } else if (this.token.start.line === this.token.end.line) {
                this.fixPadding();
            } else {
                this.fixIndent(this.token, sexpr.indent);
            }
        }

        this.consume();
    }

    fixPadding() {
        if (!this.fixWhitespace || this.token.text.length <= 1) {
            return;
        }

        const origToken = this.original[this.token.ndx];
        const start = new Position(origToken.start.line, origToken.start.character + 1);
        const end = new Position(origToken.end.line, origToken.end.character);
        const range = new Range(start, end);

        this.edits.push(TextEdit.delete(range));
        this.fixLine();
    }

    deleteToken(token) {
        if (token === undefined) {
            return;
        }

        const origToken = this.original[token.ndx];

        this.edits.push(TextEdit.delete(new Range(origToken.start, origToken.end)));

        if (token.type === types.WHITE_SPACE) {
            const count = this.countLines(token);
            this.adjustLineNumbers(token.ndx, -count);
        }

        this.fixLine();
    }

    countLines(token) {
        if (token.type !== types.WHITE_SPACE) {
            return 0;
        }

        let count = 0;
        for (let ndx = 0; ndx < token.text.length; ndx += 1) {
            if (token.text.charAt(ndx) === '\n') {
                count += 1;
            }
        }

        return count;
    }

    fixIndent(token, indent) {
        if (indent === undefined) {
            return;
        }

        const current = this.countIndent(token);
        const orig = this.original[token.ndx];

        if (current < indent) {
            const diff = indent - current;
            const pad = ' '.repeat(diff);

            this.edits.push(TextEdit.insert(new Position(orig.end.line, orig.end.character), pad));

            token.end = new Position(token.end.line, token.end.character + diff);
            this.fixLine();
        } else if (current > indent) {
            const diff = current - indent;
            const start = new Position(orig.end.line, orig.end.character - diff);
            const end = new Position(orig.end.line, orig.end.character);

            this.edits.push(TextEdit.delete(new Range(start, end)));

            token.end = new Position(token.end.line, token.end.character - diff);
            this.fixLine();
        }
    }

    countIndent(token) {
        const txt = (token.text !== undefined) ? token.text : '';
        let count = 0;

        for (let ndx = txt.length - 1; ndx >= 0; ndx -= 1) {
            if (txt.charAt(ndx) !== ' ') {
                break;
            }

            count += 1;
        }

        return count;
    }

    fixLine() {
        let token = this.token;
        let next = this.nextToken(token);

        while (next !== undefined) {
            if (next.start.character !== token.end.character) {
                next.start = new Position(next.start.line, token.end.character);
            }

            if (next.start.line !== next.end.line) {
                break;
            }

            next.end = new Position(next.start.line, next.start.character + next.text.length);

            token = next;
            next = this.nextToken(token);
        }
    }

    fixEOF() {
        this.consume();
    }

    closeParens() {
        const sexpr = this.sexprs.pop();
        const count = this.countCloseParens();

        if (this.closeParenOwnLine === 'multiline') {
            this.closeOwnLineMulti(sexpr, count);
            this.consume();
        } else {
            console.log(`CLOSE PAREN NOT MULTILINE`);
        }
    }

    stackRemainingParens(count) {
        if (count === 0) {
            return;
        }

        if (this.closeParenStacked === 'always') {
            this.stackCloseParens(count);
        } else if (this.closeParenStacked === 'never') {
            console.log('UNSTACK CLOSE PARENS');
        } else {
            console.log('INDENT CLOSE PARENS');
        }
    }

    closeOwnLineMulti(sexpr, count) {
        while (!sexpr.multiline) {
            const prev = this.prevToken(this.token);
            if (prev.type === types.WHITE_SPACE) {
                this.deleteToken(prev);
            }

            count -= 1;
            if (count === 0) {
                return;
            }

            this.token = this.findNextCloseParen();
            sexpr = this.sexprs.pop();
        }

        const indent = this.getCloseStackIndent(sexpr, count);

        this.forceOwnLine(indent);
        this.stackRemaining(count - 1);
    }

    stackRemaining(count) {
        while (count > 0) {
            this.token = this.nextToken(this.token);

            if (this.token.type === types.WHITE_SPACE) {
                this.deleteToken(this.token);
            } else if (this.token.type === types.CLOSE_PARENS) {
                this.sexprs.pop();
                count -= 1;
            } else {
                break;
            }
        }
    }

    findNextCloseParen() {
        for (let ndx = this.token.ndx + 1; ndx < this.tokens.length; ndx += 1) {
            if (this.tokens[ndx].type === types.CLOSE_PARENS) {
                return this.tokens[ndx];
            }
        }

        return undefined;
    }

    forceOwnLine(indent) {
        const prev = this.prevToken(this.token);

        if (prev.type === types.WHITE_SPACE) {
            (prev.start.line === prev.end.line)
                ? this.breakLine(prev, indent)
                : this.fixIndent(prev, indent);
        } else {
            const pad = ' '.repeat(indent);
            this.edits.push(TextEdit.insert(this.original[this.token.ndx].start, '\n' + pad));
            this.adjustLineNumbers(this.token.ndx, 1);
        }
    }

    getCloseStackIndent(sexpr, count) {
        if (this.sexprs.length === 0) {
            return 0;
        }

        if (count === 1) {
            return sexpr.open.start.character;
        }

        const target = (this.indentCloseParenStack)
            ? sexpr
            : this.sexprs[this.sexprs.length - count + 1];

        return target.open.start.character;
    }

    breakLine(token, indent) {
        this.edits.push(TextEdit.insert(this.original[token.ndx].start, '\n'));

        this.adjustLineNumbers(token.ndx, 1);
        this.fixIndent(token, indent);
    }

    closeOwnLineNever(sexpr, token, count) {
        const prev = this.prevToken(token);

        if (prev.type === types.WHITE_SPACE) {
            this.deleteToken(prev);
        }
    }

    adjustLineNumbers(startNdx, diff) {
        for (let ndx = startNdx; ndx < this.tokens.length; ndx += 1) {
            const token = this.tokens[ndx];

            this.tokens[ndx].start = new Position(token.start.line + diff, token.start.character);
            this.tokens[ndx].end = new Position(token.end.line + diff, token.end.character);
        }
    }

    countCloseParens() {
        let count = 0;

        for (let ndx = this.token.ndx; ndx < this.tokens.length; ndx += 1) {
            const token = this.tokens[ndx];

            if (token.type === types.WHITE_SPACE) {
                continue;
            }

            if (token.type !== types.CLOSE_PARENS) {
                break;
            }

            count += 1;
        }

        return count;
    }

    openParens() {
        if (this.sexprs.length > 0) {
            const sexpr = this.sexprs[this.sexprs.length - 1];

            if (sexpr.indent === undefined || sexpr.alignNext) {
                sexpr.indent = this.alignIndent(sexpr, this.token);
                sexpr.alignNext = false;
            }
        }

        const expr = {
            open: this.token,
            alignNext: false,
            indent: undefined,
            multiline: false,
        };

        this.sexprs.push(expr);
        this.consume();
    }

    unhandledToken(state, token) {
        console.log(`${state} unhandled token ${format(token)}`);
    }

    prevToken(token) {
        const ndx = token.ndx - 1;

        if (ndx < 0) {
            return undefined;
        }

        return this.tokens[ndx];
    }

    nextToken(token) {
        const ndx = token.ndx + 1;

        if (ndx >= this.tokens.length) {
            return undefined;
        }

        return this.tokens[ndx];
    }

    consume() {
        const next = (this.token.ndx + 1 < this.tokens.length)
            ? this.tokens[this.token.ndx + 1]
            : undefined;

        this.token = next;
    }

    debugToken(token) {
        return `[${token.start.line},${token.start.character}]`;
    }
};
