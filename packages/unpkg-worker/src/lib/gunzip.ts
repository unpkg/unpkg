import zlib from "node:zlib";

export class GunzipStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(options?: zlib.ZlibOptions) {
    super(new GunzipTransformer(options));
  }
}

export class GunzipTransformer implements Transformer<Uint8Array, Uint8Array> {
  #gunzip: zlib.Gunzip;
  #dataHandler: ((chunk: Buffer) => void) | null = null;
  #errorHandler: ((error: Error) => void) | null = null;
  #pendingResolve: (() => void) | null = null;
  #pendingReject: ((error: Error) => void) | null = null;

  constructor(options?: zlib.ZlibOptions) {
    this.#gunzip = zlib.createGunzip(options);
  }

  start(controller: TransformStreamDefaultController<Uint8Array>): void {
    this.#dataHandler = (chunk: Buffer): void => {
      controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      if (this.#pendingResolve) {
        this.#pendingResolve();
        this.#pendingResolve = null;
        this.#pendingReject = null;
      }
    };

    this.#errorHandler = (error: Error): void => {
      let streamError = new Error(`Decompression error: ${error.message}`);
      controller.error(streamError);
      if (this.#pendingReject) {
        this.#pendingReject(streamError);
        this.#pendingResolve = null;
        this.#pendingReject = null;
      }
    };

    this.#gunzip.on("data", this.#dataHandler);
    this.#gunzip.on("error", this.#errorHandler);
  }

  transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): Promise<void> | void {
    try {
      let canContinue = this.#gunzip.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));

      // Handle backpressure if necessary
      if (!canContinue) {
        return new Promise<void>((resolve, reject) => {
          this.#pendingResolve = resolve;
          this.#pendingReject = reject;

          // Add drain event for when backpressure is relieved
          this.#gunzip.once("drain", () => {
            if (this.#pendingResolve) {
              this.#pendingResolve();
              this.#pendingResolve = null;
              this.#pendingReject = null;
            }
          });
        });
      }
    } catch (error) {
      controller.error(new Error(`Error in transform: ${(error as Error).message}`));
    }
  }

  flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.#gunzip.end(() => {
          resolve();
        });
      } catch (error) {
        reject(new Error(`Error in flush: ${(error as Error).message}`));
      }
    });
  }
}
