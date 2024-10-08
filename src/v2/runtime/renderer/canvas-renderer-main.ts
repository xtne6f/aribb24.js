import { ARIBB24Parser } from "../../parser/index";
import { ARIBB24Token } from "../../tokenizer/token";
import ARIBB24CanvasRenderer from "./canvas-renderer";
import colortable from "./colortable";
import { ARIBB24RenderOption } from "./renderer-option";

export default class ARIBB24CanvasMainThreadRenderer extends ARIBB24CanvasRenderer {
  private buffer: HTMLCanvasElement;

  public constructor(option?: Partial<ARIBB24RenderOption>) {
    super(option);
    this.buffer = document.createElement('canvas');
  }

  public render(tokens: ARIBB24Token[]): void {
    {
      const context = this.buffer.getContext('2d');
      if (context == null) { return; }

      const parser = new ARIBB24Parser();
      for (const token of parser.parse(tokens)) {
        const plane_width = token.state.plane[0];
        const plane_height = token.state.plane[1];
        if (this.buffer.width !== plane_width || this.buffer.height !== plane_height) {
          this.buffer.width = plane_width;
          this.buffer.height = plane_height;
        }

        switch (token.tag) {
          case 'Character': {
            const { state, option, character: { character } } = token;
            const font = this.option.font.normal;

            // background
            context.fillStyle = this.option.color.background ?? colortable[state.background];
            context.fillRect(
              state.margin[0] + state.position[0],
              state.margin[1] + (state.position[1] + 1) - ARIBB24Parser.height(state),
              ARIBB24Parser.width(state),
              ARIBB24Parser.height(state)
            );

            const center_x = (state.margin[0] + state.position[0] + ARIBB24Parser.width(state) / 2);
            const center_y = (state.margin[1] + (state.position[1] + 1) - ARIBB24Parser.height(state) / 2);
            context.translate(center_x, center_y);
            context.scale(ARIBB24Parser.scale(state)[0], ARIBB24Parser.scale(state)[1]);

            // orn
            if (this.option.color.stroke != null || state.ornament != null) {
              context.font = `${state.fontsize[0]}px ${font}`;
              context.strokeStyle = this.option.color.stroke ?? colortable[state.ornament!];
              context.lineJoin = 'round';
              context.textBaseline = 'middle';
              context.textAlign = 'center';
              context.lineWidth = 4 * option.magnification;
              context.strokeText(character, 0, 0);
            }

            // text
            context.font = `${state.fontsize[0]}px ${font}`;
            context.fillStyle = this.option.color.foreground ?? colortable[state.foreground];
            context.textBaseline = 'middle';
            context.textAlign = 'center';
            context.fillText(character, 0, 0);

            context.setTransform(1, 0, 0, 1, 0, 0);
            break;
          }
          case 'DRCS': {
            break;
          }
          case 'ClearScreen':
            if (token.time === 0) {
              // erase internal buffer
              context.clearRect(0, 0, this.buffer.width, this.buffer.height);
            }
            break;
          case 'PRA':
            break;
          default:
            const exhaustive: never = token;
            throw new Error(`Unhandled ARIB Parsed Token (${exhaustive})`);
        }
      }
    }
    {
      const context = this.canvas.getContext('2d');
      if (context == null) { return; }

      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    }
  }
  public clear() {
    const context = this.canvas.getContext('2d');
    if (context == null) { return; }

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
