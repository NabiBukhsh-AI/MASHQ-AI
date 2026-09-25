/** A parse failure whose message is safe and useful to show to the person who uploaded the file. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
