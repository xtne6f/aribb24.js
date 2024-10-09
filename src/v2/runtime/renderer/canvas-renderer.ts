import { ARIBB24Token } from "../../tokenizer/token";
import ARIBB24Renderer from "./renderer";
import { ARIBB24CanvasRenderOption } from "./canvas-renderer-option";

export default abstract class ARIBB24CanvasRenderer implements ARIBB24Renderer {
  protected option: ARIBB24CanvasRenderOption;
  protected canvas: HTMLCanvasElement;

  public constructor(option?: Partial<ARIBB24CanvasRenderOption>) {
    this.option = ARIBB24CanvasRenderOption.from(option);
    // Setup Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.objectFit = 'contain';

    this.canvas.width = 1920;
    this.canvas.height = 1080;
  }

  public resize(width: number, height: number): void {
    if (this.canvas == null) { return; }

    this.canvas.width = width;
    this.canvas.height = height;
  }

  public destroy(): void {
    this.resize(0, 0);
  }

  public abstract render(tokens: ARIBB24Token[]): void;
  public abstract clear(): void;

  public onAttach(element: HTMLElement): void {
    element.appendChild(this.canvas);
  }

  public onDetach(): void {
    this.canvas.remove();
  }

  public onContainerResize(element: HTMLElement): void {
    this.clear();
  }

  public onVideoResize(video: HTMLVideoElement): void {
    // noop
  }

  public onSeeking(): void {
    this.clear();
  }
}
