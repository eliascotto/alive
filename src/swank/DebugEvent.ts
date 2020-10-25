import { convert, convertArray, plistToObj } from './SwankUtils'
import { SwankEvent } from './SwankEvent'

export class DebugEvent implements SwankEvent {
    op: string
    // threadID: number
    // level: number
    // condition: string[]
    // restarts: { [index: string]: string }
    // frames: any
    // conts: any

    constructor(data: string[]) {
        this.op = data[0]
        // this.threadID = parseInt(data[1])
        // this.level = parseInt(data[2])
        // this.condition = convertArray(data[3])
        // this.restarts = this.convertRestarts(data[4])
        // this.frames = this.convertFrames(data[5])
        // this.conts = convertArray(data[6])
    }

    convertRestarts(restarts: Array<string[]>) {
        const res: { [index: string]: string } = {}

        for (let ndx = 0; ndx < restarts.length; ndx += 1) {
            const restart = restarts[ndx]
            const name = convert(restart[0])
            const desc = convert(restart[1])

            if (typeof name === 'string' && typeof desc === 'string') {
                res[name] = desc
            }
        }

        return res
    }

    // convertFrames(frameData) {
    //     const frames = []

    //     for (let ndx = 0; ndx < frameData.length; ndx += 1) {
    //         const data = frameData[ndx]
    //         const frame = {
    //             text: convert(data[1]),
    //         }

    //         if (data.length > 2) {
    //             frame.opts = plistToObj(data[2])
    //         }

    //         frames.push(frame)
    //     }

    //     return frames
    // }
}
