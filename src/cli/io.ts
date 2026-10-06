import { createInterface } from "node:readline/promises";

export interface CliOutput {
  out(message: string): void;
  error(message: string): void;
  confirm(message: string): Promise<boolean>;
}

export async function readStdinText(
  input: NodeJS.ReadableStream & AsyncIterable<Buffer | string> = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createCliOutput(): CliOutput {
  return {
    out(message) {
      process.stdout.write(`${message}\n`);
    },
    error(message) {
      process.stderr.write(`${message}\n`);
    },
    async confirm(message) {
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        const response = await prompt.question(`${message} [y/N] `);
        const normalized = response.trim().toLowerCase();
        return normalized === "y" || normalized === "yes";
      } finally {
        prompt.close();
      }
    },
  };
}
