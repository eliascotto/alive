import { types } from '../../lisp'
import { Expr } from './Expr'
import { ExprFormatter } from './ExprFormatter'
import { countNewLines, isExprEnd, setTarget, State, withIndent } from './Utils'

export class ListExpr extends ExprFormatter {
    align = 1

    constructor(state: State) {
        super(state)
    }

    format() {
        let curToken = this.peekToken()
        if (curToken === undefined) {
            return
        }

        this.align = this.state.indent[this.state.indent.length - 1] + 1

        const ss = this.snapshot()

        this.formatBody()

        if (ss.mlBefore || this.isMultiline || this.isOrigML) {
            this.restore(ss)
            this.isMultiline = true

            withIndent(this.state, this.align, () => {
                this.formatBody()
            })
        }
    }

    formatBody() {
        let curToken = this.peekToken()
        if (curToken === undefined) {
            return
        }

        let first = true
        let alignChanged = false

        while (!isExprEnd(curToken)) {
            withIndent(this.state, this.align, () => {
                if (curToken === undefined) {
                    return
                }

                if (first) {
                    setTarget(this.state, curToken, '')
                } else if (this.prevIsSymbol()) {
                    setTarget(this.state, curToken, ' ')
                } else if (countNewLines(curToken.before.existing) > 0) {
                    this.addLineIndent(curToken)
                } else {
                    setTarget(this.state, curToken, ' ')
                }

                if (!first && !alignChanged && curToken.token.type !== types.COMMENT) {
                    this.align = this.state.lineLength
                    alignChanged = true
                }

                const expr = new Expr(this.state)
                this.formatExpr(expr)

                first = false
            })

            curToken = this.peekToken()
        }
    }

    private prevIsSymbol() {
        const prev = this.prevToken()

        return prev?.token.type === types.SYMBOL
    }
}