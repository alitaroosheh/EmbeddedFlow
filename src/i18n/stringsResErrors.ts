export class StringsResParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StringsResParseError";
    }
}
