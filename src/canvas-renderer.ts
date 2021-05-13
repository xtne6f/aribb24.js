import CanvasProvider from './canvas-provider'
import HighResTextTrack from './utils/high-res-texttrack'
import { readID3Size, binaryISO85591ToString, binaryUTF8ToString, base64ToUint8Array} from './utils/binary'

interface RendererOption {
  width?: number,
  height?: number,
  data_identifer?: number,
  data_group_id?: number,
  forceStrokeColor?: string,
  forceBackgroundColor?: string,
  normalFont?: string,
  gaijiFont?: string,
  drcsReplacement?: boolean,
  keepAspectRatio?: boolean,
  enableRawCanvas?: boolean,
  enableAutoInBandMetadataDetection?: boolean,
  useStrokeText?: boolean,
  useHighResTextTrack?: boolean,
}

export default class CanvasID3Renderer {
  private media: HTMLMediaElement | null = null
  private id3Track: TextTrack | null = null
  private b24Track: TextTrack | null = null
  private subtitleElement: HTMLElement | null = null
  private viewCanvas: HTMLCanvasElement | null = null
  private rawCanvas: HTMLCanvasElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private isShowing: boolean = true
  private isOnSeeking: boolean = false
  private onB24CueChangeDrawed: boolean = false

  private onID3AddtrackHandler: ((event: TrackEvent) => void) | null = null
  private onID3CueChangeHandler: (() => void) | null = null

  private onB24CueChangeHandler: (() => void) | null = null

  private onSeekingHandler: (() => void) | null = null
  private onSeekedHandler: (() => void) | null = null
  private onResizeHandler: (() => void) | null = null

  private rendererOption: RendererOption | undefined
  private data_identifer: number
  private data_group_id: number

  public constructor(option?: RendererOption) {
    this.data_identifer = option?.data_identifer ?? 0x80 // default: caption
    this.data_group_id = option?.data_group_id ?? 0x01 // default: 1st language
    this.rendererOption = {
      ... option,
      data_identifer: this.data_identifer,
      data_group_id: this.data_group_id,
      keepAspectRatio: option?.keepAspectRatio ?? true, // default: true
      useStrokeText: option?.useStrokeText ?? true, // default: true
    }
  }

  public attachMedia(media: HTMLMediaElement, subtitleElement?: HTMLElement): void {
    this.detachMedia()
    this.media = media
    this.subtitleElement = subtitleElement ?? media.parentElement
    this.setupTrack()
    this.setupCanvas()
  }

  public detachMedia(): void {
    this.cleanupCanvas()
    this.cleanupTrack()
    this.media = this.subtitleElement = null
  }

  public dispose(): void {
    this.detachMedia()
  }

  public getViewCanvas(): HTMLCanvasElement | null {
    return this.viewCanvas
  }

  public getRawCanvas(): HTMLCanvasElement | null {
    return this.rawCanvas
  }

  public refresh(): void {
    this.onResize()
  }

  public show(): void {
    this.isShowing = true
    this.onResize()
  }

  public hide(): void {
    this.isShowing = false

    if (this.viewCanvas) {
      const viewContext = this.viewCanvas.getContext('2d')
      if (viewContext) {
        viewContext.clearRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
      }
    }

    if (this.rawCanvas) {
      const rawContext = this.rawCanvas.getContext('2d')
      if (rawContext) {
        rawContext.clearRect(0, 0, this.rawCanvas.width, this.rawCanvas.height);
      }
    }
  }

  public pushRawData(pts: number, data: Uint8Array): void {
    const provider: CanvasProvider = new CanvasProvider(data, pts);
    const estimate = provider.render({
      ... this.rendererOption,
      width: undefined, // ここはデフォルト値で負荷を軽くする
      height: undefined, // ここはデフォルト値で負荷を軽くする
    })
    if (estimate == null) { return; }

    const end_time = estimate.endTime;

    this.addB24Cue(pts, end_time, data)
  }

  // for b24.js compatibility
  public pushData(pid: number, uint8array: Uint8Array, pts: number): void {
    this.pushRawData(pts, uint8array);
  }

  private pushID3v2PRIVData(pts: number, owner: string, data: Uint8Array): void {
    if (owner !== 'aribb24.js') { return; }
    this.pushRawData(pts, data);
  }

  private pushID3v2TXXXData(pts: number, description: string, text: string): void {
    if (description !== 'aribb24.js') { return; }

    const data = base64ToUint8Array(text);
    this.pushRawData(pts, data);
  }

  public pushID3v2Data(pts: number, data: Uint8Array): void {
    for (let begin = 0; begin < data.length;) {
      const id3_start = begin;

      if (begin + 3 >= data.length) { break; }
      if (!(data[begin + 0] === 0x49 && data[begin + 1] === 0x44 && data[begin + 2] === 0x33)) { break; }
      begin += 3 + 2 /* version */ + 1 /* flag */;

      if (begin + 4 >= data.length) { break; }
      const id3_size = readID3Size(data, begin + 0, begin + 4);
      begin += 4;

      const id3_end = id3_start + 3 + 2 + 1 + 4 + id3_size;
      if (id3_end >= data.length) { break; }

      for (let frame = begin; frame < id3_end;) {
        const frame_begin = frame;

        if (frame + 4 >= data.length) { break; }
        const frame_name = binaryISO85591ToString(data, frame + 0, frame + 4);
        frame += 4;

        if (frame + 4 >= data.length) { break; }
        const frame_size = readID3Size(data, frame + 0, frame + 4);
        frame += 4 + 2 /* flag */;

        const frame_end = frame_begin + 4 + 4 + 2 + frame_size;
        if (frame_end >= data.length) { break; }

        if (frame_name === 'PRIV') {
          const PRIV_begin = frame;
          const PRIV_end = frame_end;

          while (data[frame] !== 0 && frame < frame_end) { frame++; }

          const owner = binaryISO85591ToString(data, PRIV_begin, frame);
          const pes = new Uint8Array(Array.prototype.slice.call(data, frame + 1, PRIV_end));
          this.pushID3v2PRIVData(pts, owner, pes);
        } else if (frame_name === 'TXXX') {
          const encoding = data[frame + 0];
          const description_begin = frame + 1;

          if (encoding === 0x03) { // UTF-8
            while (data[frame] !== 0 && frame < frame_end) { frame++; }
            const description_end = frame;
            frame += 1;

            const data_begin = frame;
            while (data[frame] !== 0 && frame < frame_end) { frame++; }
            const data_end = frame;

            const description = binaryUTF8ToString(data, description_begin, description_end);
            const text = binaryUTF8ToString(data, data_begin, data_end);
            this.pushID3v2TXXXData(pts, description, text);
          } else if(encoding === 0x00) { // Laten-1
            while (data[frame] !== 0 && frame < frame_end) { frame++; }
            const description_end = frame;
            frame += 1;

            const data_begin = frame;
            while (data[frame] !== 0 && frame < frame_end) { frame++; }
            const data_end = frame;

            const description = binaryISO85591ToString(data, description_begin, description_end);
            const text = binaryISO85591ToString(data, data_begin, data_end);
            this.pushID3v2TXXXData(pts, description, text);
          }
        }

        frame = frame_end;
      }

      begin = id3_start + 3 + 2 + 1 + 4 + id3_size;
      if (begin + 3 >= data.length) { continue; }
      // id3 footer
      if (!(data[begin + 0] === 0x33 && data[begin + 1] === 0x44 && data[begin + 2] === 0x49)) { continue; }
      begin += 3 + 2 /* version */ + 1 /* flags */ + 4 /* size */;
    }
  }

  public setInBandMetadataTextTrack(track: TextTrack): void {
    if (this.id3Track && this.onID3CueChangeHandler) {
      this.id3Track.removeEventListener('cuechange', this.onID3CueChangeHandler)
      this.onID3CueChangeHandler = null
    }

    this.id3Track = track

    this.id3Track.mode = 'hidden'
    this.onID3CueChangeHandler = this.onID3CueChange.bind(this)
    this.id3Track.addEventListener('cuechange', this.onID3CueChangeHandler)
  }

  private onID3CueChange() {
    if (!this.media || !this.id3Track || !this.b24Track) {
      return
    }

    if (this.isOnSeeking) { return }

    const activeCues = this.id3Track.activeCues ?? []
    for (let i = 0; i < activeCues.length; i++) {
      const id3_cue = activeCues[i] as any;
      const start_time = id3_cue.startTime;

      if (this.id3Track.inBandMetadataTrackDispatchType === '15260DFFFF49443320FF49443320000F'){ // Legacy Edge
        this.pushID3v2Data(start_time, id3_cue.data);
      } else if (this.id3Track.inBandMetadataTrackDispatchType === 'com.apple.streaming') { // Safari
        if (id3_cue.value.key === 'PRIV') {
          this.pushID3v2PRIVData(start_time, id3_cue.value.info, new Uint8Array(id3_cue.value.data));
        } else if (id3_cue.value.key === 'TXXX') {
          this.pushID3v2TXXXData(start_time, id3_cue.value.info, id3_cue.value.data);
        }
      } else if (this.id3Track.label === 'id3') { // hls.js
        if (id3_cue.value.key === 'PRIV') {
          this.pushID3v2PRIVData(start_time, id3_cue.value.info, new Uint8Array(id3_cue.value.data));
        } else if (id3_cue.value.key === 'TXXX') {
          this.pushID3v2TXXXData(start_time, id3_cue.value.info, id3_cue.value.data);
        }
      } else if (this.id3Track.label === 'Timed Metadata') { // video.js
        if (id3_cue.frame.key === 'PRIV') {
          this.pushID3v2PRIVData(start_time, id3_cue.frame.owner, new Uint8Array(id3_cue.frame.data));
        } else if (id3_cue.frame.key === 'TXXX') {
          this.pushID3v2TXXXData(start_time, id3_cue.frame.description, id3_cue.frame.data);
        }
      }
    }
  }

  private addB24Cue (start_time: number, end_time: number, data: Uint8Array) {
    if (!this.b24Track) {
      return
    }

    const CueClass = window.VTTCue ?? window.TextTrackCue

    const b24_cue = new CueClass(start_time, end_time, '');
    (b24_cue as any).data = data;

    if (window.VTTCue) {
      this.b24Track.addCue(b24_cue)
    } else if (window.TextTrackCue) {
      const hasCue = Array.prototype.some.call(this.b24Track.cues ?? [], (target) => {
        return target.startTime === start_time
      })
      if (hasCue) { return; }

      if (this.b24Track.cues) {
        const removed_cues: TextTrackCue[] = [];
        for (let i = this.b24Track.cues.length - 1; i >= 0; i--) {
          if (this.b24Track.cues[i].startTime >= start_time) {
            removed_cues.push(this.b24Track.cues[i])
            this.b24Track.removeCue(this.b24Track.cues[i])
          }
        }
        this.b24Track.addCue(b24_cue)
        for (let i = removed_cues.length - 1; i >= 0; i--) {
          this.b24Track.addCue(removed_cues[i])
        }
      }
    }
  }

  private onB24CueChange() {
    if (!this.media || !this.b24Track) {
      this.onB24CueChangeDrawed = false
      return
    }

    if (this.viewCanvas) {
      const viewContext = this.viewCanvas.getContext('2d')
      if (viewContext) {
        viewContext.clearRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
      }
    }

    if (this.rawCanvas) {
      const rawContext = this.rawCanvas.getContext('2d')
      if (rawContext) {
        rawContext.clearRect(0, 0, this.rawCanvas.width, this.rawCanvas.height);
      }
    }

    if (this.b24Track.activeCues && this.b24Track.activeCues.length > 0) {
      const lastCue = this.b24Track.activeCues[this.b24Track.activeCues.length - 1] as any

      if ((lastCue.startTime <= this.media.currentTime && this.media.currentTime <= lastCue.endTime) && !this.isOnSeeking) {
        // なんか Win Firefox で Cue が endTime 過ぎても activeCues から消えない場合があった、バグ?

        const provider: CanvasProvider = new CanvasProvider(lastCue.data, lastCue.startTime);

        if (this.isShowing && this.viewCanvas) {
          provider.render({
            ... this.rendererOption,
            canvas: this.viewCanvas,
            width: this.rendererOption?.width ?? this.viewCanvas.width,
            height: this.rendererOption?.height ?? this.viewCanvas.height,
          })
        }

        if (this.isShowing && this.rawCanvas) {
          provider.render({
            ... this.rendererOption,
            canvas: this.rawCanvas,
            width: this.rawCanvas.width,
            height: this.rawCanvas.height,
            keepAspectRatio: true,
          })
        }

        this.onB24CueChangeDrawed = true
      } else {
        this.onB24CueChangeDrawed = false
      }

      for (let i = this.b24Track.activeCues.length - 2; i >= 0; i--) {
        const cue = this.b24Track.activeCues[i]
        cue.endTime = Math.min(cue.endTime, lastCue.startTime)
        if (cue.startTime === cue.endTime) { // .. if duplicate subtitle appeared 
          this.b24Track.removeCue(cue);
        }
      }
    } else{
      this.onB24CueChangeDrawed = false
    }
  }

  private onSeeking() {
    this.isOnSeeking = true
    this.onB24CueChange()
  }

  private onSeeked() {
    this.isOnSeeking = false
  }

  private onResize() {
    if (!this.media) {
      return
    }

    const style = window.getComputedStyle(this.media)
    const media_width = Number.parseInt(style.width) * window.devicePixelRatio
    const media_height = Number.parseInt(style.height) * window.devicePixelRatio
    const video_width = (this.media as any).videoWidth
    const video_height = (this.media as any).videoHeight

    if (this.viewCanvas) {
      this.viewCanvas.width = Math.round(media_width)
      this.viewCanvas.height = Math.round(media_height)
    }
    if (this.rawCanvas) {
      this.rawCanvas.width = video_width
      this.rawCanvas.height = video_height
    }

    if (!this.b24Track) {
      return;
    }

    if (this.viewCanvas) {
      const viewContext = this.viewCanvas.getContext('2d')
      if (viewContext) {
        viewContext.clearRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
      }
    }

    if (this.rawCanvas) {
      const rawContext = this.rawCanvas.getContext('2d')
      if (rawContext) {
        rawContext.clearRect(0, 0, this.rawCanvas.width, this.rawCanvas.height);
      }
    }

    if (!this.onB24CueChangeDrawed) { return }

    // onB24CueChange とほぼ同じだが、this.onB24CueChangeDrawed を変更しない
    if (this.b24Track.activeCues && this.b24Track.activeCues.length > 0) {
      const lastCue = this.b24Track.activeCues[this.b24Track.activeCues.length - 1] as any

      if ((lastCue.startTime <= this.media.currentTime && this.media.currentTime <= lastCue.endTime) && !this.isOnSeeking) {
        // なんか Win Firefox で Cue が endTime 過ぎても activeCues から消えない場合があった、バグ?

        const provider: CanvasProvider = new CanvasProvider(lastCue.data, lastCue.startTime);

        if (this.isShowing && this.viewCanvas) {
          provider.render({
            ... this.rendererOption,
            canvas: this.viewCanvas,
            width: this.rendererOption?.width ?? this.viewCanvas.width,
            height: this.rendererOption?.height ?? this.viewCanvas.height,
          })
        }

        if (this.isShowing && this.rawCanvas) {
          provider.render({
            ... this.rendererOption,
            canvas: this.rawCanvas,
            width: this.rawCanvas.width,
            height: this.rawCanvas.height,
            keepAspectRatio: true,
          })
        }
      }
    }
  }

  private onID3Addtrack(event: TrackEvent): void {
    if (!this.media) {
      return;
    }

    const textTrack = event.track!;
    if (textTrack.kind !== 'metadata') { return; }

    if ( textTrack.inBandMetadataTrackDispatchType === '15260DFFFF49443320FF49443320000F' // Legacy Edge
      || textTrack.inBandMetadataTrackDispatchType === 'com.apple.streaming' // Safari
      || textTrack.label === 'id3' // hls.js
    ) {
      this.setInBandMetadataTextTrack(textTrack);
    }
  }

  private setupTrack(): void {
    if (!this.media) {
      return
    }

    if (this.rendererOption?.useHighResTextTrack) {
      this.b24Track = new HighResTextTrack(this.media);
      (this.b24Track as any).startPolling();
    } else {
      const aribb24js_label = `ARIB B24 Japanese (data_identifer=0x${this.data_identifer.toString(16)}, data_group_id=${this.data_group_id})`
      for (let i = 0; i < this.media.textTracks.length; i++) {
        const track = this.media.textTracks[i]
        if (track.label === aribb24js_label) {
          this.b24Track = track
          break
        }
      }
      if (!this.b24Track) {
        this.b24Track = this.media.addTextTrack('metadata', aribb24js_label, 'ja')
        this.b24Track.mode = 'hidden'
      }
    }

    this.onB24CueChangeHandler = this.onB24CueChange.bind(this)
    this.b24Track.addEventListener('cuechange', this.onB24CueChangeHandler)

    if (this.rendererOption?.enableAutoInBandMetadataDetection) {
      for (let i = 0; i < this.media.textTracks.length; i++) {
        const track = this.media.textTracks[i];

        if (track.kind !== 'metadata') { continue; }

        if ( track.inBandMetadataTrackDispatchType === '15260DFFFF49443320FF49443320000F' // Legacy Edge
          || track.inBandMetadataTrackDispatchType === 'com.apple.streaming' // Safari
          || track.label === 'id3' // hls.js
        ) {
          this.setInBandMetadataTextTrack(track);
          break;
        }
      }

      this.onID3AddtrackHandler = this.onID3Addtrack.bind(this)
      this.media.textTracks.addEventListener('addtrack', this.onID3AddtrackHandler)
    }

    this.onSeekingHandler = this.onSeeking.bind(this)
    this.onSeekedHandler = this.onSeeked.bind(this)
    this.media.addEventListener('seeking', this.onSeekingHandler)
    this.media.addEventListener('seeked', this.onSeekedHandler)
  }

  private setupCanvas(): void {
    if (!this.media || !this.subtitleElement){
      return
    }
    this.viewCanvas = document.createElement('canvas')
    this.viewCanvas.style.position = 'absolute'
    this.viewCanvas.style.top = this.viewCanvas.style.left = '0'
    this.viewCanvas.style.pointerEvents = 'none'
    this.viewCanvas.style.width = '100%'
    this.viewCanvas.style.height = '100%'

    if (this.rendererOption?.enableRawCanvas) {
      this.rawCanvas = document.createElement('canvas')
    }

    this.onResize()

    this.subtitleElement.appendChild(this.viewCanvas)

    this.onResizeHandler = this.onResize.bind(this)
    this.media.addEventListener('resize', this.onResizeHandler)

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.onResize()
      })
      this.resizeObserver.observe(this.media)
    } else {
      window.addEventListener('resize', this.onResizeHandler)

      if (window.MutationObserver) {
        this.mutationObserver = new MutationObserver(() => {
          this.onResize()
        })
        this.mutationObserver.observe(this.media, {
          attributes: true,
          attributeFilter: ['class', 'style']
        })
      }
    }
  }

  private cleanupTrack(): void {
    if (this.b24Track) {
      if (this.rendererOption?.useHighResTextTrack) {
        (this.b24Track as any).stopPolling();
      } else {
        if (this.b24Track.cues) {
          for (let i = this.b24Track.cues.length - 1; i >= 0; i--) {
            this.b24Track.removeCue(this.b24Track.cues[i])
          }
        }
      }
    }

    if (this.b24Track && this.onB24CueChangeHandler) {
      this.b24Track.removeEventListener('cuechange', this.onB24CueChangeHandler)
      this.onB24CueChangeHandler = null
    }
    if (this.id3Track && this.onID3CueChangeHandler) {
      this.id3Track.removeEventListener('cuechange', this.onID3CueChangeHandler)
      this.onID3CueChangeHandler = null
    }

    if (this.media){
      if (this.onSeekingHandler) {
        this.media.removeEventListener('seeking', this.onSeekingHandler)
        this.onSeekingHandler = null
      }
      if (this.onSeekedHandler) {
        this.media.removeEventListener('seeked', this.onSeekedHandler)
        this.onSeekedHandler = null
      }
      if (this.onID3AddtrackHandler) {
        this.media.textTracks.removeEventListener('addtrack', this.onID3AddtrackHandler)
        this.onID3AddtrackHandler = null
      }
    }

    this.b24Track = this.id3Track = null
  }

  private cleanupCanvas(): void {
    if (this.onResizeHandler) {
      window.removeEventListener('resize', this.onResizeHandler)
      if (this.media) {
         this.media.removeEventListener('resize', this.onResizeHandler)
      }

      this.onResizeHandler = null
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }

    if (this.viewCanvas && this.subtitleElement) {
      this.subtitleElement.removeChild(this.viewCanvas)
    }

    if (this.viewCanvas) {
      this.viewCanvas.width = this.viewCanvas.height = 0
    }

    if (this.rawCanvas) {
      this.rawCanvas.width = this.rawCanvas.height = 0
    }

    this.viewCanvas = this.rawCanvas = null
  }
}