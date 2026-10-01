/**
 * Security test: podcast audio synthesis must pass LLM-derived text to edge-tts as a plain
 * argument, never through a shell.
 */

import * as fs from "fs";
import * as path from "path";

const mockExecFileSync = jest.fn();
jest.mock("child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  execSync: () => {
    throw new Error("execSync (shell) must not be used");
  },
}));

import { generatePodcast } from "../src/publishing/podcast_generator";

describe("podcast audio synthesis", () => {
  const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_podcast_exec");

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("passes shell metacharacters to edge-tts as a literal argument", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    const payload = '$(touch /tmp/pwned) `id` "quoted" \\';
    const summary = `## 🔥 本日の最重要ニュース\n\n### 注目トピック ${payload}\n\n---\n`;

    const result = await generatePodcast(summary, "2026-10-01", tmpDir);

    expect(result.status).toBe("synthesized");
    const synthesisCall = mockExecFileSync.mock.calls.find(([, args]) => (args as string[]).includes("--text"));
    expect(synthesisCall).toBeDefined();
    const [command, args, options] = synthesisCall as [string, string[], { shell?: unknown }];
    expect(command).toBe("edge-tts");
    expect(args[args.indexOf("--text") + 1]).toContain(payload);
    expect(options.shell).toBeUndefined();
  });
});
