// usage: node mark.mjs <task> <mode> <event> [note]   -> appends "iso\tms\ttask\tmode\tevent\tnote"
import { appendFileSync } from "node:fs";
const [task, mode, event, ...note] = process.argv.slice(2);
const now = Date.now();
appendFileSync(new URL("./log.tsv", import.meta.url), `${new Date(now).toISOString()}\t${now}\t${task}\t${mode}\t${event}\t${note.join(" ")}\n`);
console.log(`${task} ${mode} ${event} @ ${new Date(now).toISOString()}`);
