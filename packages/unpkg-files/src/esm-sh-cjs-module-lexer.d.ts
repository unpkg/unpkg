declare module "@esm.sh/cjs-module-lexer" {
  export interface CommonJsLexerOptions {
    callMode?: boolean;
    nodeEnv?: "development" | "production";
  }

  export interface CommonJsLexerResult {
    exports: string[];
    reexports: string[];
  }

  export function parse(filename: string, code: string, options?: CommonJsLexerOptions): CommonJsLexerResult;
}
