import { ARIBB24ParserState } from "../../../parser/index";
import { ARIBB24Token } from "../../../tokenizer/token";
import Renderer from "../renderer";
import { CanvasRendererOption } from "./canvas-renderer-option";

export default abstract class CanvasRenderer implements Renderer {
  protected option: CanvasRendererOption;
  protected canvas: HTMLCanvasElement;

  public constructor(option?: Partial<CanvasRendererOption>) {
    this.option = CanvasRendererOption.from(option);
    // Setup Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  public abstract resize(width: number, height: number): void;
  public abstract destroy(): void;
  public abstract clear(): void;
  public abstract render(initialState: ARIBB24ParserState, tokens: ARIBB24Token[]): void;

  public onAttach(element: HTMLElement): void {
    element.appendChild(this.canvas);
  }

  public onDetach(): void {
    this.canvas.remove();
  }

  public onContainerResize(width: number, height: number): boolean {
    if (this.option.resize.target !== 'container') { return false; }

    this.clear();
    this.resize(width, height);
    return true;
  }

  public onVideoResize(width: number, height: number): boolean {
    if (this.option.resize.target !== 'video') { return false; }

    this.clear();
    this.resize(width, height);
    return true;
  }

  public onSeeking(): void {
    this.clear();
  }
}
