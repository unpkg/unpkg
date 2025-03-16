export class HttpError extends Error {
  name = "HttpError";
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
