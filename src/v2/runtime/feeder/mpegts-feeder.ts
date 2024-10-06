import AVLTree from '../../util/avl';

import ARIBB24Feeder, { ARIBB24FeederOption, ARIBB24FeederRawData, ARIBB24FeederTokenizedData } from './feeder';
import parsePES from '../../tokenizer/pes/index';
import JPNJIS8Tokenizer from '../../tokenizer/b24/jis8/locale/japan';


const compare = (a: number, b: number) => {
  return Math.sign(a - b) as (-1 | 0 | 1);
}

export default class ARIBB24MPEGTSFeeder implements ARIBB24Feeder {
  private option: ARIBB24FeederOption;
  private priviousTime: number | null = null;
  private decode: AVLTree<number, ARIBB24FeederRawData> = new AVLTree<number, ARIBB24FeederRawData>(compare);
  private decodeBuffer: ARIBB24FeederRawData[] = [];
  private decodingPromise: Promise<void>;
  private decodingNotify: (() => void) = Promise.resolve;
  private abortController: AbortController = new AbortController();
  private present: AVLTree<number, ARIBB24FeederTokenizedData> = new AVLTree<number, ARIBB24FeederTokenizedData>(compare);
  private isDestroyed: boolean = false;

  public constructor(option?: Partial<ARIBB24FeederOption>) {
    this.option = {
      timeshift: 0,
      ... option
    };

    this.decodingPromise = new Promise((resolve) => {
      this.decodingNotify = resolve;
    });
    this.pump();
  }

  private notify(segment: ARIBB24FeederRawData | null): void {
    if (segment != null) {
      this.decodeBuffer.push(segment);
    } else {
      this.abortController.abort();
      this.abortController = new AbortController();
    }

    this.decodingNotify?.();
  }

  private async *generator(signal: AbortSignal) {
    while (true) {
      await this.decodingPromise;
      this.decodingPromise = new Promise<void>((resolve) => {
        this.decodingNotify = resolve;
      });
      if (signal.aborted) {
        this.decodeBuffer = [];
        return;
      }

      const recieved = [... this.decodeBuffer];
      this.decodeBuffer = [];

      yield* recieved;
    }
  }

  private async pump() {
    while (!this.isDestroyed) {
      for await (const { pts, data } of this.generator(this.abortController.signal)) {
        // TODO: FIXME: NEED* 個々のロジックは外部に出す
        const parsed = parsePES(data);
        if (!parsed) { continue; }

        if (parsed.tag === 'Superimpose') { continue; } // TODO!

        const caption = parsed.content;
        if (caption.tag === 'CaptionManagement') { // TODO!
          continue;
        }
        for (const unit of caption.units) {
          switch (unit.tag) {
            case 'Statement': {
              const tokenizer = new JPNJIS8Tokenizer();
              break;
            }
            case 'DRCS':
              break;
            default: {
              const _: never = unit;
              throw new Error(`Undefined DataUnit in STD-B24)`);
            }
          }
        }

        //this.present.insert(pts, { pts: });
      }
    }
  }

  public feed(data: ArrayBuffer, pts: number, dts: number, timescale: number) {
    this.decode.insert(pts / timescale, { pts, data });
  }

  public content(time: number): ARIBB24FeederTokenizedData | null {
    if (this.priviousTime != null) {
      for (const segment of this.decode.range(this.priviousTime, time)) {
        this.notify(segment);
      }
    }
    this.priviousTime = time;

    time -= this.option.timeshift;
    return this.present.floor(time) ?? null;
  }

  private clear(): void {
    this.present.clear();
    this.priviousTime = null;
    this.notify(null);
  }

  public onattach(): void {
    this.clear();
  }

  public ondetach(): void {
    this.clear();
  }

  public onseeking(): void {
    this.clear();
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.clear();
  }
}
