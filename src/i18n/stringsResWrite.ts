import * as fs from "fs";
import * as path from "path";
import type { StringsResFile } from "./stringsResParser";

export function serializeStringsRes(data: StringsResFile): string {
    return `${JSON.stringify(data, null, 2)}\n`;
}

export function defaultStringsResFile(): StringsResFile {
    return {
        defaultLocale: "en",
        locales: { en: {} }
    };
}

/** Write `.res` atomically (temp file + rename). */
export function writeStringsResFileAtomic(absPath: string, data: StringsResFile): void {
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });
    const json = serializeStringsRes(data);
    const tmp = `${absPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, absPath);
}
