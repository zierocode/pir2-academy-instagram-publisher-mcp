import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const postIntentSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["prepared", "publishing", "published", "failed", "unknown"]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  userId: z.string().min(1),
  username: z.string().min(1).optional(),
  imageUrl: z.url(),
  caption: z.string().min(1).max(2200),
  altText: z.string().max(1000).optional(),
  preparedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  creationId: z.string().optional(),
  mediaId: z.string().optional(),
  publishedAt: z.iso.datetime().optional(),
}).strict();

export type PostIntent = z.infer<typeof postIntentSchema>;

export interface IntentStore {
  get(id: string): Promise<PostIntent | null>;
  put(intent: PostIntent): Promise<void>;
}

export class FileIntentStore implements IntentStore {
  #queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<PostIntent | null> {
    await this.#queue;
    return (await this.readAll()).find((intent) => intent.id === id) ?? null;
  }

  put(intent: PostIntent): Promise<void> {
    const validated = postIntentSchema.parse(intent);
    this.#queue = this.#queue.then(async () => {
      const all = await this.readAll();
      const index = all.findIndex((candidate) => candidate.id === validated.id);
      if (index === -1) all.push(validated); else all[index] = validated;
      await this.writeAll(all);
    });
    return this.#queue;
  }

  private async readAll(): Promise<PostIntent[]> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return z.array(postIntentSchema).parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(intents: PostIntent[]): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(intents)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.filePath);
  }
}
