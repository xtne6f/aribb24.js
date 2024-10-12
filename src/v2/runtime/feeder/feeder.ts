import { ARIBB24ParserState, initialState } from "../../parser/index";
import { CaptionManagement } from "../../tokenizer/b24/datagroup";
import ARIBJapaneseJIS8Tokenizer from "../../tokenizer/b24/jis8/ARIB/index";
import ARIBB24Tokenizer from "../../tokenizer/b24/tokenizer";
import { ARIBB24Token } from "../../tokenizer/token";

export type FeederOption = {
  timeshift: number;
  association: 'ARIB' | 'SBTVD' | null; // null is AutoDetect
  tokenizer: {
    usePUA: boolean;
  };
};
export const FeederOption = {
  from (option?: Partial<FeederOption>): FeederOption {
    return {
      timeshift: 0,
      association: null,
      ... option,
      tokenizer: {
        usePUA: false,
        ... option?.tokenizer
      },
    };
  }
}

export const getTokenizeInformation = (language: string, option: FeederOption): [ARIBB24Tokenizer, ARIBB24ParserState] | null => {
  switch (option.association) {
    case 'ARIB': return [new ARIBJapaneseJIS8Tokenizer({ usePUA: option.tokenizer.usePUA }), initialState]
  }

  switch (language) {
    case 'jpn':
    case 'eng':
      return [new ARIBJapaneseJIS8Tokenizer({ usePUA: option.tokenizer.usePUA }), initialState];
  }

  return null;
}

export type FeederRawData = {
  pts: number;
  data: ArrayBuffer;
};
export type FeederTokenizedData = {
  pts: number;
  duration: number;
  state: ARIBB24ParserState;
  data: ARIBB24Token[];
};

export default interface Feeder {
  content(time: number): FeederTokenizedData | null;
  onAttach(): void;
  onDetach(): void;
  onSeeking(): void;
}
