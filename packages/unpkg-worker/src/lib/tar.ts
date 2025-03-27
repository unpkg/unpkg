const TarBlockSize = 512;

export type TarEntryType =
  | "file" // Regular file
  | "directory" // Directory entry
  | "symlink" // Symbolic link
  | "hardlink" // Hard link
  | "character" // Character special device
  | "block" // Block special device
  | "fifo" // FIFO special file
  | "contiguous" // Contiguous file
  | "unknown"; // Unknown type

type TarEntryTypeInternal = TarEntryType | "gnu-longname" | "gnu-longlink" | "pax-global" | "pax-local";

/**
 * The metadata from a tar file header.
 */
export interface TarHeader {
  /** The filename/path of the entry */
  name: string;
  /** The type of the tar entry */
  type: TarEntryType;
  /** The file mode/permissions in octal format */
  mode: number;
  /** The user ID of the owner */
  uid: number;
  /** The group ID of the owner */
  gid: number;
  /** The size of the entry content in bytes */
  size: number;
  /** Modification time (seconds since epoch) */
  mtime: number;
  /** The target path if this is a link */
  linkname?: string;
  /** The username of the owner */
  uname?: string;
  /** The group name */
  gname?: string;
  /** The header checksum */
  checksum: number;
  /** Extended headers */
  pax?: Record<string, string>;
}

/**
 * Represents a complete entry from a tar file, including content.
 * Extends TarHeader with the actual file content.
 */
export interface TarEntry {
  /** The metadata from the tar header */
  header: TarHeader;
  /** The binary content of the entry */
  content: Uint8Array;
}

/**
 * Configuration options for the TarParser.
 */
export interface TarParserOptions {
  /**
   * Maximum size of file content to process before throwing an error.
   * Default is Infinity.
   */
  maxFileSize?: number;
}

/**
 * Error class for tar parsing errors with additional context.
 */
export class TarParserError extends Error {
  /** Error code identifying the type of error */
  code: string;
  /** Byte offset in the tar stream where the error occurred */
  offset: number;

  /**
   * Creates a new TarParserError.
   *
   * @param code Error code
   * @param message Detailed error message
   * @param offset Byte offset in the tar stream where the error occurred
   */
  constructor(code: string, message: string, offset: number) {
    super(message);
    this.name = "TarParserError";
    this.code = code;
    this.offset = offset;
  }
}

function isZeroBlock(buffer: Uint8Array, offset: number): boolean {
  for (let i = 0; i < TarBlockSize; i++) {
    if (buffer[offset + i] !== 0) return false;
  }

  return true;
}

function calculateChecksum(header: Uint8Array): number {
  let sum = 0;

  for (let i = 0; i < TarBlockSize; i++) {
    sum += i >= 148 && i < 156 ? 32 : header[i];
  }

  return sum;
}

function parseString(buffer: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && buffer[end] !== 0) end++;
  return new TextDecoder().decode(buffer.subarray(offset, end));
}

function parseOctal(buffer: Uint8Array, offset: number, length: number): number {
  let str = parseString(buffer, offset, length);
  return str === "" ? 0 : parseInt(str, 8);
}

function getEntryType(typeFlag: number): TarEntryTypeInternal {
  let flag = String.fromCharCode(typeFlag);

  if (flag === "0" || flag === "\0") return "file";
  if (flag === "1") return "hardlink";
  if (flag === "2") return "symlink";
  if (flag === "3") return "character";
  if (flag === "4") return "block";
  if (flag === "5") return "directory";
  if (flag === "6") return "fifo";
  if (flag === "7") return "contiguous";
  if (flag === "L") return "gnu-longname";
  if (flag === "K") return "gnu-longlink";
  if (flag === "g") return "pax-global";
  if (flag === "x") return "pax-local";

  return "unknown";
}

function isPublicEntryType(type: TarEntryType | TarEntryTypeInternal): type is TarEntryType {
  return type !== "gnu-longname" && type !== "gnu-longlink" && type !== "pax-global" && type !== "pax-local";
}

function parsePaxHeader(buffer: Uint8Array): Record<string, string> {
  let result: Record<string, string> = {};
  let str = new TextDecoder().decode(buffer);
  let position = 0;

  while (position < str.length) {
    let spaceIndex = str.indexOf(" ", position);
    if (spaceIndex === -1) break;

    let length = parseInt(str.substring(position, spaceIndex), 10);
    if (isNaN(length) || length <= 0) break;

    let record = str.substring(spaceIndex + 1, position + length - 1);
    let equalsIndex = record.indexOf("=");

    if (equalsIndex !== -1) {
      let key = record.substring(0, equalsIndex);
      let value = record.substring(equalsIndex + 1);
      result[key] = value;
    }

    position += length;
  }

  return result;
}

function parseHeader(buffer: Uint8Array, offset: number): TarHeader {
  let checksum = calculateChecksum(buffer);
  let expectedChecksum = parseOctal(buffer, 148, 8);

  if (checksum !== expectedChecksum) {
    throw new TarParserError(
      "ECHECKSUM",
      `Header checksum mismatch: expected ${expectedChecksum}, got ${checksum}`,
      offset,
    );
  }

  let name = parseString(buffer, 0, 100);
  let typeFlag = buffer[156];

  // Handle UStar format
  let magic = parseString(buffer, 257, 6);
  if (magic === "ustar" || magic === "ustar\0") {
    let prefix = parseString(buffer, 345, 155);
    if (prefix) {
      name = `${prefix}/${name}`;
    }
  }

  return {
    name,
    type: getEntryType(typeFlag) as TarEntryType,
    mode: parseOctal(buffer, 100, 8),
    uid: parseOctal(buffer, 108, 8),
    gid: parseOctal(buffer, 116, 8),
    size: parseOctal(buffer, 124, 12),
    mtime: parseOctal(buffer, 136, 12),
    linkname: parseString(buffer, 157, 100) || undefined,
    uname: parseString(buffer, 265, 32) || undefined,
    gname: parseString(buffer, 297, 32) || undefined,
    checksum: expectedChecksum,
  };
}

/**
 * A streaming parser for tar archives.
 */
export class TarParser {
  #maxFileSize: number;
  #buffer: Uint8Array;
  #offset: number;
  #errorOffset: number;
  #pendingHeader: TarHeader | null;
  #contentRemaining: number;
  #contentChunks: Uint8Array[];
  #longName: string | null;
  #longLink: string | null;
  #globalExtendedHeaders: Record<string, string>;
  #localExtendedHeaders: Record<string, string>;
  #endOfArchive: boolean;

  /**
   * Creates a new TarParser instance.
   *
   * @param options Configuration options for the parser
   */
  constructor(options?: TarParserOptions) {
    this.#maxFileSize = options?.maxFileSize ?? Infinity;

    this.#buffer = new Uint8Array(0);
    this.#offset = 0;
    this.#errorOffset = 0;
    this.#pendingHeader = null;
    this.#contentRemaining = 0;
    this.#contentChunks = [];
    this.#longName = null;
    this.#longLink = null;
    this.#globalExtendedHeaders = {};
    this.#localExtendedHeaders = {};
    this.#endOfArchive = false;
  }

  /**
   * Resets the parser state to begin parsing a new archive.
   */
  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.#offset = 0;
    this.#errorOffset = 0;
    this.#pendingHeader = null;
    this.#contentRemaining = 0;
    this.#contentChunks = [];
    this.#longName = null;
    this.#longLink = null;
    this.#globalExtendedHeaders = {};
    this.#localExtendedHeaders = {};
    this.#endOfArchive = false;
  }

  /**
   * Processes a chunk of tar archive data and yields entries as they become available.
   *
   * @param chunk A chunk of tar archive data
   * @returns A generator that yields complete tar entries
   * @throws {TarParserError} When strict mode is enabled and an error is encountered,
   *         or when a file exceeds the `maxFileSize` limit
   */
  *write(chunk: Uint8Array): Generator<TarEntry, void, undefined> {
    if (this.#endOfArchive) {
      return; // Ignore any additional data after the end of the archive
    }

    if (this.#buffer.length > 0) {
      let newBuffer = new Uint8Array(this.#buffer.length + chunk.length);
      newBuffer.set(this.#buffer);
      newBuffer.set(chunk, this.#buffer.length);
      this.#buffer = newBuffer;
    } else {
      this.#buffer = chunk;
    }

    while (true) {
      if (this.#pendingHeader) {
        let bytesToConsume = Math.min(this.#contentRemaining, this.#buffer.length - this.#offset);

        if (bytesToConsume === 0) break;

        let totalContentSize = this.#pendingHeader.size - this.#contentRemaining + bytesToConsume;
        if (totalContentSize > this.#maxFileSize) {
          throw new TarParserError(
            "ETOOBIG",
            `File size exceeds maximum allowed size of ${this.#maxFileSize} bytes`,
            this.#errorOffset,
          );
        }

        this.#contentChunks.push(this.#buffer.subarray(this.#offset, this.#offset + bytesToConsume));
        this.#offset += bytesToConsume;
        this.#errorOffset += bytesToConsume;
        this.#contentRemaining -= bytesToConsume;

        if (this.#contentRemaining === 0) {
          let paddingBytes = (TarBlockSize - (this.#pendingHeader.size % TarBlockSize)) % TarBlockSize;

          if (this.#buffer.length - this.#offset >= paddingBytes) {
            this.#offset += paddingBytes;
            this.#errorOffset += paddingBytes;

            let content: Uint8Array;
            if (this.#contentChunks.length === 1) {
              content = this.#contentChunks[0];
            } else {
              content = new Uint8Array(this.#pendingHeader.size);
              let position = 0;
              for (let chunk of this.#contentChunks) {
                content.set(chunk, position);
                position += chunk.length;
              }
            }

            let header = this.#pendingHeader;
            let type = header.type as TarEntryTypeInternal;

            if (type === "gnu-longname") {
              this.#longName = new TextDecoder().decode(content).replace(/\0+$/, "");
            } else if (type === "gnu-longlink") {
              this.#longLink = new TextDecoder().decode(content).replace(/\0+$/, "");
            } else if (type === "pax-global") {
              this.#globalExtendedHeaders = {
                ...this.#globalExtendedHeaders,
                ...parsePaxHeader(content),
              };
            } else if (type === "pax-local") {
              this.#localExtendedHeaders = parsePaxHeader(content);
            } else if (isPublicEntryType(header.type)) {
              yield { header, content };
            }

            // Reset state after processing any entry type
            this.#pendingHeader = null;
            this.#contentChunks = [];
          } else {
            break;
          }
        }
      } else if (this.#buffer.length - this.#offset >= TarBlockSize) {
        if (isZeroBlock(this.#buffer, this.#offset)) {
          this.#offset += TarBlockSize;
          this.#errorOffset += TarBlockSize;

          if (this.#buffer.length - this.#offset >= TarBlockSize && isZeroBlock(this.#buffer, this.#offset)) {
            this.#offset += TarBlockSize;
            this.#errorOffset += TarBlockSize;
            this.#endOfArchive = true;
          } else {
            // We found only one zero block, not two. This is technically invalid, but
            // just ignore it and assume the archive ends here.
            this.#endOfArchive = true;
          }

          break;
        }

        let header = parseHeader(this.#buffer.subarray(this.#offset, this.#offset + TarBlockSize), this.#errorOffset);
        this.#offset += TarBlockSize;
        this.#errorOffset += TarBlockSize;

        applyPaxHeaders(header, this.#localExtendedHeaders, this.#globalExtendedHeaders);
        this.#localExtendedHeaders = {};

        // GNU format overrides pax headers
        if (this.#longName) {
          header.name = this.#longName;
          this.#longName = null;
        }

        if (this.#longLink) {
          header.linkname = this.#longLink;
          this.#longLink = null;
        }

        if (header.size > 0) {
          this.#pendingHeader = header;
          this.#contentRemaining = header.size;
        } else if (isPublicEntryType(header.type)) {
          yield { header, content: new Uint8Array(0) };
        }
      } else {
        break;
      }
    }

    this.#compactBuffer();
  }

  /**
   * Finalizes parsing and signals no more data will be provided.
   * Should be called after all data has been processed with write().
   *
   * @throws {TarParserError} If the tar archive ends unexpectedly while processing an entry
   */
  end(): void {
    if (this.#pendingHeader) {
      throw new TarParserError("ETRUNC", "Unexpected end of tar data while processing an entry", this.#errorOffset);
    }
  }

  #compactBuffer() {
    if (this.#offset > 0) {
      this.#buffer = this.#buffer.subarray(this.#offset);
      this.#offset = 0;
    }
  }
}

// Apply extended headers (local override global)
function applyPaxHeaders(
  header: TarHeader,
  localHeaders: Record<string, string>,
  globalHeaders: Record<string, string>,
): void {
  if (localHeaders["path"]) {
    header.name = localHeaders["path"];
  } else if (globalHeaders["path"]) {
    header.name = globalHeaders["path"];
  }

  if (localHeaders["size"]) {
    header.size = Number(localHeaders["size"]);
  } else if (globalHeaders["size"]) {
    header.size = Number(globalHeaders["size"]);
  }

  if (localHeaders["mtime"]) {
    header.mtime = Number(localHeaders["mtime"]);
  } else if (globalHeaders["mtime"]) {
    header.mtime = Number(globalHeaders["mtime"]);
  }

  if (localHeaders["linkpath"]) {
    header.linkname = localHeaders["linkpath"];
  } else if (globalHeaders["linkpath"]) {
    header.linkname = globalHeaders["linkpath"];
  }

  if (localHeaders["uname"]) {
    header.uname = localHeaders["uname"];
  } else if (globalHeaders["uname"]) {
    header.uname = globalHeaders["uname"];
  }

  if (localHeaders["gname"]) {
    header.gname = localHeaders["gname"];
  } else if (globalHeaders["gname"]) {
    header.gname = globalHeaders["gname"];
  }

  if (Object.keys(globalHeaders).length > 0 || Object.keys(localHeaders).length > 0) {
    header.pax = Object.assign({}, globalHeaders, localHeaders);
  }
}

/**
 * Parses a tar archive from a Uint8Array, yielding entries as they become available.
 *
 * @param buffer A Uint8Array containing tar archive data
 * @param options Configuration options for the parser
 * @returns A Generator that yields tar entries
 * @throws {TarParserError} If the tar archive is invalid or incomplete
 */
export function* parseTar(buffer: Uint8Array, options?: TarParserOptions): Generator<TarEntry, void, undefined> {
  let parser = new TarParser(options);
  yield* parser.write(buffer);
  parser.end();
}

/**
 * Parses a tar archive from a ReadableStream, yielding entries as they become available.
 *
 * @param stream A ReadableStream containing tar archive data
 * @param options Configuration options for the parser
 * @returns An AsyncGenerator that yields tar entries
 * @throws {TarParserError} If the tar archive is invalid or incomplete
 */
export async function* parseTarStream(
  stream: ReadableStream<Uint8Array>,
  options?: TarParserOptions,
): AsyncGenerator<TarEntry, void, undefined> {
  let parser = new TarParser(options);
  let reader = stream.getReader();

  try {
    while (true) {
      let result = await reader.read();

      if (result.done) {
        parser.end();
        break;
      }

      yield* parser.write(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}
