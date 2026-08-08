import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  update(id: string, transform: (intent: PostIntent) => PostIntent): Promise<PostIntent | null>;
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
    const operation = this.#queue.then(async () => {
      const all = await this.readAll();
      const index = all.findIndex((candidate) => candidate.id === validated.id);
      if (index === -1) all.push(validated); else all[index] = validated;
      await this.writeAll(all);
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  update(id: string, transform: (intent: PostIntent) => PostIntent): Promise<PostIntent | null> {
    const operation = this.#queue.then(async (): Promise<PostIntent | null> => {
      const all = await this.readAll();
      const index = all.findIndex((candidate) => candidate.id === id);
      if (index === -1) return null;
      const updated = postIntentSchema.parse(transform(all[index]!));
      all[index] = updated;
      await this.writeAll(all);
      return updated;
    });
    this.#queue = operation.then(() => undefined, () => undefined);
    return operation;
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
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(intents)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.filePath);
  }
}

export class InMemoryIntentStore implements IntentStore {
  readonly #values = new Map<string, PostIntent>();
  constructor(initial: PostIntent[] = []) {
    for (const intent of initial) this.#values.set(intent.id, postIntentSchema.parse(intent));
  }
  async get(id: string): Promise<PostIntent | null> { return this.#values.get(id) ?? null; }
  async put(intent: PostIntent): Promise<void> { this.#values.set(intent.id, postIntentSchema.parse(intent)); }
  async update(id: string, transform: (intent: PostIntent) => PostIntent): Promise<PostIntent | null> {
    const current = this.#values.get(id);
    if (!current) return null;
    const updated = postIntentSchema.parse(transform(current));
    this.#values.set(id, updated);
    return updated;
  }
}
